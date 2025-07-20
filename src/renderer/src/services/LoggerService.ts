import type { LogLevel, LogSourceWithContext } from '@shared/config/types'

// check if the current process is a worker
const IS_WORKER = typeof window === 'undefined'
// check if we are in the dev env
const IS_DEV = IS_WORKER ? false : window.electron?.process?.env?.NODE_ENV === 'development'

// the level number is different from real definition, it only for convenience
const LEVEL_MAP: Record<LogLevel, number> = {
  error: 5,
  warn: 4,
  info: 3,
  verbose: 2,
  debug: 1,
  silly: 0
}

const DEFAULT_LEVEL = IS_DEV ? 'silly' : 'info'
const MAIN_LOG_LEVEL = 'warn'

/**
 * IMPORTANT: How to use LoggerService
 * please refer to
 *   English: `docs/technical/how-to-use-logger-en.md`
 *   Chinese: `docs/technical/how-to-use-logger-zh.md`
 */
class LoggerService {
  private static instance: LoggerService

  private level: LogLevel = DEFAULT_LEVEL
  private logToMainLevel: LogLevel = MAIN_LOG_LEVEL

  private window: string = ''
  private module: string = ''
  private context: Record<string, any> = {}

  private constructor() {
    //
  }

  /**
   * Get the singleton instance of LoggerService
   */
  public static getInstance(): LoggerService {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService()
    }
    return LoggerService.instance
  }

  /**
   * Initialize window source for renderer process (can only be called once)
   * @param window - The window identifier
   * @returns The logger service instance
   */
  public initWindowSource(window: string): LoggerService {
    if (this.window) {
      // eslint-disable-next-line no-restricted-syntax
      console.warn(
        '[LoggerService] window source already initialized, current: %s, want to set: %s',
        this.window,
        window
      )
      return this
    }
    this.window = window
    return this
  }

  /**
   * Create a new logger with module name and additional context
   * @param module - The module name for logging
   * @param context - Additional context data
   * @returns A new logger instance with the specified context
   */
  public withContext(module: string, context?: Record<string, any>): LoggerService {
    const newLogger = Object.create(this)

    // Copy all properties from the base logger
    newLogger.module = module
    newLogger.context = { ...this.context, ...context }

    return newLogger
  }

  /**
   * Process and output log messages based on level and configuration
   * @param level - The log level
   * @param message - The log message
   * @param data - Additional data to log
   */
  private processLog(level: LogLevel, message: string, data: any[]): void {
    if (!this.window) {
      // eslint-disable-next-line no-restricted-syntax
      console.error('[LoggerService] window source not initialized, please initialize window source first')
      return
    }

    // skip log if level is lower than default level
    const levelNumber = LEVEL_MAP[level]
    if (levelNumber < LEVEL_MAP[this.level]) {
      return
    }

    const logMessage = this.module ? `[${this.module}] ${message}` : message

    switch (level) {
      case 'error':
        // eslint-disable-next-line no-restricted-syntax
        console.error(logMessage, ...data)
        break
      case 'warn':
        // eslint-disable-next-line no-restricted-syntax
        console.warn(logMessage, ...data)
        break
      case 'info':
        // eslint-disable-next-line no-restricted-syntax
        console.info(logMessage, ...data)
        break
      case 'verbose':
        // eslint-disable-next-line no-restricted-syntax
        console.log(logMessage, ...data)
        break
      case 'debug':
        // eslint-disable-next-line no-restricted-syntax
        console.debug(logMessage, ...data)
        break
      case 'silly':
        // eslint-disable-next-line no-restricted-syntax
        console.log(logMessage, ...data)
        break
    }

    // if the last data is an object with logToMain: true, force log to main
    const forceLogToMain = data.length > 0 && data[data.length - 1]?.logToMain === true

    if (levelNumber >= LEVEL_MAP[this.logToMainLevel] || forceLogToMain) {
      const source: LogSourceWithContext = {
        process: 'renderer',
        window: this.window,
        module: this.module
      }

      if (Object.keys(this.context).length > 0) {
        source.context = this.context
      }

      // remove the last item if it is an object with logToMain: true
      if (forceLogToMain) {
        data = data.slice(0, -1)
      }

      // In renderer process, use window.api.logToMain to send log to main process
      if (!IS_WORKER) {
        window.api.logToMain(source, level, message, data)
      } else {
        //TODO support worker to send log to main process
      }
    }
  }

  /**
   * Log error message
   */
  public error(message: string, ...data: any[]): void {
    this.processLog('error', message, data)
  }

  /**
   * Log warning message
   */
  public warn(message: string, ...data: any[]): void {
    this.processLog('warn', message, data)
  }

  /**
   * Log info message
   */
  public info(message: string, ...data: any[]): void {
    this.processLog('info', message, data)
  }

  /**
   * Log verbose message
   */
  public verbose(message: string, ...data: any[]): void {
    this.processLog('verbose', message, data)
  }

  /**
   * Log debug message
   */
  public debug(message: string, ...data: any[]): void {
    this.processLog('debug', message, data)
  }

  /**
   * Log silly level message
   */
  public silly(message: string, ...data: any[]): void {
    this.processLog('silly', message, data)
  }

  /**
   * Set the minimum log level
   * @param level - The log level to set
   */
  public setLevel(level: LogLevel): void {
    this.level = level
  }

  /**
   * Get the current log level
   * @returns The current log level
   */
  public getLevel(): string {
    return this.level
  }

  /**
   * Reset log level to environment default
   */
  public resetLevel(): void {
    this.setLevel(DEFAULT_LEVEL)
  }

  /**
   * Set the minimum level for logging to main process
   * @param level - The log level to set
   */
  public setLogToMainLevel(level: LogLevel): void {
    this.logToMainLevel = level
  }

  /**
   * Get the current log to main level
   * @returns The current log to main level
   */
  public getLogToMainLevel(): LogLevel {
    return this.logToMainLevel
  }

  /**
   * Reset log to main level to default
   */
  public resetLogToMainLevel(): void {
    this.setLogToMainLevel(MAIN_LOG_LEVEL)
  }
}

export const loggerService = LoggerService.getInstance()
