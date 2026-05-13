import { describe, expect, it, vi } from 'vitest'

/**
 * Task 5.1: DbService.checkpoint() — RED
 *
 * Asserts that DbService.checkpoint() executes PRAGMA wal_checkpoint(TRUNCATE)
 * on the underlying client.
 */

// Hoisted mocks
const { mockClientExecute, mockGetPath } = vi.hoisted(() => ({
  mockClientExecute: vi.fn().mockResolvedValue({ rows: [] }),
  mockGetPath: vi.fn((key: string) => `/mock/${key}`)
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn(),
    getPath: mockGetPath,
    relaunch: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    statSync: vi.fn(),
    unlinkSync: vi.fn()
  },
  existsSync: vi.fn(() => false),
  statSync: vi.fn(),
  unlinkSync: vi.fn()
}))

vi.mock('drizzle-orm/libsql', () => ({
  drizzle: vi.fn(() => ({
    run: vi.fn()
  }))
}))

vi.mock('drizzle-orm/libsql/migrator', () => ({
  migrate: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => ({
    execute: mockClientExecute,
    setPragma: vi.fn()
  }))
}))

vi.mock('url', () => ({
  pathToFileURL: vi.fn((p: string) => ({ href: `file://${p}` }))
}))

vi.mock('../customSqls', () => ({
  CUSTOM_SQL_STATEMENTS: []
}))

vi.mock('../seeding', () => ({
  seeders: []
}))

vi.mock('../seeding/SeedRunner', () => ({
  SeedRunner: vi.fn().mockImplementation(() => ({
    runAll: vi.fn().mockResolvedValue(undefined)
  }))
}))

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  class MockBaseService {
    protected isReady = true
    protected _disposables: Array<{ dispose: () => void } | (() => void)> = []
    protected registerDisposable<T extends { dispose: () => void } | (() => void)>(d: T): T {
      this._disposables.push(d)
      return d
    }
  }
  return {
    ...actual,
    BaseService: MockBaseService,
    Injectable: () => () => {},
    ServicePhase: () => () => {},
    Priority: () => () => {},
    ErrorHandling: () => () => {}
  }
})

import { DbService } from '../DbService'

describe('DbService.checkpoint()', () => {
  it('executes PRAGMA wal_checkpoint(TRUNCATE) on the underlying client', async () => {
    const service = new DbService()

    await (service as any).checkpoint()

    expect(mockClientExecute).toHaveBeenCalledWith('PRAGMA wal_checkpoint(TRUNCATE)')
  })
})
