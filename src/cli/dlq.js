import { listDlqCommand, retryDlqCommand } from '../commands/dlqCommand.js';

export function registerDlq(program) {
  const dlq = program.command('dlq').description('Manage the dead letter queue');

  dlq
    .command('list')
    .description('List dead jobs')
    .action(() => listDlqCommand());

  dlq
    .command('retry')
    .description('Retry a dead job')
    .argument('<jobId>', 'job id')
    .action((jobId) => retryDlqCommand(jobId));
}
