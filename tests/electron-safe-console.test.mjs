import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'vitest';

import { createSafeLogger, installBrokenPipeHandlers, isBrokenPipeError } from '../electron/safe-console.cjs';

describe('packaged process logging', () => {
  test('ignores only a closed stdout/stderr pipe', () => {
    expect(isBrokenPipeError(Object.assign(new Error('write failed'), { code: 'EPIPE' }))).toBe(true);
    expect(isBrokenPipeError(new Error('network failed'))).toBe(false);

    const logger = {
      info: () => { throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }); },
      warn: () => undefined,
      error: () => undefined,
    };
    expect(() => createSafeLogger(logger).info('updater check')).not.toThrow();
    expect(() => createSafeLogger({ info: () => { throw new Error('unexpected logger failure'); } }).info('x'))
      .toThrow('unexpected logger failure');
  });

  test('consumes an EPIPE stream error without masking other stream errors', () => {
    const stream = new EventEmitter();
    installBrokenPipeHandlers([stream]);
    expect(() => stream.emit('error', Object.assign(new Error('closed'), { code: 'EPIPE' }))).not.toThrow();
  });
});
