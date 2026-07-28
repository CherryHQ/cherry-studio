import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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

import type * as RestoreJournalModule from '@data/db/restore/restoreJournal'
import {
  dbAsideRelPath,
  type PromotionStep,
  readRestoreJournal,
  stagedDbRelPath,
  writeRestoreJournal
} from '@data/db/restore/restoreJournal'

import { isLiveDbStranded, runRestorePromotion } from '../restorePromotion'

const failJournalWrite = vi.hoisted(() => ({ when: null as ((state: string) => boolean) | null }))

vi.mock('@data/db/restore/restoreJournal', async (importOriginal) => {
  const actual = await importOriginal<typeof RestoreJournalModule>()
  return {
    ...actual,
    writeRestoreJournal: (journal: Parameters<typeof actual.writeRestoreJournal>[0]) => {
      if (failJournalWrite.when?.(journal.state))
        throw new Error(`simulated journal write failure for ${journal.state}`)
      actual.writeRestoreJournal(journal)
    }
  }
})

const restoreId = '11111111-2222-4333-8444-555555555555'
const marker = 'restore-marker'
const livePath = () => join(userData, 'Data', 'cherrystudio.sqlite')
const stagedPath = () => join(userData, stagedDbRelPath(restoreId))
const asidePath = () => join(userData, dbAsideRelPath(restoreId))
const rejectedPath = () => join(userData, 'Data', `cherrystudio.sqlite.restore-rejected-${restoreId}`)

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

function journal(
  state: 'prepared' | 'armed' | 'promoting' | 'reverting' | 'rollback-armed' = 'armed',
  step: PromotionStep = 'live-checkpointed'
) {
  const base = {
    version: 2 as const,
    restoreId,
    createdAt: '2026-07-27T00:00:00.000Z',
    db: { promote: stagedDbRelPath(restoreId), aside: dbAsideRelPath(restoreId), chain: chain(stagedPath()) }
  }
  if (state === 'promoting') return { ...base, state, step }
  if (state === 'reverting') return { ...base, state, step: 'db-promoted' as const, reason: 'integrity failed' }
  return { ...base, state }
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
  afterEach(() => {
    failJournalWrite.when = null
    rmSync(userData, { recursive: true, force: true })
  })

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

  it.each([
    ['gate-passed', 'old', 'failed'],
    ['live-checkpointed', 'old', 'failed'],
    ['sidecars-removed', 'old', 'failed'],
    ['live-aside', 'old', 'failed'],
    ['db-promoted', 'new', 'completed'],
    ['integrity-ok', 'new', 'completed']
  ] as const)('recovers every forward marker to one complete database: %s', async (step, expected, terminal) => {
    makeDb(livePath(), 'old')
    makeDb(stagedPath(), 'new')
    const interrupted = journal('promoting', step)
    if (step === 'live-aside' || step === 'db-promoted' || step === 'integrity-ok') {
      renameSync(livePath(), asidePath())
    }
    if (step === 'db-promoted' || step === 'integrity-ok') {
      renameSync(stagedPath(), livePath())
    }
    writeRestoreJournal(interrupted)

    await runRestorePromotion()

    expect(markerOf(livePath())).toBe(expected)
    expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: terminal } })
  })

  it('uses filesystem facts when the commit rename outruns its live-aside marker', async () => {
    makeDb(stagedPath(), 'new')
    const interrupted = journal('promoting', 'live-aside')
    rmSync(stagedPath())
    makeDb(asidePath(), 'old')
    makeDb(livePath(), 'new')
    writeRestoreJournal(interrupted)

    await runRestorePromotion()

    expect(markerOf(livePath())).toBe('new')
    expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'completed' } })
  })

  it('reverts a database that fails integrity after the commit', async () => {
    makeDb(livePath(), 'old')
    makeDb(stagedPath(), 'new')
    const armed = journal()
    writeFileSync(stagedPath(), 'not a database')
    writeRestoreJournal(armed)

    await runRestorePromotion()

    expect(markerOf(livePath())).toBe('old')
    expect(existsSync(rejectedPath())).toBe(true)
    expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'failed' } })
  })

  it('leaves a committed promotion resumable when its completed marker write fails', async () => {
    makeDb(livePath(), 'old')
    makeDb(stagedPath(), 'new')
    writeRestoreJournal(journal())
    failJournalWrite.when = (candidate) => candidate === 'completed'

    await expect(runRestorePromotion()).rejects.toThrow(/simulated journal write failure/)
    expect(markerOf(livePath())).toBe('new')
    expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'promoting' } })

    failJournalWrite.when = null
    await runRestorePromotion()
    expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'completed' } })
  })

  it.each([
    ['reverting', 'failed'],
    ['rollback-armed', 'rolled-back']
  ] as const)('resumes %s before, between, and after its two database renames', async (state, terminal) => {
    const arrange = (point: 'before' | 'between' | 'after') => {
      makeDb(stagedPath(), 'new')
      if (point === 'before') {
        makeDb(livePath(), 'new')
        makeDb(asidePath(), 'old')
      } else if (point === 'between') {
        makeDb(asidePath(), 'old')
        makeDb(rejectedPath(), 'new')
      } else {
        makeDb(livePath(), 'old')
        makeDb(rejectedPath(), 'new')
      }
    }

    for (const point of ['before', 'between', 'after'] as const) {
      arrange(point)
      writeRestoreJournal(journal(state))
      await runRestorePromotion()
      expect(markerOf(livePath())).toBe('old')
      expect(markerOf(rejectedPath())).toBe('new')
      expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: terminal } })
      rmSync(userData, { recursive: true, force: true })
      userData = mkdtempSync(join(tmpdir(), 'restore-promotion-'))
    }
  })

  it.each([
    ['reverting', 'failed'],
    ['rollback-armed', 'rolled-back']
  ] as const)('keeps %s active when its terminal marker write fails', async (state, terminal) => {
    makeDb(stagedPath(), 'new')
    makeDb(livePath(), 'old')
    makeDb(rejectedPath(), 'new')
    writeRestoreJournal(journal(state))
    failJournalWrite.when = (candidate) => candidate === terminal

    await expect(runRestorePromotion()).rejects.toThrow(/simulated journal write failure/)
    expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state } })
    expect(markerOf(livePath())).toBe('old')
    expect(markerOf(rejectedPath())).toBe('new')
  })

  it('fails closed when a reverse recovery lacks the required evidence', async () => {
    mkdirSync(join(userData, 'Data'), { recursive: true })
    makeDb(stagedPath(), 'new')
    writeRestoreJournal(journal('reverting'))
    await expect(runRestorePromotion()).rejects.toThrow(/cannot prove/)
    expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'reverting' } })
  })
})
