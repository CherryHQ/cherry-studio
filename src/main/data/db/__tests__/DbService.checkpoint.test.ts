import { describe, expect, it, vi } from 'vitest'

/**
 * Task 5.1: DbService.checkpoint() — unit test
 *
 * Asserts that DbService.checkpoint() executes PRAGMA wal_checkpoint(TRUNCATE)
 * on the underlying libsql client.
 *
 * Strategy: vi.importActual() bypasses the global mock to get the real DbService
 * class, then invokes checkpoint() on a minimal stub that only exposes the
 * private `client` field — avoiding full constructor/lifecycle wiring.
 */

// The global test setup mocks @main/data/db/DbService wholesale.
// vi.importActual() bypasses that mock to load the real implementation.
const { DbService } = await vi.importActual<typeof import('../DbService')>('../DbService')

/**
 * Helper: create a DbService prototype stub with `isReady` overridden via
 * Object.defineProperty (isReady is a getter-only on BaseService).
 */
function makeStub(isReady: boolean) {
  const stub = Object.create(DbService.prototype) as InstanceType<typeof DbService>
  Object.defineProperty(stub, 'isReady', { get: () => isReady, configurable: true })
  return stub
}

describe('DbService.checkpoint()', () => {
  it('executes PRAGMA wal_checkpoint(TRUNCATE) on the underlying client', async () => {
    const mockExecute = vi.fn().mockResolvedValue({ rows: [] })

    const stub = makeStub(true)
    ;(stub as any).client = { execute: mockExecute }

    await stub.checkpoint()

    expect(mockExecute).toHaveBeenCalledWith('PRAGMA wal_checkpoint(TRUNCATE)')
  })

  it('is a no-op when not ready (does not call client.execute)', async () => {
    const mockExecute = vi.fn().mockResolvedValue({ rows: [] })

    const stub = makeStub(false)
    ;(stub as any).client = { execute: mockExecute }

    await expect(stub.checkpoint()).resolves.toBeUndefined()

    expect(mockExecute).not.toHaveBeenCalled()
  })
})
