import { vi } from 'vitest'

/**
 * Mock DbService for main process testing
 * Simulates the complete main process DbService functionality
 */

/**
 * A chainable mock drizzle query builder. Every chain method returns the same
 * builder; the synchronous terminals mirror better-sqlite3's drizzle dialect:
 * `.run()` → RunResult-shaped, `.all()` → `[]`, `.get()` → `undefined`. Tests that
 * need specific results override these via `vi.spyOn`/`mockReturnValue`.
 */
function makeQueryBuilderMock(): Record<string, ReturnType<typeof vi.fn>> {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  const chainMethods = [
    'from',
    'where',
    'set',
    'values',
    'limit',
    'offset',
    'orderBy',
    'groupBy',
    'having',
    'returning',
    'onConflictDoUpdate',
    'onConflictDoNothing',
    'leftJoin',
    'innerJoin',
    'rightJoin'
  ]
  for (const method of chainMethods) {
    builder[method] = vi.fn(() => builder)
  }
  builder.run = vi.fn(() => ({ changes: 0, lastInsertRowid: 0 }))
  builder.all = vi.fn(() => [])
  builder.get = vi.fn(() => undefined)
  return builder
}

// Default mock database with chainable, synchronous (better-sqlite3-shaped) stubs.
const defaultMockDb = {
  select: vi.fn(() => makeQueryBuilderMock()),
  insert: vi.fn(() => makeQueryBuilderMock()),
  update: vi.fn(() => makeQueryBuilderMock()),
  delete: vi.fn(() => makeQueryBuilderMock()),
  run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
  transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(defaultMockDb))
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
   * Write transaction mock. Mirrors `DbService.withWriteTx`: synchronously passes
   * the current db (or whatever was set via `setDb`) to the synchronous `fn` so
   * tests exercising the write path do not need a real transaction. Tests can
   * replace this mock with `vi.spyOn(...)` to assert call order, etc.
   */
  public withWriteTx = vi.fn(<T>(fn: (tx: unknown) => T): T => fn(this.db))

  /** Restore-facing APIs (see src/main/data/db/restore/README.md) — no-op spies. */
  public createSnapshot = vi.fn()

  public checkpointTruncate = vi.fn()

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
    mockInstance.createSnapshot.mockClear()
    mockInstance.checkpointTruncate.mockClear()

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
    withWriteTx: mockInstance.withWriteTx.mock.calls.length,
    createSnapshot: mockInstance.createSnapshot.mock.calls.length,
    checkpointTruncate: mockInstance.checkpointTruncate.mock.calls.length
  })
}
