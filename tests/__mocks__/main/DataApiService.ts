import { vi } from 'vitest'

/**
 * Mock DataApiService for main process testing
 * Simulates the complete main process DataApiService functionality
 */

/**
 * Mock ApiServer class
 */
class MockApiServer {
  public initialize = vi.fn(() => new MockApiServer())

  public getSystemInfo = vi.fn(() => ({
    server: 'MockApiServer',
    version: '1.0.0',
    handlers: ['test-handler'],
    middlewares: ['test-middleware']
  }))
}

/**
 * Mock IpcAdapter class
 */
class MockIpcAdapter {
  public setupHandlers = vi.fn()
  public removeHandlers = vi.fn()
  public isInitialized = vi.fn(() => true)
}

/**
 * Mock DataApiService class
 */
export class MockMainDataApiService {
  private static instance: MockMainDataApiService
  private initialized = false
  private apiServer: MockApiServer
  private _ipcAdapter: MockIpcAdapter // Used for mock setup (referenced in constructor)

  private constructor() {
    this.apiServer = new MockApiServer()
    this._ipcAdapter = new MockIpcAdapter()
  }

  public static getInstance(): MockMainDataApiService {
    if (!MockMainDataApiService.instance) {
      MockMainDataApiService.instance = new MockMainDataApiService()
    }
    return MockMainDataApiService.instance
  }

  // Mock initialization
  public initialize = vi.fn(async (): Promise<void> => {
    this.initialized = true
  })

  // Mock system status
  public getSystemStatus = vi.fn(() => {
    if (!this.initialized) {
      return {
        initialized: false,
        error: 'DataApiService not initialized'
      }
    }

    return {
      initialized: true,
      ipcInitialized: true,
      server: 'MockApiServer',
      version: '1.0.0',
      handlers: ['test-handler'],
      middlewares: ['test-middleware']
    }
  })

  // Mock API server access
  public getApiServer = vi.fn((): MockApiServer => {
    return this.apiServer
  })

  // Mock shutdown
  public shutdown = vi.fn(async (): Promise<void> => {
    this.initialized = false
  })

  // Getter for testing purposes
  public get ipcAdapter() {
    return this._ipcAdapter
  }
}

// Mock singleton instance
const mockInstance = MockMainDataApiService.getInstance()

/**
 * Export mock service
 */
export const MockMainDataApiServiceExport = {
  DataApiService: MockMainDataApiService,
  dataApiService: mockInstance
}

/**
 * Mock API components for advanced testing
 */
export const MockApiComponents = {
  ApiServer: MockApiServer,
  IpcAdapter: MockIpcAdapter
}

/**
 * Utility functions for testing
 */
export const MockMainDataApiServiceUtils = {
  /**
   * Reset all mock call counts and state
   */
  resetMocks: () => {
    // Reset all method mocks
    Object.values(mockInstance).forEach((method) => {
      if (vi.isMockFunction(method)) {
        method.mockClear()
      }
    })

    // Reset initialized state
    mockInstance['initialized'] = false
  },

  /**
   * Set initialization state for testing
   */
  setInitialized: (initialized: boolean) => {
    mockInstance['initialized'] = initialized
  },

  /**
   * Get current initialization state
   */
  isInitialized: (): boolean => {
    return mockInstance['initialized']
  },

  /**
   * Mock system info for testing
   */
  mockSystemInfo: (info: { server: string; version: string; handlers: string[]; middlewares: string[] }) => {
    mockInstance.getApiServer().getSystemInfo.mockReturnValue(info)
  },

  /**
   * Simulate initialization error
   */
  simulateInitializationError: (error: Error) => {
    mockInstance.initialize.mockRejectedValue(error)
  },

  /**
   * Simulate shutdown error
   */
  simulateShutdownError: (error: Error) => {
    mockInstance.shutdown.mockRejectedValue(error)
  },

  /**
   * Get mock call counts for debugging
   */
  getMockCallCounts: () => ({
    initialize: mockInstance.initialize.mock.calls.length,
    shutdown: mockInstance.shutdown.mock.calls.length,
    getSystemStatus: mockInstance.getSystemStatus.mock.calls.length,
    getApiServer: mockInstance.getApiServer.mock.calls.length
  })
}
