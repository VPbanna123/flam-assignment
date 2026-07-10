import { describe, expect, test } from '@jest/globals';
import { listCommand } from '../src/commands/listCommand.js';
import { createTempContext } from './helpers.js';

describe('list command', () => {
  test('prints only JSON when json mode is enabled', () => {
    const context = createTempContext();
    const originalDbPath = process.env.QUEUECTL_DB_PATH;
    const originalWrite = process.stdout.write;
    const originalTable = console.table;
    let output = '';
    let tableCalled = false;

    try {
      process.env.QUEUECTL_DB_PATH = context.dbPath;
      process.stdout.write = (chunk) => {
        output += chunk;
        return true;
      };
      console.table = () => {
        tableCalled = true;
      };

      context.jobService.enqueue('{"id":"pending-json","command":"echo pending"}');
      listCommand({ state: 'pending', json: true });

      const parsed = JSON.parse(output);
      expect(tableCalled).toBe(false);
      expect(output).toBe(JSON.stringify(parsed));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('pending-json');
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.QUEUECTL_DB_PATH;
      } else {
        process.env.QUEUECTL_DB_PATH = originalDbPath;
      }

      process.stdout.write = originalWrite;
      console.table = originalTable;
      context.close();
    }
  });
});
