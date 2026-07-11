import type * as DbServiceModule from '@data/db/DbService'
import { checkpointTruncateAssert } from '@data/db/restore/checkpoint'
import { snapshotTo } from '@data/db/restore/snapshot'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Guard + delegation contract of the two restore-facing DbService methods.
 * The real SQLite semantics live in the delegates' own tests
 * (restore/__tests__/snapshot.test.ts, checkpoint.test.ts); here the delegates
 * are mocked and the REAL methods run on a bare prototype instance (no
 * constructor, no real DB), pinning that:
 *   - the readiness guard rejects before init() without touching the delegate;
 *   - when ready, each method hands the service's own raw connection through.
 */

vi.mock('@data/db/restore/snapshot', () => ({ snapshotTo: vi.fn() }))
vi.mock('@data/db/restore/checkpoint', () => ({ checkpointTruncateAssert: vi.fn() }))

// tests/main.setup.ts globally mocks the DbService module (class export is a
// bare vi.fn()); importActual bypasses that and returns the real class. Its
// restore delegates above stay mocked — importActual is not deep.
const { DbService } = await vi.importActual<typeof DbServiceModule>('@data/db/DbService')
type DbServiceInstance = InstanceType<typeof DbService>

const fakeSqlite = { fake: 'better-sqlite3-connection' }

function bareDbService(ready: boolean): DbServiceInstance {
  const service = Object.create(DbService.prototype) as DbServiceInstance
  Object.defineProperty(service, 'sqlite', { value: fakeSqlite })
  Object.defineProperty(service, 'isReady', { value: ready })
  return service
}

beforeEach(() => {
  vi.mocked(snapshotTo).mockClear()
  vi.mocked(checkpointTruncateAssert).mockClear()
})

describe('DbService.createSnapshot', () => {
  it('rejects before init() without touching the delegate', () => {
    const service = bareDbService(false)

    expect(() => service.createSnapshot('/tmp/work.sqlite')).toThrow(/not initialized/i)
    expect(snapshotTo).not.toHaveBeenCalled()
  })

  it('delegates to snapshotTo with its own connection when ready', () => {
    const service = bareDbService(true)

    service.createSnapshot('/tmp/work.sqlite')

    expect(snapshotTo).toHaveBeenCalledExactlyOnceWith(fakeSqlite, '/tmp/work.sqlite')
  })
})

describe('DbService.checkpointTruncate', () => {
  it('rejects before init() without touching the delegate', () => {
    const service = bareDbService(false)

    expect(() => service.checkpointTruncate()).toThrow(/not initialized/i)
    expect(checkpointTruncateAssert).not.toHaveBeenCalled()
  })

  it('delegates to checkpointTruncateAssert with its own connection when ready', () => {
    const service = bareDbService(true)

    service.checkpointTruncate()

    expect(checkpointTruncateAssert).toHaveBeenCalledExactlyOnceWith(fakeSqlite)
  })
})
