import { listCommand } from '../commands/listCommand.js';

export function registerList(program) {
  program
    .command('list')
    .description('List jobs')
    .option('-s, --state <state>', 'filter by state')
    .option('--json', 'print jobs as strict JSON')
    .action((options) => listCommand(options));
}
