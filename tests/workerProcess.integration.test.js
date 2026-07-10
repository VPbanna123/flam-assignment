import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { createTempContext } from './helpers.js';

const cliPath = path.resolve('src/cli/index.js');

function waitFor(predicate, { timeoutMs = 5000, intervalMs = 25 } = {}) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      try {
        const result = predicate();
        if (result) {
          resolve(result);
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Timed out waiting for condition'));
        return;
      }

      setTimeout(check, intervalMs);
    };

    check();
  });
}

function waitForExit(child, { timeoutMs = 5000 } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Timed out waiting for worker process to exit'));
    }, timeoutMs);

    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function startWorkerProcess(dbPath) {
  return spawn(process.execPath, [cliPath, 'worker', 'start'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      QUEUECTL_DB_PATH: dbPath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function writeWorkerScripts(dir) {
  const delayedRecorderPath = path.join(dir, 'delayed-recorder.js');
  const recorderPath = path.join(dir, 'recorder.js');

  fs.writeFileSync(delayedRecorderPath, `
    import fs from 'node:fs';

    const [outputPath, jobId, delayMs, workerPid] = process.argv.slice(2);
    setTimeout(() => {
      try {
        process.kill(Number(workerPid), 0);
      } catch {
        process.exit(2);
      }

      fs.appendFileSync(outputPath, jobId + '\\n');
    }, Number(delayMs));
  `);

  fs.writeFileSync(recorderPath, `
    import fs from 'node:fs';

    const [outputPath, jobId] = process.argv.slice(2);
    fs.appendFileSync(outputPath, jobId + '\\n');
  `);

  return { delayedRecorderPath, recorderPath };
}

function readExecutionLog(outputPath) {
  if (!fs.existsSync(outputPath)) {
    return [];
  }

  return fs.readFileSync(outputPath, 'utf8').trim().split('\n').filter(Boolean);
}

describe('worker process integration', () => {
  test('recovers a job after SIGKILL and completes it once after restart', async () => {
    const context = createTempContext();
    const workers = [];

    try {
      context.configService.set('poll-interval-ms', '25');
      context.configService.set('job-lease-ms', '200');
      context.configService.set('job-heartbeat-interval-ms', '1000');
      context.configService.set('recovery-interval-ms', '50');

      const outputPath = path.join(context.dir, 'crash-executions.log');
      const { delayedRecorderPath } = writeWorkerScripts(context.dir);
      const command = `${process.execPath} ${delayedRecorderPath} ${outputPath} crash-job 500 $PPID`;

      context.jobService.enqueue({
        id: 'crash-job',
        command,
        timeout_ms: 5000
      });

      const firstWorker = startWorkerProcess(context.dbPath);
      workers.push(firstWorker);

      await waitFor(() => context.jobRepository.findById('crash-job').state === 'processing');
      firstWorker.kill('SIGKILL');
      await waitForExit(firstWorker);

      const restartedWorker = startWorkerProcess(context.dbPath);
      workers.push(restartedWorker);

      await waitFor(() => context.jobRepository.findById('crash-job').state === 'completed', {
        timeoutMs: 7000
      });

      context.workerService.requestStopForRunningWorkers();
      await waitForExit(restartedWorker);

      const job = context.jobRepository.findById('crash-job');
      const executions = readExecutionLog(outputPath);

      expect(job.state).toBe('completed');
      expect(job.worker_id).toBeNull();
      expect(executions).toEqual(['crash-job']);
    } finally {
      for (const worker of workers) {
        if (worker.exitCode === null && worker.signalCode === null) {
          worker.kill('SIGKILL');
        }
      }

      context.close();
    }
  }, 10000);

  test('executes 100 jobs exactly once across 3 worker processes', async () => {
    const context = createTempContext();
    const workers = [];

    try {
      context.configService.set('poll-interval-ms', '10');
      context.configService.set('job-lease-ms', '5000');
      context.configService.set('job-heartbeat-interval-ms', '1000');
      context.configService.set('recovery-interval-ms', '1000');

      const outputPath = path.join(context.dir, 'concurrent-executions.log');
      const { recorderPath } = writeWorkerScripts(context.dir);
      const jobIds = Array.from({ length: 100 }, (_, index) => `job-${String(index + 1).padStart(3, '0')}`);

      for (const jobId of jobIds) {
        context.jobService.enqueue({
          id: jobId,
          command: `${process.execPath} ${recorderPath} ${outputPath} ${jobId}`,
          timeout_ms: 5000
        });
      }

      for (let index = 0; index < 3; index += 1) {
        workers.push(startWorkerProcess(context.dbPath));
      }

      await waitFor(() => context.jobService.status(context.workerRepository).completed === 100, {
        timeoutMs: 10000
      });

      context.workerService.requestStopForRunningWorkers();
      await Promise.all(workers.map((worker) => waitForExit(worker)));

      const executions = readExecutionLog(outputPath);
      const executionCounts = new Map();

      for (const jobId of executions) {
        executionCounts.set(jobId, (executionCounts.get(jobId) || 0) + 1);
      }

      expect(executions).toHaveLength(100);
      expect(new Set(executions)).toEqual(new Set(jobIds));
      for (const jobId of jobIds) {
        expect(executionCounts.get(jobId)).toBe(1);
        expect(context.jobRepository.findById(jobId).state).toBe('completed');
      }
    } finally {
      for (const worker of workers) {
        if (worker.exitCode === null && worker.signalCode === null) {
          worker.kill('SIGKILL');
        }
      }

      context.close();
    }
  }, 15000);
});
