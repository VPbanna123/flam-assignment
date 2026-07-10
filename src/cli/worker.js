import { startWorkerCommand, stopWorkerCommand } from '../commands/workerCommand.js';

export function registerWorker(program) {
  const worker = program.command('worker').description('Manage workers');

  worker
    .command('start')
    .description('Start one or more foreground workers')
    .option('-c, --count <count>', 'number of workers to start', '1')
    .action((options) => startWorkerCommand(options));

  worker
    .command('stop')
    .description('Request all running workers to stop gracefully')
    .action(() => stopWorkerCommand());
}
