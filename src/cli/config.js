import { getConfigCommand, setConfigCommand } from '../commands/configCommand.js';

export function registerConfig(program) {
  const config = program.command('config').description('Manage queue configuration');

  config
    .command('set')
    .description('Set a configuration value')
    .argument('<key>', 'configuration key')
    .argument('<value>', 'configuration value')
    .action((key, value) => setConfigCommand(key, value));

  config
    .command('get')
    .description('List all configuration values')
    .action(() => getConfigCommand());
}
