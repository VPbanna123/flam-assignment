export class Logger {
  constructor({ silent = false } = {}) {
    this.silent = silent;
  }

  info(event, fields = {}) {
    this.write('info', event, fields);
  }

  warn(event, fields = {}) {
    this.write('warn', event, fields);
  }

  error(event, fields = {}) {
    this.write('error', event, fields);
  }

  write(level, event, fields) {
    if (this.silent) {
      return;
    }

    const entry = {
      level,
      event,
      timestamp: new Date().toISOString(),
      ...fields
    };

    const line = JSON.stringify(entry);
    if (level === 'error') {
      console.error(line);
      return;
    }

    console.log(line);
  }
}

export const logger = new Logger();
