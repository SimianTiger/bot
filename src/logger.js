const config = require('./config');

function formatMessage(level, args) {
  const prefix = `[${new Date().toISOString()}] [${level}]`;
  const message = args.map((value) => {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }).join(' ');
  return `${prefix} ${message}`;
}

const logger = {
  info(...args) {
    console.log(formatMessage('INFO', args));
  },
  warn(...args) {
    console.warn(formatMessage('WARN', args));
  },
  error(...args) {
    console.error(formatMessage('ERROR', args));
  },
  debug(...args) {
    if (config.SHOW_LOGS) {
      console.debug(formatMessage('DEBUG', args));
    }
  }
};

module.exports = logger;
