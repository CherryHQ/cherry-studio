/* eslint-disable no-restricted-syntax */
import type { LogContextData, LogLevel, LogSourceWithContext } from '@shared/config/logger'
import { LEVEL, LEVEL_MAP } from '@shared/config/logger'
import { IpcChannel } from '@shared/IpcChannel'
import { app, ipcMain } from 'electron'
import os from 'os'
import path from 'path'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import { isMainThread } from 'worker_threads'

import { isDev } from '../constant'

const ANSICOLORS = {
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  END: '\x1b[0m',
  BOLD: '\x1b[1m',
  ITALIC: '\x1b[3m',
  UNDERLINE: '\x1b[4m'
}

/**
 * Apply ANSI color to text
 * @param text - The text to colorize
 * @param color - The color key from ANSICOLORS
 * @returns Colorized text
 */
function colorText(text: string, color: string) {
  return ANSICOLORS[color] + text + ANSICOLORS.END
}

const SYSTEM_INFO = {
  os: `${os.platform()}-${os.arch()} / ${os.version()}`,
  hw: `${os.cpus()[0]?.model || 'Unknown CPU'} / ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)}GB`
}
const APP_VERSION = `${app?.getVersion?.() || 'unknown'}`

const DEFAULT_LEVEL = isDev ? LEVEL.SILLY : LEVEL.INFO

/**
 * IMPORTANT: How to use LoggerService
 * please refer to
 *   English: `docs/technical/how-to-use-logger-en.md`
 *   Chinese: `docs/technical/how-to-use-logger-zh.md`
 */
class LoggerService {
  private static instance: LoggerService
  private logger: winston.Logger

  // env variables, only used in dev mode
  private envLevel: LogLevel = LEVEL.NONE
  private envShowModules: string[] = []

  private logsDir: string = ''

  private module: string = ''
  private context: Record<string, any> = {}

