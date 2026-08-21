import { vi } from 'vitest'

import type { DataApiDataChangeEffect } from '@shared/data/api/types'

import { DataApiEffectScope } from '../../../src/main/data/db/DataApiEffectScope'

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
  private readonly transactionEffectScope = new DataApiEffectScope()
  /**
   * Production-shaped publish surface: one deduplicated batch per outermost
   * successful `withWriteTx`/`withEffects`, never called for empty or rolled-back
   * batches. Assert on this instead of the lint-private `notifyDataApiDataChange`.
   */
  public readonly publishedEffects = vi.fn<(effects: DataApiDataChangeEffect[]) => void>()

  private constructor() {}

  public static getInstance(): MockMainDbService {
    if (!MockMainDbService.instance) {
      MockMainDbService.instance = new MockMainDbService()
    }
    return MockMainDbService.instance
  }

  public getDb = vi.fn(() => this.db)

  /**
   * Write transaction mock. Mirrors `DbService.withWriteTx`: when a real
   * better-sqlite3 connection is attached (via `setDb`, e.g. `setupTestDatabase()`),
   * delegates to its `.transaction()` for real transaction semantics (rollback on
   * throw, etc.); otherwise falls through to the plain (non-transactional) db stub.
   * Tests can replace this mock with `vi.spyOn(...)` to assert call order, etc.
   */
  public withWriteTx = vi.fn(<T>(fn: (tx: unknown) => T): T => {
    const { result, committedEffects } = this.transactionEffectScope.collect((effects) => {
      const db = this.db as { transaction?: (fn: (tx: unknown) => unknown, options?: unknown) => unknown }
      const run = (tx: unknown) => {
        const result = fn(
          Object.assign(tx as object, {
            effects
          })
        )
        if (result instanceof Promise) {
          throw new Error('withWriteTx callback must be synchronous — the transaction commits when it returns')
        }
        return result
      }
      if (typeof db?.transaction === 'function') {
        return db.transaction(run, { behavior: 'immediate' }) as T
      }
      return run(this.db)
    })
    if (committedEffects?.length) this.publishedEffects(committedEffects)
    return result
  })

  public withEffects = vi.fn(<T>(fn: (effects: { add: (effect: DataApiDataChangeEffect) => void }) => T): T => {
    if (this.transactionEffectScope.isCollecting) {
      throw new Error('withEffects cannot run inside withWriteTx — add effects through tx.effects')
    }
    const scope = new DataApiEffectScope()
    const { result, committedEffects } = scope.collect((effects) => {
      const result = fn(effects)
      // Mirrors the production guard: effects publish on return, so async callbacks are rejected.
      if (result instanceof Promise) {
        throw new Error('withEffects callback must be synchronous — effects publish when it returns')
      }
      return result
    })
    if (committedEffects?.length) this.publishedEffects(committedEffects)
    return result
  })

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
    mockInstance.withEffects.mockClear()
    mockInstance.publishedEffects.mockClear()
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
