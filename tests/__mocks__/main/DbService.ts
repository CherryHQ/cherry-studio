import { vi } from 'vitest'

import type { DataApiDataChangeEffect } from '@shared/data/api/types'

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

/** Same batch dedupe as production `DbService.dedupeEffects` (routeParams key-sorted). */
function dedupeEffects(effects: readonly DataApiDataChangeEffect[]): DataApiDataChangeEffect[] {
  const unique = new Map<string, DataApiDataChangeEffect>()
  for (const effect of effects) {
    const routeParams = effect.routeParams
      ? Object.fromEntries(Object.entries(effect.routeParams).sort(([left], [right]) => left.localeCompare(right)))
      : undefined
    const key = JSON.stringify({ ...effect, routeParams })
    if (!unique.has(key)) unique.set(key, effect)
  }
  return [...unique.values()]
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
  private activeCollected: DataApiDataChangeEffect[] | undefined
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

  private collectAndPublish<T>(run: (collected: DataApiDataChangeEffect[]) => T): T {
    const collected = this.activeCollected ?? []
    const isOutermost = this.activeCollected === undefined
    if (isOutermost) this.activeCollected = collected
    try {
      const result = run(collected)
      if (isOutermost && collected.length > 0) this.publishedEffects(dedupeEffects(collected))
      return result
    } finally {
      if (isOutermost) this.activeCollected = undefined
    }
  }

  /**
   * Write transaction mock. Mirrors `DbService.withWriteTx`: when a real
   * better-sqlite3 connection is attached (via `setDb`, e.g. `setupTestDatabase()`),
   * delegates to its `.transaction()` for real transaction semantics (rollback on
   * throw, etc.); otherwise falls through to the plain (non-transactional) db stub.
   * Tests can replace this mock with `vi.spyOn(...)` to assert call order, etc.
   */
  public withWriteTx = vi.fn(
    <T>(fn: (tx: unknown) => T): T =>
      this.collectAndPublish((collected) => {
        const db = this.db as { transaction?: (fn: (tx: unknown) => unknown, options?: unknown) => unknown }
        const run = (tx: unknown) =>
          fn(
            Object.assign(tx as object, {
              effects: { add: (effect: DataApiDataChangeEffect) => collected.push(effect) }
            })
          )
        if (typeof db?.transaction === 'function') {
          return db.transaction(run, { behavior: 'immediate' }) as T
        }
        return run(this.db)
      })
  )

  public withEffects = vi.fn(
    <T>(fn: (effects: { add: (effect: DataApiDataChangeEffect) => void }) => T): T =>
      this.collectAndPublish((collected) => fn({ add: (effect) => collected.push(effect) }))
  )

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
