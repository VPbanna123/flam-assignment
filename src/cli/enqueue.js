import { enqueueCommand } from '../commands/enqueueCommand.js';

export function registerEnqueue(program) {
  program
    .command('enqueue')
    .description('Enqueue a shell command job from a JSON payload')
    .argument('<payload>', 'JSON payload, for example {"id":"job1","command":"echo hello"}')
    .action((payload) => enqueueCommand(payload));
}
