import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { expect, it } from 'vitest'

import { applyMigrations } from '../applyMigrations'

it.skipIf(!process.env.CHERRY_IMAGE_MIGRATION_COPY)('preserves the known Properties database and is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cherry-image-migrate-'))
  copyFileSync(process.env.CHERRY_IMAGE_MIGRATION_COPY!, join(dir, 'copy.sqlite'))
  const sqlite = new Database(join(dir, 'copy.sqlite'))
  try {
    const before = sqlite.prepare('SELECT * FROM painting ORDER BY id').all()
    const settings = sqlite.prepare('SELECT id,image_settings FROM user_model ORDER BY id').all()
    const counts = () =>
      ['message', 'agent_session_message', 'file_entry', 'painting_file_ref'].map((table) =>
        sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()
      )
    const oldCounts = counts()
    const db = drizzle({ client: sqlite, casing: 'snake_case' })
    applyMigrations(db, resolve('migrations/sqlite-drizzle'))
    expect(sqlite.prepare('SELECT * FROM painting ORDER BY id').all()).toEqual(before)
    expect(sqlite.prepare('SELECT id,image_settings FROM user_model ORDER BY id').all()).toEqual(settings)
    expect(counts()).toEqual(oldCounts)
    const ledger = sqlite.prepare('SELECT * FROM __drizzle_migrations ORDER BY created_at').all()
    applyMigrations(db, resolve('migrations/sqlite-drizzle'))
    expect(sqlite.prepare('SELECT * FROM __drizzle_migrations ORDER BY created_at').all()).toEqual(ledger)
    expect(sqlite.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  } finally {
    sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
