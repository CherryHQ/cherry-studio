import { loggerService } from '@logger'

const logger = loggerService.withContext('GlobalErrorHandler')

interface ErrorReportData {
  type: string
  error: {
    message: string
    stack?: string
    name: string
    filename?: string
    lineno?: number
    colno?: number
  }
  context: {
    timestamp: string
    url: string
    userAgent: string
    [key: string]: any
  }
}

class GlobalErrorHandler {
  private static instance: GlobalErrorHandler
  private initialized = false

  // Private constructor for singleton pattern
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static getInstance(): GlobalErrorHandler {
    if (!GlobalErrorHandler.instance) {
      GlobalErrorHandler.instance = new GlobalErrorHandler()
    }
    return GlobalErrorHandler.instance
  }

  public init(): void {
    if (this.initialized) {
      logger.warn('GlobalErrorHandler already initialized')
      return
    }

    logger.info('Initializing global error handlers')

    // Handle uncaught JavaScript errors
    window.onerror = (message, filename, lineno, colno, error) => {
      this.handleJavaScriptError({
        message: String(message),
        filename,
        lineno,
        colno,
        error
      })
      return true // Prevent default browser error handling
    }

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.handlePromiseRejection(event)
    })

    // Handle other error events (like resource loading errors)
    window.addEventListener(
      'error',
      (event) => {
        this.handleResourceError(event)
      },
      true
    ) // Use capture phase to catch all errors

    this.initialized = true
    logger.info('Global error handlers initialized successfully')
  }

  private handleJavaScriptError({
    message,
    filename,
    lineno,
    colno,
    error
  }: {
    message: string
    filename?: string
    lineno?: number
    colno?: number
    error?: Error
  }): void {
    const errorData = {
      message,
      filename: filename || 'unknown',
      lineno: lineno || 0,
      colno: colno || 0,
      stack: error?.stack,
      name: error?.name || 'JavaScript Error'
    }

    logger.error('Uncaught JavaScript error', error || new Error(message), {
      filename,
      lineno,
      colno,
      logToMain: true
    })

    this.sendErrorReport({
      type: 'JavaScript Error',
      error: errorData,
      context: {
        timestamp: new Date().toISOString(),
        url: window.location.href,
        userAgent: navigator.userAgent
      }
    })
  }

  private handlePromiseRejection(event: PromiseRejectionEvent): void {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason))

    logger.error('Unhandled promise rejection', error, {
      reason: event.reason,
      logToMain: true
    })

    this.sendErrorReport({
      type: 'Promise Rejection',
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name || 'PromiseRejectionError'
      },
      context: {
        timestamp: new Date().toISOString(),
        url: window.location.href,
        userAgent: navigator.userAgent,
        reason: String(event.reason)
      }
    })

    // Prevent default browser behavior (showing error in console)
    event.preventDefault()
  }

  private handleResourceError(event: ErrorEvent): void {
    const target = event.target as HTMLElement | null

    // Only handle resource loading errors, not JavaScript errors (which are handled above)
    if (target && target !== (window as any)) {
      const tagName = target.tagName || 'unknown'
      const src = (target as any).src || (target as any).href || 'unknown'

      logger.error('Resource loading error', new Error(`Failed to load ${tagName}: ${src}`), {
        tagName,
        src,
        logToMain: true
      })

      this.sendErrorReport({
        type: 'Resource Loading Error',
        error: {
          message: `Failed to load ${tagName}: ${src}`,
          name: 'ResourceError'
        },
        context: {
          timestamp: new Date().toISOString(),
          url: window.location.href,
          userAgent: navigator.userAgent,
          tagName,
          resourceUrl: src
        }
      })
    }
  }

  private sendErrorReport(errorData: ErrorReportData): void {
    try {
      // Send error report to main process if the API is available
      if ((window as any).api?.sendErrorReport) {
        ;(window as any).api.sendErrorReport(errorData)
      }
    } catch (reportError) {
      logger.error('Failed to send error report to main process', reportError as Error)
    }
  }

  public destroy(): void {
    if (!this.initialized) {
      return
    }

    logger.info('Destroying global error handlers')

    window.onerror = null
    window.removeEventListener('unhandledrejection', this.handlePromiseRejection)
    window.removeEventListener('error', this.handleResourceError, true)

    this.initialized = false
    logger.info('Global error handlers destroyed')
  }
}

export default GlobalErrorHandler

// Export singleton instance
export const globalErrorHandler = GlobalErrorHandler.getInstance()
