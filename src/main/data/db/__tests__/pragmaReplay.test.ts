import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
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

/**
 * foreign_keys is the migration-critical PRAGMA: the engine keeps it OFF for the
 * whole migration via setPragma() (see MigrationDbService), relying on the replay
 * to survive every transaction() connection swap. Unlike `synchronous`, `foreign_keys`
 * defaults to ON (libsql is compiled with SQLITE_DEFAULT_FOREIGN_KEYS=1), so its replay
 * cannot be inferred from the synchronous tests above — it must be verified directly.
 *
 * Uses a real file DB, not `file::memory:`: an in-memory DB is per-connection, so the
 * post-transaction connection would see an empty schema and mask the behaviour.
 */
describe('@libsql/client setPragma() — foreign_keys replay (migration-critical)', () => {
  let dir: string | undefined
  let client: ReturnType<typeof createClient> | undefined

  afterEach(() => {
    client?.close()
    client = undefined
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  function newFileClient() {
    dir = mkdtempSync(join(tmpdir(), 'fk-replay-'))
    client = createClient({ url: pathToFileURL(join(dir, 'db.sqlite')).href })
    return client
  }

  async function fkValue(c: ReturnType<typeof createClient>): Promise<number> {
    return Number((await c.execute('PRAGMA foreign_keys')).rows[0][0])
  }

  it('setPragma(foreign_keys=OFF) survives a transaction() connection swap', async () => {
    const c = newFileClient()
    ;(c as any).setPragma('PRAGMA foreign_keys = OFF')

    const tx = await c.transaction()
    await tx.execute('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)')
    await tx.commit()

    expect(await fkValue(c)).toBe(0)
  })

  it('plain execute(foreign_keys=OFF) is LOST after a transaction() (why setPragma is required)', async () => {
    const c = newFileClient()
    await c.execute('PRAGMA foreign_keys = OFF') // NOT registered for replay
    expect(await fkValue(c)).toBe(0)

    const tx = await c.transaction()
    await tx.execute('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)')
    await tx.commit()

    // New connection reverts to the compile-time default (ON).
    expect(await fkValue(c)).toBe(1)
  })

  it('keeps FK disabled across drizzle db.transaction(): a violating insert is allowed', async () => {
    const c = newFileClient()
    ;(c as any).setPragma('PRAGMA foreign_keys = OFF')
    const db = drizzle({ client: c })

    await db.run(sql`CREATE TABLE parent (id INTEGER PRIMARY KEY)`)
    await db.run(sql`CREATE TABLE child (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES parent(id))`)
    await db.transaction(async (tx) => {
      await tx.run(sql`INSERT INTO parent (id) VALUES (1)`)
    })

    // Would throw SQLITE_CONSTRAINT_FOREIGNKEY if the replay had let FK revert to ON.
    await db.run(sql`INSERT INTO child (id, pid) VALUES (1, 999)`)
    const rows = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM child`)
    expect(Number(rows[0].n)).toBe(1)
    expect(await fkValue(c)).toBe(0)
  })

  it('replay wins over a migrate()-style forced FK=ON after a connection swap', async () => {
    const c = newFileClient()
    ;(c as any).setPragma('PRAGMA foreign_keys = OFF')

    // Simulate drizzle migrate()'s finally block forcing FK ON on the live connection.
    await c.execute('PRAGMA foreign_keys = ON')
    expect(await fkValue(c)).toBe(1)

    const tx = await c.transaction()
    await tx.execute('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)')
    await tx.commit()

    // The next connection replays the registered OFF, overriding the transient ON.
    expect(await fkValue(c)).toBe(0)
  })
})
