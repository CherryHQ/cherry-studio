import { loggerService } from '@logger'

const logger = loggerService.withContext('ErrorTestUtils')

/**
 * Error testing utilities for development environment
 * These functions help test the global error handling system
 */
class ErrorTestUtils {
  private static instance: ErrorTestUtils
  private devToolsCommands: Record<string, (...args: any[]) => any> = {}

  // Private constructor for singleton pattern
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static getInstance(): ErrorTestUtils {
    if (!ErrorTestUtils.instance) {
      ErrorTestUtils.instance = new ErrorTestUtils()
    }
    return ErrorTestUtils.instance
  }

  /**
   * Initialize dev tools commands in development environment
   */
  public initDevCommands(): void {
    if (window.electron?.process?.env?.NODE_ENV !== 'development') {
      return
    }

    logger.info('Initializing error test commands for dev tools')

    // Register test commands on window object for easy access in dev tools
    this.devToolsCommands = {
      // Test JavaScript errors
      testJSError: () => this.triggerJavaScriptError(),
      testTypeError: () => this.triggerTypeError(),
      testReferenceError: () => this.triggerReferenceError(),
      testRangeError: () => this.triggerRangeError(),
      testSyntaxError: () => this.triggerSyntaxError(),

      // Test async errors
      testPromiseRejection: () => this.triggerPromiseRejection(),
      testAsyncError: () => this.triggerAsyncError(),
      testTimeoutError: () => this.triggerTimeoutError(),

      // Test React errors
      testReactError: () => this.triggerReactError(),
      testStateError: () => this.triggerStateError(),

      // Test resource errors
      testResourceError: () => this.triggerResourceError(),
      testNetworkError: () => this.triggerNetworkError(),

      // Test custom errors
      testCustomError: () => this.triggerCustomError(),
      testChainedError: () => this.triggerChainedError(),

      // Utility functions
      listErrorTests: () => this.listAvailableTests(),
      runAllTests: () => this.runAllErrorTests(),
      clearErrors: () => this.clearTestErrors()
    }

    // Attach to window for dev tools access
    ;(window as any).errorTest = this.devToolsCommands

    // Log available commands
    logger.info('Error test commands available in dev tools:', Object.keys(this.devToolsCommands))
    console.log('🔧 Error Test Utils initialized!')
    console.log('Available commands:', Object.keys(this.devToolsCommands))
    console.log('Usage: errorTest.testJSError(), errorTest.listErrorTests(), etc.')
  }

  /**
   * Trigger a basic JavaScript error
   */
  private triggerJavaScriptError(): void {
    logger.info('Triggering JavaScript error')
    throw new Error('Test JavaScript Error: This is a deliberate error for testing')
  }

  /**
   * Trigger a TypeError
   */
  private triggerTypeError(): void {
    logger.info('Triggering TypeError')
    const obj: any = null
    obj.nonExistentProperty.someMethod() // This will throw TypeError
  }

  /**
   * Trigger a ReferenceError
   */
  private triggerReferenceError(): void {
    logger.info('Triggering ReferenceError')
    // @ts-ignore - Intentional error for testing
    console.log(undefinedVariable) // This will throw ReferenceError
  }

  /**
   * Trigger a RangeError
   */
  private triggerRangeError(): void {
    logger.info('Triggering RangeError')
    const arr: number[] = []
    arr.length = -1 // This will throw RangeError
  }

  /**
   * Trigger a SyntaxError (using eval for testing)
   */
  private triggerSyntaxError(): void {
    logger.info('Triggering SyntaxError')
    eval('invalid syntax here !!!') // This will throw SyntaxError
  }

  /**
   * Trigger an unhandled promise rejection
   */
  private triggerPromiseRejection(): void {
    logger.info('Triggering Promise rejection')
    Promise.reject(new Error('Test Promise Rejection: Unhandled promise rejection for testing'))
  }

