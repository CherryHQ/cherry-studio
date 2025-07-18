import { isDev } from '@renderer/utils/env'
import type { LogLevel, LogSourceWithContext } from '@shared/config/types'

const IS_DEV = await getIsDev()
async function getIsDev() {
  return await isDev()
}

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
export class LoggerService {
  private static instance: LoggerService

  private level: LogLevel = DEFAULT_LEVEL
  private logToMainLevel: LogLevel = MAIN_LOG_LEVEL

  private window: string = ''
  private module: string = ''
  private context: Record<string, any> = {}

  private constructor() {
    //
  }

  public static getInstance(): LoggerService {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService()
    }
    return LoggerService.instance
  }

  // init window source for renderer process
  // can only be called once
  public initWindowSource(window: string): boolean {
    if (this.window) {
      return false
    }
    this.window = window
    return true
  }

  // create a new logger with a new context
  public withContext(module: string, context?: Record<string, any>): LoggerService {
    const newLogger = Object.create(this)

    // Copy all properties from the base logger
    newLogger.module = module
    newLogger.context = { ...this.context, ...context }

    return newLogger
  }

  private processLog(level: LogLevel, message: string, data: any[]): void {
    if (!this.window) {
      console.error('LoggerService: window source not initialized, please initialize window source first')
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
        console.error(logMessage, ...data)
        break
      case 'warn':
        console.warn(logMessage, ...data)
        break
      case 'info':
        console.info(logMessage, ...data)
        break
      case 'verbose':
        console.log(logMessage, ...data)
        break
      case 'debug':
        console.debug(logMessage, ...data)
        break
      case 'silly':
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

      window.api.logToMain(source, level, message, data)
    }
  }

  public error(message: string, ...data: any[]): void {
    this.processLog('error', message, data)
  }
  public warn(message: string, ...data: any[]): void {
    this.processLog('warn', message, data)
  }
  public info(message: string, ...data: any[]): void {
    this.processLog('info', message, data)
  }
  public verbose(message: string, ...data: any[]): void {
    this.processLog('verbose', message, data)
  }
  public debug(message: string, ...data: any[]): void {
    this.processLog('debug', message, data)
  }
  public silly(message: string, ...data: any[]): void {
    this.processLog('silly', message, data)
  }

  public setLevel(level: LogLevel): void {
    this.level = level
  }

  public getLevel(): string {
    return this.level
  }

  // Method to reset log level to environment default
  public resetLevel(): void {
    this.setLevel(DEFAULT_LEVEL)
  }

  public setLogToMainLevel(level: LogLevel): void {
    this.logToMainLevel = level
  }

  public getLogToMainLevel(): LogLevel {
    return this.logToMainLevel
  }

  public resetLogToMainLevel(): void {
    this.setLogToMainLevel(MAIN_LOG_LEVEL)
  }
}

export const loggerService = LoggerService.getInstance()
