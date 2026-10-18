/**
 * Structured JSON logger. Every line passes through `redact` before it is
 * written, so callers cannot log a token by accident.
 */
import { redact, redactString } from "./redact";

export { redact, redactString, isSensitiveKey, REDACTED } from "./redact";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Record<string, unknown>;
export type LogSink = (line: string, level: LogLevel) => void;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  bindings?: LogFields;
  sink?: LogSink;
  now?: () => Date;
}

const defaultSink: LogSink = (line, level) => {
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const minimum = LOG_LEVELS.indexOf(options.level ?? "info");
  const bindings = options.bindings ?? {};
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());

  const write = (level: LogLevel, message: string, fields?: LogFields) => {
    if (LOG_LEVELS.indexOf(level) < minimum) return;
    const entry = redact({ ...bindings, ...fields }) as LogFields;
    const line = JSON.stringify({
      ...entry,
      time: now().toISOString(),
      level,
      msg: redactString(message),
    });
    sink(line, level);
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    child: (more) => createLogger({ ...options, bindings: { ...bindings, ...more } }),
  };
}

function levelFromEnv(): LogLevel {
  const level = process.env.LOG_LEVEL;
  return (LOG_LEVELS as readonly string[]).includes(level ?? "") ? (level as LogLevel) : "info";
}

export const log = createLogger({ level: levelFromEnv() });