  /**
   * Trigger an async error
   */
  private async triggerAsyncError(): Promise<void> {
    logger.info('Triggering async error')
    await new Promise<void>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('Test Async Error: Error in async operation'))
      }, 100)
    })
  }

  /**
   * Trigger a timeout error
   */
  private triggerTimeoutError(): void {
    logger.info('Triggering timeout error')
    setTimeout(() => {
      throw new Error('Test Timeout Error: Error after timeout')
    }, 100)
  }

  /**
   * Trigger a React component error
   */
  private triggerReactError(): void {
    logger.info('Triggering React component error')
    // This will be caught by React Error Boundary
    const event = new CustomEvent('trigger-react-error', {
      detail: { message: 'Test React Error: Simulated component error' }
    })
    window.dispatchEvent(event)
  }

  /**
   * Trigger a state-related error
   */
  private triggerStateError(): void {
    logger.info('Triggering state error')
    const event = new CustomEvent('trigger-state-error', {
      detail: { message: 'Test State Error: Simulated state management error' }
    })
    window.dispatchEvent(event)
  }

  /**
   * Trigger a resource loading error
   */
  private triggerResourceError(): void {
    logger.info('Triggering resource loading error')
    const img = document.createElement('img')
    img.src = 'https://non-existent-domain-12345.com/image.jpg' // This will fail to load
    document.body.appendChild(img)

    setTimeout(() => {
      document.body.removeChild(img)
    }, 2000)
  }

  /**
   * Trigger a network error
   */
  private async triggerNetworkError(): Promise<void> {
    logger.info('Triggering network error')
    try {
      await fetch('https://non-existent-api-12345.com/data')
    } catch (error) {
      throw new Error(`Test Network Error: ${error}`)
    }
  }

  /**
   * Trigger a custom error with additional context
   */
  private triggerCustomError(): void {
    logger.info('Triggering custom error')
    const customError = new Error('Test Custom Error: Custom error with additional context')
    customError.name = 'CustomTestError'
    ;(customError as any).code = 'TEST_ERROR'
    ;(customError as any).context = {
      testType: 'custom',
      timestamp: new Date().toISOString(),
      additionalInfo: 'This is additional context for testing'
    }
    throw customError
  }

  /**
   * Trigger a chained error (error with cause)
   */
  private triggerChainedError(): void {
    logger.info('Triggering chained error')
    try {
      throw new Error('Original error in chain')
    } catch (originalError) {
      const chainedError = new Error('Test Chained Error: This error was caused by another error')
      chainedError.cause = originalError
      throw chainedError
    }
  }

  /**
   * List all available error tests
   */
  private listAvailableTests(): string[] {
    const tests = Object.keys(this.devToolsCommands).filter((key) => key.startsWith('test') || key === 'runAllTests')

    console.group('📋 Available Error Tests:')
    tests.forEach((test) => {
      console.log(`• errorTest.${test}()`)
    })
    console.groupEnd()

    return tests
  }

  /**
   * Run all error tests (with delays to avoid overwhelming the system)
   */
  private async runAllErrorTests(): Promise<void> {
    logger.info('Running all error tests')
    console.log('🧪 Running all error tests...')

    const testMethods = [
      'testJSError',
      'testTypeError',
      'testPromiseRejection',
      'testAsyncError',
      'testResourceError',
      'testCustomError'
    ]

    for (const testMethod of testMethods) {
      try {
        console.log(`Running ${testMethod}...`)
        await new Promise((resolve) => setTimeout(resolve, 1000)) // Delay between tests
        ;(this as any)[testMethod.replace('test', 'trigger')]()
      } catch (error) {
        // Expected - errors will be caught by global handlers
      }
    }

    console.log('✅ All error tests completed')
  }

  /**
   * Clear any test-related errors from the UI
   */
  private clearTestErrors(): void {
    logger.info('Clearing test errors')
    console.clear()
    console.log('🧹 Error tests cleared')
  }

  /**
   * Cleanup dev commands
   */
  public cleanup(): void {
    if ((window as any).errorTest) {
      delete (window as any).errorTest
      logger.info('Error test commands cleaned up')
    }
  }
}

export default ErrorTestUtils

// Export singleton instance
export const errorTestUtils = ErrorTestUtils.getInstance()
