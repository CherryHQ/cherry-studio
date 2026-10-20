import { LEVEL_MAP, type LogLevel } from '@shared/types/logger'

type EmitLevel = Exclude<LogLevel, 'none'>

const CONSOLE_METHOD = {
  error: 'error',
  warn: 'warn',
  info: 'info',
  verbose: 'debug',
  debug: 'debug',
  silly: 'debug'
} as const satisfies Record<EmitLevel, keyof Console>

/** Browser stand-in for `@logger`: the same leveled API, written to the Worker console. */
export class LoggerService {
  static #level: LogLevel = 'info'
  readonly #module: string

  constructor(module = 'web-core') {
    this.#module = module
  }

  withContext(module: string): LoggerService {
    return new LoggerService(module)
  }

  setLevel(level: LogLevel): void {
    LoggerService.#level = level
  }

  getLevel(): LogLevel {
    return LoggerService.#level
  }

  error(message: string, ...data: unknown[]): void {
    this.#log('error', message, data)
  }

  warn(message: string, ...data: unknown[]): void {
    this.#log('warn', message, data)
  }

  info(message: string, ...data: unknown[]): void {
    this.#log('info', message, data)
  }

  verbose(message: string, ...data: unknown[]): void {
    this.#log('verbose', message, data)
  }

  debug(message: string, ...data: unknown[]): void {
    this.#log('debug', message, data)
  }

  silly(message: string, ...data: unknown[]): void {
    this.#log('silly', message, data)
  }

  #log(level: EmitLevel, message: string, data: unknown[]): void {
    const threshold = LoggerService.#level
    if (threshold === 'none' || LEVEL_MAP[level] < LEVEL_MAP[threshold]) return
    console[CONSOLE_METHOD[level]](`[${this.#module}] ${message}`, ...data)
  }
}

export const loggerService = new LoggerService()
