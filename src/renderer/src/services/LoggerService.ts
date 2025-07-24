/* eslint-disable no-restricted-syntax */
import type { LogContextData, LogLevel, LogSourceWithContext } from '@shared/config/logger'
import { LEVEL, LEVEL_MAP } from '@shared/config/logger'

// check if the current process is a worker
const IS_WORKER = typeof window === 'undefined'
// check if we are in the dev env
// DO NOT use `constants.ts` here, because the files contains other dependencies that will fail in worker process
const IS_DEV = IS_WORKER ? false : window.electron?.process?.env?.NODE_ENV === 'development'

const DEFAULT_LEVEL = IS_DEV ? LEVEL.SILLY : LEVEL.INFO
const MAIN_LOG_LEVEL = LEVEL.WARN

/**
 * IMPORTANT: How to use LoggerService
 * please refer to
 *   English: `docs/technical/how-to-use-logger-en.md`
 *   Chinese: `docs/technical/how-to-use-logger-zh.md`
 */
class LoggerService {
  private static instance: LoggerService

  // env variables, only used in dev mode
  // only affect console output, not affect logToMain
  private envLevel: LogLevel = LEVEL.NONE
  private envShowModules: string[] = []

  private level: LogLevel = DEFAULT_LEVEL
  private logToMainLevel: LogLevel = MAIN_LOG_LEVEL

  private window: string = ''
  private module: string = ''
  private context: Record<string, any> = {}

  private constructor() {
    if (IS_DEV) {
      if (
        window.electron?.process?.env?.CSLOGGER_RENDERER_LEVEL &&
        Object.values(LEVEL).includes(window.electron?.process?.env?.CSLOGGER_RENDERER_LEVEL as LogLevel)
      ) {
        this.envLevel = window.electron?.process?.env?.CSLOGGER_RENDERER_LEVEL as LogLevel

        console.log(
          `%c[LoggerService] env CSLOGGER_RENDERER_LEVEL loaded: ${this.envLevel}`,
          'color: blue; font-weight: bold'
        )
      }

      if (window.electron?.process?.env?.CSLOGGER_RENDERER_SHOW_MODULES) {
        const showModules = window.electron?.process?.env?.CSLOGGER_RENDERER_SHOW_MODULES.split(',')
          .map((module) => module.trim())
          .filter((module) => module !== '')
        if (showModules.length > 0) {
          this.envShowModules = showModules

          console.log(
            `%c[LoggerService] env CSLOGGER_RENDERER_SHOW_MODULES loaded: ${this.envShowModules.join(' ')}`,
            'color: blue; font-weight: bold'
          )
        }
      }
    }
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
      console.error('[LoggerService] window source not initialized, please initialize window source first')
      return
    }

    const currentLevel = LEVEL_MAP[level]

    // if in dev mode, check if the env variables are set and use the env level and show modules to skip logs
    if (IS_DEV) {
      if (this.envLevel !== LEVEL.NONE && currentLevel < LEVEL_MAP[this.envLevel]) {
        return
      }
      if (this.module && this.envShowModules.length > 0 && !this.envShowModules.includes(this.module)) {
        return
      }
    }

    // skip log if level is lower than default level
    if (currentLevel < LEVEL_MAP[this.level]) {
      return
    }

    const logMessage = this.module ? `[${this.module}] ${message}` : message

    switch (level) {
      case LEVEL.ERROR:
        console.error('%c<error>', 'color: red; font-weight: bold', logMessage, ...data)
        break
      case LEVEL.WARN:
        console.warn('%c<warn>', 'color: #FFA500; font-weight: bold', logMessage, ...data)
        break
      case LEVEL.INFO:
        console.info('%c<info>', 'color: #32CD32; font-weight: bold', logMessage, ...data)
        break
      case LEVEL.VERBOSE:
        console.debug('%c<verbose>', 'color: #808080', logMessage, ...data)
        break
      case LEVEL.DEBUG:
        console.debug('%c<debug>', 'color: #7B68EE', logMessage, ...data)
        break
      case LEVEL.SILLY:
        console.debug('%c<silly>', 'color: #808080', logMessage, ...data)
        break
    }

    // if the last data is an object with logToMain: true, force log to main
    const forceLogToMain = data.length > 0 && data[data.length - 1]?.logToMain === true

    if (currentLevel >= LEVEL_MAP[this.logToMainLevel] || forceLogToMain) {
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
  public error(message: string, ...data: LogContextData): void {
    this.processLog(LEVEL.ERROR, message, data)
  }

  /**
   * Log warning message
   */
  public warn(message: string, ...data: LogContextData): void {
    this.processLog(LEVEL.WARN, message, data)
  }

  /**
   * Log info message
   */
  public info(message: string, ...data: LogContextData): void {
    this.processLog(LEVEL.INFO, message, data)
  }

  /**
   * Log verbose message
   */
  public verbose(message: string, ...data: LogContextData): void {
    this.processLog(LEVEL.VERBOSE, message, data)
  }

  /**
   * Log debug message
   */
  public debug(message: string, ...data: LogContextData): void {
    this.processLog(LEVEL.DEBUG, message, data)
  }

  /**
   * Log silly level message
   */
  public silly(message: string, ...data: LogContextData): void {
    this.processLog(LEVEL.SILLY, message, data)
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
