import { exec } from 'node:child_process';
import { epochMs } from '../utils/time.js';

export class JobExecutor {
  execute(command, { timeoutMs } = {}) {
    const startedAt = epochMs();

    return new Promise((resolve) => {
      exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
        const durationMs = epochMs() - startedAt;

        if (!error) {
          resolve({
            success: true,
            stdout,
            stderr,
            exitCode: 0,
            durationMs,
            errorMessage: null
          });
          return;
        }

        resolve({
          success: false,
          stdout,
          stderr,
          exitCode: typeof error.code === 'number' ? error.code : 1,
          durationMs,
          errorMessage: error.killed
            ? `Command timed out after ${timeoutMs}ms`
            : error.message
        });
      });
    });
  }
}
