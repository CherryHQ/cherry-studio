import type { LogLevel, LogSourceWithContext } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import { app, ipcMain } from 'electron'
import os from 'os'
import path from 'path'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'

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
function colorText(text: string, color: string) {
  return ANSICOLORS[color] + text + ANSICOLORS.END
}

const SYSTEM_INFO = {
  os: `${os.platform()}-${os.arch()} / ${os.version()}`,
  hw: `${os.cpus()[0]?.model || 'Unknown CPU'} / ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)}GB`
}
const APP_VERSION = `v${app?.getVersion?.() || 'unknown'}`

const DEFAULT_LEVEL = isDev ? 'silly' : 'info'

/**
 * IMPORTANT: How to use LoggerService
 * please refer to
 *   English: `docs/technical/how-to-use-logger-en.md`
 *   Chinese: `docs/technical/how-to-use-logger-zh.md`
 */
export class LoggerService {
  private static instance: LoggerService
  private logger: winston.Logger

  private logsDir: string = ''

  private module: string = ''
  private context: Record<string, any> = {}

  private constructor() {
    // Create logs directory path
    this.logsDir = path.join(app.getPath('userData'), 'logs')

    // Configure transports based on environment
    const transports: winston.transport[] = []

    //TODO remove when debug is done
    // transports.push(new winston.transports.Console())

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
      level: DEFAULT_LEVEL, // Development: all levels, Production: info and above
      format: winston.format.combine(
        winston.format.splat(),
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

  public static getInstance(): LoggerService {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService()
    }
    return LoggerService.instance
  }

  public withContext(module: string, context?: Record<string, any>): LoggerService {
    const newLogger = Object.create(this)

    // Copy all properties from the base logger
    newLogger.logger = this.logger
    newLogger.module = module
    newLogger.context = { ...this.context, ...context }

    return newLogger
  }

  public finish() {
    this.logger.end()
  }

  private processLog(source: LogSourceWithContext, level: LogLevel, message: string, meta: any[]): void {
    if (isDev) {
      const datetimeColored = colorText(
        new Date().toLocaleString('zh-CN', {
          // year: 'numeric',
          // month: '2-digit',
          // day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          fractionalSecondDigits: 3,
          hour12: false
        }),
        'CYAN'
      )

      console.log('processLog', source.process, this.module, this.context)

      let moduleString = ''
      if (source.process === 'main') {
        moduleString = this.module ? ` [${colorText(this.module, 'UNDERLINE')}] ` : ' '
      } else {
        const combineString = `${source.window}:${source.module}`
        moduleString = ` [${colorText(combineString, 'UNDERLINE')}] `
      }

      switch (level) {
        case 'error':
          console.error(
            `${datetimeColored} ${colorText(colorText('<ERROR>', 'RED'), 'BOLD')}${moduleString}${message}`,
            ...meta
          )
          break
        case 'warn':
          console.warn(
            `${datetimeColored} ${colorText(colorText('<WARN>', 'YELLOW'), 'BOLD')}${moduleString}${message}`,
            ...meta
          )
          break
        case 'info':
          console.info(
            `${datetimeColored} ${colorText(colorText('<INFO>', 'GREEN'), 'BOLD')}${moduleString}${message}`,
            ...meta
          )
          break
        case 'debug':
          console.debug(
            `${datetimeColored} ${colorText(colorText('<DEBUG>', 'BLUE'), 'BOLD')}${moduleString}${message}`,
            ...meta
          )
          break
        case 'verbose':
          console.log(`${datetimeColored} ${colorText('<VERBOSE>', 'BOLD')}${moduleString}${message}`, ...meta)
          break
        case 'silly':
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
    if (level === 'error' || level === 'warn') {
      const extra = {
        sys: SYSTEM_INFO,
        appver: APP_VERSION
      }

      meta.push(extra)
    }

    this.logger.log(level, message, ...meta)
  }

  public error(message: string, ...data: any[]): void {
    this.processMainLog('error', message, data)
  }
  public warn(message: string, ...data: any[]): void {
    this.processMainLog('warn', message, data)
  }
  public info(message: string, ...data: any[]): void {
    this.processMainLog('info', message, data)
  }
  public verbose(message: string, ...data: any[]): void {
    this.processMainLog('verbose', message, data)
  }
  public debug(message: string, ...data: any[]): void {
    this.processMainLog('debug', message, data)
  }
  public silly(message: string, ...data: any[]): void {
    this.processMainLog('silly', message, data)
  }

  private processMainLog(level: LogLevel, message: string, data: any[]): void {
    this.processLog({ process: 'main' }, level, message, data)
  }

  // bind original this to become a callback function
  private processRendererLog = (source: LogSourceWithContext, level: LogLevel, message: string, data: any[]): void => {
    this.processLog(source, level, message, data)
  }

  // Additional utility methods
  public setLevel(level: string): void {
    this.logger.level = level
  }

  public getLevel(): string {
    return this.logger.level
  }

  // Method to reset log level to environment default
  public resetLevel(): void {
    this.setLevel(DEFAULT_LEVEL)
  }

  // Method to get the underlying Winston logger instance
  public getBaseLogger(): winston.Logger {
    return this.logger
  }

  public getLogsDir(): string {
    return this.logsDir
  }

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
