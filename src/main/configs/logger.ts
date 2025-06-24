import { app } from 'electron'
import Logger from 'electron-log'
import path from 'path'

const isDev = process.env.NODE_ENV === 'development'

export function setupLogger() {
  // Configure log file path
  const logPath = path.join(app.getPath('userData'), 'logs')

  // Set log file paths
  Logger.transports.file.resolvePathFn = () => path.join(logPath, 'main.log')
  Logger.transports.file.level = 'info'
  Logger.transports.file.maxSize = 10 * 1024 * 1024 // 10MB

  // Configure console transport
  if (isDev) {
    // In development, use console normally
    Logger.transports.console.level = 'debug'
  } else {
    // In production, disable console to avoid EIO errors
    Logger.transports.console.level = false
  }

  // Add error handling for console transport
  const originalConsoleTransport = Logger.transports.console.writeFn
  Logger.transports.console.writeFn = (msg) => {
    try {
      if (originalConsoleTransport) {
        originalConsoleTransport(msg)
      }
    } catch (error) {
      // Log the error details to file for diagnostics
      try {
        const fs = require('fs')
        const diagnosticPath = path.join(logPath, 'console-errors.log')
        const timestamp = new Date().toISOString()
        const errorMessage = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : ''
        const errorDetails = `[${timestamp}] Console write error:\n${errorMessage}\n${errorStack}\nOriginal message: ${JSON.stringify(msg)}\n\n`
        fs.appendFileSync(diagnosticPath, errorDetails)
      } catch {
        // Can't log file write errors
      }
    }
  }

  // Configure error handling
  Logger.errorHandler.startCatching({
    showDialog: false,
    onError: ({ error, errorName, processType }) => {
      // Write errors to file instead of console
      try {
        Logger.error(`[${errorName}] [${processType}]`, error.message, error.stack)
      } catch {
        // If logging also fails, we can't do much
      }
    }
  })

  // Override console methods to use electron-log with error handling
  const safeConsoleWrapper = (logMethod: any) => {
    return (...args: any[]) => {
      try {
        logMethod(...args)
      } catch (error) {
        // Write directly to file if console logging fails
        try {
          const fs = require('fs')
          const fallbackPath = path.join(logPath, 'console-fallback.log')
          const timestamp = new Date().toISOString()
          const message = `[${timestamp}] Fallback log: ${args.join(' ')}\n`
          fs.appendFileSync(fallbackPath, message)
        } catch {
          // Ultimate fallback - can't do anything
        }
      }
    }
  }

  Object.assign(console, {
    log: safeConsoleWrapper(Logger.log),
    error: safeConsoleWrapper(Logger.error),
    warn: safeConsoleWrapper(Logger.warn),
    info: safeConsoleWrapper(Logger.info),
    debug: safeConsoleWrapper(Logger.debug)
  })

  // Log initialization
  Logger.info('Logger initialized', {
    isDev,
    logPath,
    platform: process.platform,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node
  })

  return Logger
}

// Export configured logger
export default Logger