  private constructor() {
    if (!isMainThread) {
      throw new Error('[LoggerService] NOT support worker thread yet, can only be instantiated in main process.')
    }

    // Create logs directory path
    this.logsDir = path.join(app.getPath('userData'), 'logs')

    // env variables, only used in dev mode
    // only affect console output, not affect file output
    if (isDev) {
      // load env level if exists
      if (
        process.env.CSLOGGER_MAIN_LEVEL &&
        Object.values(LEVEL).includes(process.env.CSLOGGER_MAIN_LEVEL as LogLevel)
      ) {
        this.envLevel = process.env.CSLOGGER_MAIN_LEVEL as LogLevel

        console.log(colorText(`[LoggerService] env CSLOGGER_MAIN_LEVEL loaded: ${this.envLevel}`, 'BLUE'))
      }

      // load env show module if exists
      if (process.env.CSLOGGER_MAIN_SHOW_MODULES) {
        const showModules = process.env.CSLOGGER_MAIN_SHOW_MODULES.split(',')
          .map((module) => module.trim())
          .filter((module) => module !== '')
        if (showModules.length > 0) {
          this.envShowModules = showModules

          console.log(
            colorText(`[LoggerService] env CSLOGGER_MAIN_SHOW_MODULES loaded: ${this.envShowModules.join(' ')}`, 'BLUE')
          )
        }
      }
    }

    // Configure transports based on environment
    const transports: winston.transport[] = []

    // Daily rotate file transport for general logs
    transports.push(
      new DailyRotateFile({
        filename: path.join(this.logsDir, 'app.%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '10m',
        maxFiles: '30d'
      })
    )

    // Daily rotate file transport for error logs
    transports.push(
      new DailyRotateFile({
        level: 'warn',
        filename: path.join(this.logsDir, 'app-error.%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '10m',
        maxFiles: '60d'
      })
    )

    // Configure Winston logger
    this.logger = winston.createLogger({
      // Development: all levels, Production: info and above
      level: DEFAULT_LEVEL,
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      exitOnError: false,
      transports
    })

    // Handle transport events
    this.logger.on('error', (error) => {
      console.error('LoggerService fatal error:', error)
    })

    //register ipc handler, for renderer process to log to main process
    this.registerIpcHandler()
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
   * Create a new logger with module name and additional context
   * @param module - The module name for logging
   * @param context - Additional context data
   * @returns A new logger instance with the specified context
   */
  public withContext(module: string, context?: Record<string, any>): LoggerService {
    const newLogger = Object.create(this)

    // Copy all properties from the base logger
    newLogger.logger = this.logger
    newLogger.module = module
    newLogger.context = { ...this.context, ...context }

    return newLogger
  }

  /**
   * Finish logging and close all transports
   */
  public finish() {
    this.logger.end()
  }

  /**
   * Process and output log messages with source information
   * @param source - The log source with context
   * @param level - The log level
   * @param message - The log message
   * @param meta - Additional metadata to log
   */
  private processLog(source: LogSourceWithContext, level: LogLevel, message: string, meta: any[]): void {
    if (isDev) {
      // skip if env level is set and current level is less than env level
      if (this.envLevel !== LEVEL.NONE && LEVEL_MAP[level] < LEVEL_MAP[this.envLevel]) {
        return
      }
      // skip if env show modules is set and current module is not in the list
      if (this.module && this.envShowModules.length > 0 && !this.envShowModules.includes(this.module)) {
        return
      }

      const datetimeColored = colorText(
        new Date().toLocaleString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          fractionalSecondDigits: 3,
          hour12: false
        }),
        'CYAN'
      )

      let moduleString = ''
      if (source.process === 'main') {
        moduleString = this.module ? ` [${colorText(this.module, 'UNDERLINE')}] ` : ' '
      } else {
        moduleString = ` [${colorText(source.window || '', 'UNDERLINE')}::${colorText(source.module || '', 'UNDERLINE')}] `
      }

      switch (level) {
        case LEVEL.ERROR:
          console.error(
            `${datetimeColored} ${colorText(colorText('<ERROR>', 'RED'), 'BOLD')}${moduleString}${message}`,
            ...meta
          )
          break
        case LEVEL.WARN:
          console.warn(
            `${datetimeColored} ${colorText(colorText('<WARN>', 'YELLOW'), 'BOLD')}${moduleString}${message}`,
            ...meta
          )
          break
        case LEVEL.INFO:
          console.info(
            `${datetimeColored} ${colorText(colorText('<INFO>', 'GREEN'), 'BOLD')}${moduleString}${message}`,
            ...meta
          )
          break
        case LEVEL.DEBUG:
          console.debug(
            `${datetimeColored} ${colorText(colorText('<DEBUG>', 'BLUE'), 'BOLD')}${moduleString}${message}`,
            ...meta
          )
          break
        case LEVEL.VERBOSE:
          console.log(`${datetimeColored} ${colorText('<VERBOSE>', 'BOLD')}${moduleString}${message}`, ...meta)
          break
        case LEVEL.SILLY:
          console.log(`${datetimeColored} ${colorText('<SILLY>', 'BOLD')}${moduleString}${message}`, ...meta)
          break
      }
    }

    // add source information to meta
    // renderer process has its own module and context, do not use this.module and this.context
    const sourceWithContext: LogSourceWithContext = source
    if (source.process === 'main') {
      sourceWithContext.module = this.module
      if (Object.keys(this.context).length > 0) {
        sourceWithContext.context = this.context
      }
    }
    meta.push(sourceWithContext)

    // add extra system information for error and warn levels
    if (level === LEVEL.ERROR || level === LEVEL.WARN) {
      const extra = {
        sys: SYSTEM_INFO,
        appver: APP_VERSION
      }

      meta.push(extra)
    }

    this.logger.log(level, message, ...meta)
  }

  /**
   * Log error message
   */
  public error(message: string, ...data: LogContextData): void {
    this.processMainLog(LEVEL.ERROR, message, data)
  }

  /**
   * Log warning message
   */
  public warn(message: string, ...data: LogContextData): void {
    this.processMainLog(LEVEL.WARN, message, data)
  }

  /**
   * Log info message
   */
  public info(message: string, ...data: LogContextData): void {
    this.processMainLog(LEVEL.INFO, message, data)
  }

  /**
   * Log verbose message
   */
  public verbose(message: string, ...data: LogContextData): void {
    this.processMainLog(LEVEL.VERBOSE, message, data)
  }

  /**
   * Log debug message
   */
  public debug(message: string, ...data: LogContextData): void {
    this.processMainLog(LEVEL.DEBUG, message, data)
  }

  /**
   * Log silly level message
   */
  public silly(message: string, ...data: LogContextData): void {
    this.processMainLog(LEVEL.SILLY, message, data)
  }

  /**
   * Process log messages from main process
   * @param level - The log level
   * @param message - The log message
   * @param data - Additional data to log
   */
  private processMainLog(level: LogLevel, message: string, data: any[]): void {
    this.processLog({ process: 'main' }, level, message, data)
  }

  /**
   * Process log messages from renderer process (bound to preserve context)
   * @param source - The log source with context
   * @param level - The log level
   * @param message - The log message
   * @param data - Additional data to log
   */
  private processRendererLog = (source: LogSourceWithContext, level: LogLevel, message: string, data: any[]): void => {
    this.processLog(source, level, message, data)
  }

  /**
   * Set the minimum log level
   * @param level - The log level to set
   */
  public setLevel(level: LogLevel): void {
    this.logger.level = level
  }

  /**
   * Get the current log level
   * @returns The current log level
   */
  public getLevel(): LogLevel {
    return this.logger.level as LogLevel
  }

  /**
   * Reset log level to environment default
   */
  public resetLevel(): void {
    this.setLevel(DEFAULT_LEVEL)
  }

  /**
   * Get the underlying Winston logger instance
   * @returns The Winston logger instance
   */
  public getBaseLogger(): winston.Logger {
    return this.logger
  }

  /**
   * Get the logs directory path
   * @returns The logs directory path
   */
  public getLogsDir(): string {
    return this.logsDir
  }

  /**
   * Register IPC handler for renderer process logging
   */
  private registerIpcHandler(): void {
    ipcMain.handle(
      IpcChannel.App_LogToMain,
      (_, source: LogSourceWithContext, level: LogLevel, message: string, data: any[]) => {
        this.processRendererLog(source, level, message, data)
      }
    )
  }
}

export const loggerService = LoggerService.getInstance()
