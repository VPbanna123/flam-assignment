import { listCommand } from '../commands/listCommand.js';

export function registerList(program) {
  program
    .command('list')
    .description('List jobs')
    .option('-s, --state <state>', 'filter by state')
    .action((options) => listCommand(options));
}
