import { createClient } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import { vi } from 'vitest'

import * as schema from '../../database/schema'

interface TestFsModule {
  mkdtempSync(prefix: string): string
  rmSync(p: string, options: { recursive: boolean; force: boolean }): void
  existsSync(p: string): boolean
  readFileSync(p: string, encoding: BufferEncoding): string
}

interface TestOsModule {
  tmpdir(): string
}

interface TestPathModule {
  join(...paths: string[]): string
}

/**
 * Sets up a real libsql test database with the agents schema applied via
 * production migration SQL files. Mirrors the `setupTestDatabase()` pattern
 * from `@test-helpers/db` but for the agents subsystem's libsql database.
 *
 * Returns a handle with `.db` (Drizzle) and a `cleanup()` function.
 * Call `cleanup()` in an `afterAll` or `finally` block.
 */
export async function setupAgentsTestDatabase(): Promise<{
  db: LibSQLDatabase<typeof schema>
  cleanup: () => void
}> {
  const fs = await vi.importActual<TestFsModule>('node:fs')
  const os = await vi.importActual<TestOsModule>('node:os')
  const pathMod = await vi.importActual<TestPathModule>('node:path')

  const directory = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'agents-test-'))
  const dbPath = pathMod.join(directory, 'agents.db')
  const client = createClient({ url: `file:${dbPath}`, intMode: 'number' })
  const db = drizzle(client, { schema })

  // Apply production migration SQL files in order
  const migrationDir = pathMod.join(process.cwd(), 'resources', 'database', 'drizzle')
  const journalPath = pathMod.join(migrationDir, 'meta', '_journal.json')
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'))

  for (const entry of journal.entries) {
    const sqlPath = pathMod.join(migrationDir, `${entry.tag}.sql`)
    if (!fs.existsSync(sqlPath)) continue
    const raw = fs.readFileSync(sqlPath, 'utf-8')
    const statements = raw
      .split('--> statement-breakpoint')
      .map((s: string) => s.trim())
      .filter(Boolean)

    for (const stmt of statements) {
      for (const single of stmt
        .split(';')
        .map((s: string) => s.trim())
        .filter(Boolean)) {
        void client.execute(single)
      }
    }
  }

  // Seed the migrations table so MigrationService.runMigrations() sees the
  // database as up-to-date if production code checks during the test.
  for (const entry of journal.entries) {
    void client.execute({
      sql: 'INSERT OR IGNORE INTO migrations (version, tag, executed_at) VALUES (?, ?, ?)',
      args: [entry.idx, entry.tag, Date.now()]
    })
  }

  return {
    db,
    cleanup: () => {
      try {
        client.close()
      } catch {
        // On Windows the libsql client may not release the DB file handle
        // synchronously after close().
      }
      try {
        fs.rmSync(directory, { recursive: true, force: true })
      } catch {
        // Best-effort cleanup on Windows where the file may still be locked.
      }
    }
  }
}
