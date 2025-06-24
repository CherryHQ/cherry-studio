import Logger from 'electron-log/renderer'

const isDev = process.env.NODE_ENV === 'development'

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
    // Silently ignore console write errors in renderer
    // The main process will handle logging to file
  }
}

// Override console methods to use electron-log with error handling
const safeConsole = {
  log: (...args: any[]) => {
    try {
      Logger.log(...args)
    } catch {
      // Ignore console errors
    }
  },
  error: (...args: any[]) => {
    try {
      Logger.error(...args)
    } catch {
      // Ignore console errors
    }
  },
  warn: (...args: any[]) => {
    try {
      Logger.warn(...args)
    } catch {
      // Ignore console errors
    }
  },
  info: (...args: any[]) => {
    try {
      Logger.info(...args)
    } catch {
      // Ignore console errors
    }
  },
  debug: (...args: any[]) => {
    try {
      Logger.debug(...args)
    } catch {
      // Ignore console errors
    }
  }
}

Object.assign(console, safeConsole)

export default Logger
