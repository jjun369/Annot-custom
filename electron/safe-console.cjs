function isBrokenPipeError(error) {
  return error?.code === 'EPIPE'
    || error?.errno === 'EPIPE'
    || error?.message?.includes('EPIPE')
    || error?.message?.toLowerCase().includes('broken pipe');
}

function createSafeLogger(logger) {
  const safeLogger = {};
  for (const method of ['debug', 'info', 'warn', 'error']) {
    if (typeof logger?.[method] !== 'function') continue;
    safeLogger[method] = (...args) => {
      try {
        return logger[method](...args);
      } catch (error) {
        if (isBrokenPipeError(error)) return undefined;
        throw error;
      }
    };
  }
  return safeLogger;
}

function installBrokenPipeHandlers(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) {
    stream?.on?.('error', (error) => {
      if (!isBrokenPipeError(error)) process.nextTick(() => { throw error; });
    });
  }
}

module.exports = { createSafeLogger, installBrokenPipeHandlers, isBrokenPipeError };
