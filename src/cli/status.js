import { statusCommand } from '../commands/statusCommand.js';

export function registerStatus(program) {
  program
    .command('status')
    .description('Show queue state counts and running worker count')
    .action(() => statusCommand());
}
