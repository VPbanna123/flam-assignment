#!/usr/bin/env node
import { Command } from 'commander';
import { registerConfig } from './config.js';
import { registerDlq } from './dlq.js';
import { registerEnqueue } from './enqueue.js';
import { registerList } from './list.js';
import { registerStatus } from './status.js';
import { registerWorker } from './worker.js';

const program = new Command();

program
  .name('queuectl')
  .description('SQLite-backed shell command job queue')
  .version('1.0.0');

registerEnqueue(program);
registerWorker(program);
registerStatus(program);
registerList(program);
registerDlq(program);
registerConfig(program);

program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error.code === 'commander.helpDisplayed') {
    process.exitCode = 0;
    process.exit();
  }

  console.error(error.message);
  process.exitCode = error.exitCode || 1;
}
