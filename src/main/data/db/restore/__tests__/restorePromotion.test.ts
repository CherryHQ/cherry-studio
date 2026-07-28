import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { applyMigrations } from '@data/db/applyMigrations'
import { readAppliedChain } from '@data/db/restore/appliedChain'
import { appStateTable } from '@data/db/schemas/appState'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('@application', () => ({
  application: {
    getPath: (key: string) => {
      const paths: Record<string, string> = {
        'app.userdata': userData,
        'app.database.file': join(userData, 'Data', 'cherrystudio.sqlite'),
        'app.database.migrations': resolveMigrationsPath(),
        'feature.backup.restore.file': join(userData, 'Data', 'restore-journal.json'),
        'feature.backup.restore.staging': join(userData, 'restore-staging')
      }
      if (!paths[key]) throw new Error(`unexpected path ${key}`)
      return paths[key]
    }
  }
}))

import { dbAsideRelPath, readRestoreJournal, stagedDbRelPath, writeRestoreJournal } from '../restoreJournal'
import { isLiveDbStranded, runRestorePromotion } from '../restorePromotion'

const restoreId = '11111111-2222-4333-8444-555555555555'
const marker = 'restore-marker'
const livePath = () => join(userData, 'Data', 'cherrystudio.sqlite')
const stagedPath = () => join(userData, stagedDbRelPath(restoreId))
const asidePath = () => join(userData, dbAsideRelPath(restoreId))

function makeDb(file: string, value: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  const db = drizzle({ client: sqlite, casing: 'snake_case' })
  applyMigrations(db, resolveMigrationsPath())
  db.insert(appStateTable).values({ key: marker, value: { value } }).run()
  sqlite.pragma('journal_mode = DELETE')
  sqlite.close()
}

function chain(file: string) {
  const sqlite = new Database(file, { readonly: true })
  try {
    return readAppliedChain(sqlite)
  } finally {
    sqlite.close()
  }
}

function journal(state: 'prepared' | 'armed' | 'promoting' | 'rollback-armed' = 'armed', step?: 'live-checkpointed') {
  const base = {
    version: 2 as const,
    restoreId,
    createdAt: '2026-07-27T00:00:00.000Z',
    db: { promote: stagedDbRelPath(restoreId), aside: dbAsideRelPath(restoreId), chain: chain(stagedPath()) }
  }
  return state === 'promoting' ? { ...base, state, step: step ?? 'live-checkpointed' } : { ...base, state }
}

function markerOf(file: string): string {
  const sqlite = new Database(file, { readonly: true })
  try {
    return JSON.parse(
      (sqlite.prepare('SELECT value FROM app_state WHERE key = ?').get(marker) as { value: string }).value
    ).value
  } finally {
    sqlite.close()
  }
}

describe('database-only restore promotion', () => {
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'restore-promotion-'))
  })
  afterEach(() => rmSync(userData, { recursive: true, force: true }))

  it('expires an unarmed preparation without touching the live database', async () => {
    makeDb(livePath(), 'old')
    makeDb(stagedPath(), 'new')
    writeRestoreJournal(journal('prepared'))
    await runRestorePromotion()
    expect(markerOf(livePath())).toBe('old')
    expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'expired' } })
    expect(existsSync(stagedPath())).toBe(false)
  })

  it('promotes, retains an adjacent rollback snapshot, then rolls it back', async () => {
    makeDb(livePath(), 'old')
    makeDb(stagedPath(), 'new')
    writeRestoreJournal(journal())
    await runRestorePromotion()
    expect(markerOf(livePath())).toBe('new')
    expect(markerOf(asidePath())).toBe('old')
    const completed = readRestoreJournal()
    if (completed.kind !== 'ok' || completed.journal.state !== 'completed')
      throw new Error('expected completed restore')
    writeRestoreJournal({ ...completed.journal, state: 'rollback-armed' })
    await runRestorePromotion()
    expect(markerOf(livePath())).toBe('old')
    expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'rolled-back' } })
  })

  it('restores the parked database after a pre-commit crash', async () => {
    makeDb(livePath(), 'old')
    makeDb(stagedPath(), 'new')
    renameSync(livePath(), asidePath())
    writeRestoreJournal(journal('promoting', 'live-checkpointed'))
    await runRestorePromotion()
    expect(markerOf(livePath())).toBe('old')
    expect(isLiveDbStranded()).toBe(false)
    expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'failed' } })
  })
})
