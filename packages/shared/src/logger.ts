import { config } from './config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  readonly scope: string;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(scope: string): Logger;
}

interface LoggingState {
  level: LogLevel;
  json: boolean;
  sink: (line: string) => void;
}

const state: LoggingState = {
  level: config.logLevel,
  json: process.env.WEBPILOT_LOG_JSON === '1',
  sink: (line) => {
    process.stdout.write(`${line}\n`);
  },
};

const SENSITIVE_KEY = /(pass(word)?|token|secret|api[-_]?key|authorization|cookie|session)/i;

export function configureLogging(options: {
  level?: LogLevel;
  json?: boolean;
  sink?: (line: string) => void;
}): void {
  if (options.level) state.level = options.level;
  if (options.json !== undefined) state.json = options.json;
  if (options.sink) state.sink = options.sink;
}

export function levelEnabled(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[state.level];
}

function redact(fields: LogFields): LogFields {
  const output: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = '[redacted]';
    } else if (value instanceof Error) {
      output[key] = { name: value.name, message: value.message };
    } else {
      output[key] = value;
    }
  }
  return output;
}

function emit(level: LogLevel, scope: string, message: string, fields?: LogFields): void {
  if (!levelEnabled(level)) return;
  const at = new Date().toISOString();
  if (state.json) {
    state.sink(
      JSON.stringify({
        at,
        level,
        scope,
        message,
        ...(fields ? redact(fields) : {}),
      }),
    );
    return;
  }
  const extras = fields ? ` ${JSON.stringify(redact(fields))}` : '';
  state.sink(`[${level.toUpperCase()}] ${at} (${scope}) ${message}${extras}`);
}

export function createLogger(scope: string): Logger {
  return {
    scope,
    debug: (message, fields) => emit('debug', scope, message, fields),
    info: (message, fields) => emit('info', scope, message, fields),
    warn: (message, fields) => emit('warn', scope, message, fields),
    error: (message, fields) => emit('error', scope, message, fields),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}

export const rootLogger: Logger = createLogger('webpilot');

/** Per-module logger cache so `loggerFor('browser')` is cheap to call. */
const cache = new Map<string, Logger>();

export function loggerFor(scope: string): Logger {
  const existing = cache.get(scope);
  if (existing) return existing;
  const logger = createLogger(scope);
  cache.set(scope, logger);
  return logger;
}