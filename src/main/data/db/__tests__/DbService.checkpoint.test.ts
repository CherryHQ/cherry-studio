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

describe('DbService.checkpoint()', () => {
  it('executes PRAGMA wal_checkpoint(TRUNCATE) on the underlying client', async () => {
    const mockExecute = vi.fn().mockResolvedValue({ rows: [] })

    // Skip the constructor — create a stub with just the dependency checkpoint() needs.
    const stub = Object.create(DbService.prototype) as InstanceType<typeof DbService>
    ;(stub as any).client = { execute: mockExecute }

    await stub.checkpoint()

    expect(mockExecute).toHaveBeenCalledWith('PRAGMA wal_checkpoint(TRUNCATE)')
  })
})
