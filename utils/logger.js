/**
 * Central logger for backend. Use instead of console.* for consistent, controllable output.
 * Set NODE_ENV=production to suppress debug; errors are always logged.
 */
const isDev = process.env.NODE_ENV !== 'production';

const logger = {
  error(...args) {
    if (args.length && typeof args[0] === 'string') {
      // eslint-disable-next-line no-console
      console.error(`[placement] ${args[0]}`, ...args.slice(1));
    } else {
      // eslint-disable-next-line no-console
      console.error('[placement]', ...args);
    }
  },
  warn(...args) {
    if (isDev && args.length) {
      // eslint-disable-next-line no-console
      console.warn('[placement]', ...args);
    }
  },
  info(...args) {
    if (isDev && args.length) {
      // eslint-disable-next-line no-console
      console.info('[placement]', ...args);
    }
  },
  debug(...args) {
    if (isDev && args.length) {
      // eslint-disable-next-line no-console
      console.debug('[placement]', ...args);
    }
  },
};

module.exports = logger;
