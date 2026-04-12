import { createClient } from '@libsql/client'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Tests for the @libsql/client setPragma() patch.
 *
 * Validates that per-connection PRAGMAs registered via setPragma() are
 * automatically replayed when Sqlite3Client creates a new connection
 * after transaction() nullifies its internal #db reference.
 *
 * See patches/@libsql__client@0.15.15.patch for the implementation.
 */
describe('@libsql/client setPragma() patch', () => {
  let client: ReturnType<typeof createClient>

  afterEach(() => {
    client?.close()
  })

  function createTestClient() {
    client = createClient({ url: 'file::memory:' })
    return client
  }

  it('setPragma() applies immediately when connection exists', async () => {
    const c = createTestClient()

    // Warm up the connection with any query
    await c.execute('SELECT 1')

    // Default synchronous for libsql is FULL (2)
    ;(c as any).setPragma('PRAGMA synchronous = NORMAL')

    const result = await c.execute('PRAGMA synchronous')
    // synchronous = NORMAL is value 1
    expect(Number(result.rows[0][0])).toBe(1)
  })

  it('setPragma() replays PRAGMAs after transaction() creates new connection', async () => {
    const c = createTestClient()

    ;(c as any).setPragma('PRAGMA synchronous = NORMAL')

    // Verify initial state
    const before = await c.execute('PRAGMA synchronous')
    expect(Number(before.rows[0][0])).toBe(1)

    // Create and complete a transaction — this nullifies #db internally
    const tx = await c.transaction()
    await tx.execute('CREATE TABLE IF NOT EXISTS test_pragma (id INTEGER PRIMARY KEY)')
    await tx.commit()

    // After transaction, a new connection is created lazily.
    // Without the patch, synchronous would revert to FULL (2).
    const after = await c.execute('PRAGMA synchronous')
    expect(Number(after.rows[0][0])).toBe(1)
  })

  it('replays multiple PRAGMAs in registration order', async () => {
    const c = createTestClient()

    ;(c as any).setPragma('PRAGMA synchronous = NORMAL')
    ;(c as any).setPragma('PRAGMA cache_size = -4000')

    // Force connection recycling via transaction
    const tx = await c.transaction()
    await tx.execute('CREATE TABLE IF NOT EXISTS test_order (id INTEGER PRIMARY KEY)')
    await tx.commit()

    const syncResult = await c.execute('PRAGMA synchronous')
    expect(Number(syncResult.rows[0][0])).toBe(1)

    const cacheResult = await c.execute('PRAGMA cache_size')
    expect(Number(cacheResult.rows[0][0])).toBe(-4000)
  })

  it('batch() after transaction() has correct PRAGMAs', async () => {
    const c = createTestClient()

    ;(c as any).setPragma('PRAGMA synchronous = NORMAL')

    // Transaction to trigger connection recycling
    const tx = await c.transaction()
    await tx.execute('CREATE TABLE IF NOT EXISTS test_batch (id INTEGER PRIMARY KEY)')
    await tx.commit()

    // batch() internally calls #getDb() which should replay PRAGMAs
    const results = await c.batch(['PRAGMA synchronous'])
    expect(Number(results[0].rows[0][0])).toBe(1)
  })

  it('rejects non-PRAGMA statements', () => {
    const c = createTestClient()

    expect(() => (c as any).setPragma('DROP TABLE users')).toThrow('PRAGMA')
    expect(() => (c as any).setPragma(42)).toThrow('PRAGMA')
    expect(() => (c as any).setPragma('')).toThrow('PRAGMA')
  })
})
