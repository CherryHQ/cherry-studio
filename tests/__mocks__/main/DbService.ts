import { vi } from 'vitest'

/**
 * Mock DbService for main process testing
 * Simulates the complete main process DbService functionality
 */

// Default mock database with chainable method stubs
const defaultMockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  run: vi.fn(),
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(defaultMockDb))
}

/**
 * Mock DbService class
 */
export class MockMainDbService {
  private static instance: MockMainDbService
  private db: unknown = defaultMockDb
  private _isReady = true

  private constructor() {}

  public static getInstance(): MockMainDbService {
    if (!MockMainDbService.instance) {
      MockMainDbService.instance = new MockMainDbService()
    }
    return MockMainDbService.instance
  }

  public getDb = vi.fn(() => this.db)

  /**
   * Serialized write transaction mock. Mirrors `DbService.withWriteTx`:
   * passes the current db (or whatever was set via `setDb`) to `fn` so tests
   * exercising the write path do not need to know about the production mutex
   * + BUSY retry machinery. Tests can replace this mock with `vi.spyOn(...)`
   * to assert call order, simulate BUSY, etc.
   */
  public withWriteTx = vi.fn(async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(this.db))

  public get isReady() {
    return this._isReady
  }
}

// Mock singleton instance
const mockInstance = MockMainDbService.getInstance()

/**
 * Export mock service
 */
export const MockMainDbServiceExport = {
  DbService: MockMainDbService,
  dbService: mockInstance
}

/**
 * Utility functions for testing
 */
export const MockMainDbServiceUtils = {
  /**
   * Reset all mock call counts and state
   */
  resetMocks: () => {
    mockInstance.getDb.mockClear()
    mockInstance.withWriteTx.mockClear()

    // Reset default db mocks
    Object.values(defaultMockDb).forEach((method) => {
      if (vi.isMockFunction(method)) {
        method.mockClear()
      }
    })

    // Restore default db
    mockInstance['db'] = defaultMockDb
    mockInstance['_isReady'] = true
  },

  /**
   * Replace the db instance with a custom mock
   */
  setDb: (customDb: unknown) => {
    mockInstance['db'] = customDb
  },

  /**
   * Get the default mock db for reuse or extension
   */
  getDefaultMockDb: () => defaultMockDb,

  /**
   * Set ready state for testing
   */
  setIsReady: (ready: boolean) => {
    mockInstance['_isReady'] = ready
  },

  /**
   * Get mock call counts for debugging
   */
  getMockCallCounts: () => ({
    getDb: mockInstance.getDb.mock.calls.length,
    withWriteTx: mockInstance.withWriteTx.mock.calls.length
  })
}
