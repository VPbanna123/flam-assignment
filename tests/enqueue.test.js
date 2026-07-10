import { describe, expect, test } from '@jest/globals';
import { createTempContext } from './helpers.js';

describe('enqueue', () => {
  test('creates a pending job with persisted defaults', () => {
    const context = createTempContext();

    try {
      const job = context.jobService.enqueue('{"id":"job1","command":"echo hello"}');
      const persisted = context.jobRepository.findById('job1');

      expect(job.id).toBe('job1');
      expect(persisted.command).toBe('echo hello');
      expect(persisted.state).toBe('pending');
      expect(persisted.max_retries).toBe(3);
    } finally {
      context.close();
    }
  });

  test('rejects invalid JSON', () => {
    const context = createTempContext();

    try {
      expect(() => context.jobService.enqueue('{bad json')).toThrow('Invalid JSON payload');
    } finally {
      context.close();
    }
  });

  test('prevents duplicate job ids', () => {
    const context = createTempContext();

    try {
      context.jobService.enqueue('{"id":"same","command":"echo one"}');
      expect(() => context.jobService.enqueue('{"id":"same","command":"echo two"}')).toThrow();
    } finally {
      context.close();
    }
  });
});
