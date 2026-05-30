import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'

describe('debug migration 0013', () => {
  it('should show which statement fails', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cs-debug-'))
    const dbPath = join(tempDir, 'test.db')
    const client = createClient({ url: pathToFileURL(dbPath).href })
    const db = drizzle({ client, casing: 'snake_case' })

    const migrationsDir = join(process.cwd(), 'migrations/sqlite-drizzle')
    const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8'))

    for (const entry of journal.entries) {
      const tag = entry.tag
      const sqlFile = readFileSync(join(migrationsDir, tag + '.sql'), 'utf8')
      const statements = sqlFile.split('--> statement-breakpoint')
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i].trim()
        if (stmt) {
          try {
            await db.run(sql.raw(stmt))
          } catch (e) {
            console.log(`FAILED: ${tag} statement ${i}: ${e.message}`)
            console.log(`SQL: ${stmt.substring(0, 200)}`)
            throw e
          }
        }
      }
      console.log(`OK: ${tag}`)
    }

    // Verify topic columns
    const info = await client.execute('PRAGMA table_info(topic)')
    const cols = info.rows.map((r) => r.name)
    console.log('Topic columns:', cols)

    expect(cols).toContain('enable_cache_reminder')
    expect(cols).toContain('order_key')

    client.close()
    rmSync(tempDir, { recursive: true, force: true })
  })
})
