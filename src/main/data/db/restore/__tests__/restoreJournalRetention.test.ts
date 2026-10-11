import type * as NodeFsModule from 'node:fs'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { applyMigrations } from '@data/db/applyMigrations'
import { readAppliedChain } from '@data/db/restore/appliedChain'
import { hashDbFile } from '@data/db/restore/hashDbFile'
import {
  hasPendingRestore,
  PROMOTION_STEP_ORDER,
  type PromotionStep,
  readRestoreJournal,
  type RestoreJournal,
  writeRestoreJournal
} from '@data/db/restore/restoreJournal'
import { appStateTable } from '@data/db/schemas/appState'
import { runBackupRestoreGate } from '@main/core/preboot/backupRestoreGate'

vi.mock('node:fs', async () => {
  const { createNodeFsMock } = await import('@test-helpers/mocks/nodeFsMock')
  const actual = await vi.importActual<typeof NodeFsModule>('node:fs')
  const mocked = await createNodeFsMock()
  const readFileSync = mocked.readFileSync.mockImplementation(actual.readFileSync)
  const renameSync = mocked.renameSync.mockImplementation(actual.renameSync)
  return { ...actual, readFileSync, renameSync, default: { ...actual, readFileSync, renameSync } }
})

type FixtureStep = 'staged' | PromotionStep
type Fault = 'truncated-json' | 'unsupported-version' | 'read-once' | 'read-persistent'
const fixtureSteps: FixtureStep[] = ['staged', ...PROMOTION_STEP_ORDER]
const faults: Fault[] = ['truncated-json', 'unsupported-version', 'read-once', 'read-persistent']
const expectedDatabase: Record<FixtureStep, 'original' | 'restored'> = {
  staged: 'restored',
  'gate-passed': 'original',
  'additive-moved': 'original',
  'sidecars-removed': 'original',
  'live-aside': 'original',
  'work-promoted': 'restored',
  'entries-applied': 'restored',
  'integrity-ok': 'restored'
}

describe('restore journal failure retains original recovery artifacts', () => {
  const dbh = setupTestDatabase()
  let root: string

  beforeEach(async () => {
    const actual = await vi.importActual<typeof NodeFsModule>('node:fs')
    vi.mocked(fs.readFileSync).mockImplementation(actual.readFileSync)
    vi.mocked(fs.renameSync).mockImplementation(actual.renameSync)
    root = fs.mkdtempSync(path.join(tmpdir(), 'cs-journal-retention-'))
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      const paths: Record<string, string> = {
        'app.userdata': root,
        'app.database.file': path.join(root, 'Data', 'cherrystudio.sqlite'),
        'app.database.migrations': resolveMigrationsPath(),
        'feature.backup.restore.file': path.join(root, 'Data', 'restore-journal.json'),
        'feature.backup.restore.staging': path.join(root, 'restore-staging')
      }
      const base = paths[key]
      if (!base) throw new Error(`Unexpected path key: ${key}`)
      return filename ? path.join(base, filename) : base
    })
    dbh.db.insert(appStateTable).values({ key: 'identity', value: 'original' }).run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  function put(filename: string, text: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, text)
  }

  function content(filename: string) {
    return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null
  }

  function identity(filename: string) {
    if (!fs.existsSync(filename)) return null
    let sqlite: Database.Database | undefined
    try {
      sqlite = new Database(filename, { readonly: true, fileMustExist: true })
      if (sqlite.pragma('integrity_check', { simple: true }) !== 'ok') return 'invalid'
      return JSON.parse(String(sqlite.prepare('SELECT value FROM app_state WHERE key = ?').pluck().get('identity')))
    } catch {
      return 'invalid'
    } finally {
      sqlite?.close()
    }
  }

  async function arrange(step: FixtureStep, asideOutsideStaging = false) {
    const restoreId = 'journal-retention'
    const staging = path.join(root, 'restore-staging', restoreId)
    const liveDb = application.getPath('app.database.file')
    const asideDb = asideOutsideStaging
      ? path.join(root, 'Data', 'original-outside-staging.sqlite')
      : path.join(staging, 'aside', 'cherrystudio.sqlite')
    const workDb = path.join(staging, 'work.sqlite')
    const journalPath = application.getPath('feature.backup.restore.file')
    fs.mkdirSync(staging, { recursive: true })
    fs.mkdirSync(path.dirname(journalPath), { recursive: true })
    await dbh.sqlite.backup(liveDb)
    await dbh.sqlite.backup(workDb)
    const work = new Database(workDb, { fileMustExist: true })
    try {
      work.prepare('UPDATE app_state SET value = ? WHERE key = ?').run('"restored"', 'identity')
    } finally {
      work.close()
    }
    const liveDir = path.join(root, 'Data', 'Agents', '.claude')
    const asideDir = path.join(staging, 'aside', 'Data', 'Agents', '.claude')
    const sourceDir = path.join(staging, 'resources', '.claude')
    const liveNote = path.join(root, 'Notes', 'note.md')
    const asideNote = path.join(staging, 'aside', 'Notes', 'note.md')
    const sourceNote = path.join(staging, 'resources', 'note.md')
    put(path.join(liveDir, 'session.jsonl'), 'ORIGINAL SESSION')
    put(path.join(sourceDir, 'session.jsonl'), 'RESTORED SESSION')
    put(liveNote, 'ORIGINAL NOTE')
    put(sourceNote, 'RESTORED NOTE')
    const base = {
      version: 1 as const,
      restoreId,
      createdAt: '2026-10-11T00:00:00.000Z',
      db: {
        promote: path.relative(root, workDb),
        aside: path.relative(root, asideDb),
        fingerprint: await hashDbFile(liveDb),
        chain: readAppliedChain(dbh.sqlite)
      },
      fileResources: [
        {
          kind: 'overwrite' as const,
          livePath: path.relative(root, liveDir),
          asidePath: path.relative(root, asideDir),
          stagingPath: path.relative(root, sourceDir)
        },
        {
          kind: 'note-overwrite' as const,
          livePath: path.relative(root, liveNote),
          asidePath: path.relative(root, asideNote),
          stagingPath: path.relative(root, sourceNote)
        }
      ]
    }
    const journal: RestoreJournal =
      step === 'staged' ? { ...base, state: 'staged' } : { ...base, state: 'promoting', step }
    const order = step === 'staged' ? -1 : PROMOTION_STEP_ORDER.indexOf(step)
    if (order >= PROMOTION_STEP_ORDER.indexOf('live-aside')) {
      fs.mkdirSync(path.dirname(asideDb), { recursive: true })
      fs.renameSync(liveDb, asideDb)
    }
    if (order >= PROMOTION_STEP_ORDER.indexOf('work-promoted')) fs.renameSync(workDb, liveDb)
    if (order >= PROMOTION_STEP_ORDER.indexOf('entries-applied')) {
      fs.mkdirSync(path.dirname(asideDir), { recursive: true })
      fs.mkdirSync(path.dirname(asideNote), { recursive: true })
      fs.renameSync(liveDir, asideDir)
      fs.renameSync(sourceDir, liveDir)
      fs.renameSync(liveNote, asideNote)
      fs.renameSync(sourceNote, liveNote)
    }
    writeRestoreJournal(journal)
    expect(readRestoreJournal()).toEqual({ kind: 'ok', journal })
    return { staging, liveDb, asideDb, workDb, journalPath, liveDir, asideDir, liveNote, asideNote, journal }
  }

  async function inject(fault: Fault, journalPath: string, blockQuarantine = false) {
    const actual = await vi.importActual<typeof NodeFsModule>('node:fs')
    if (fault === 'truncated-json') fs.writeFileSync(journalPath, '{"version":1,"restoreId":')
    else if (fault === 'unsupported-version') {
      const valid = JSON.parse(actual.readFileSync(journalPath, 'utf8'))
      fs.writeFileSync(journalPath, JSON.stringify({ ...valid, version: 2 }))
    } else {
      let remaining = fault === 'read-once' ? 1 : Number.POSITIVE_INFINITY
      vi.mocked(fs.readFileSync).mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
        if (args[0] === journalPath && remaining > 0 && actual.existsSync(journalPath)) {
          remaining -= 1
          throw Object.assign(new Error('EPERM: injected journal read failure'), { code: 'EPERM' })
        }
        return actual.readFileSync(...args)
      })
    }
    if (blockQuarantine) {
      vi.mocked(fs.renameSync).mockImplementation((from, to) => {
        if (from === journalPath)
          throw Object.assign(new Error('EPERM: injected quarantine failure'), { code: 'EPERM' })
        return actual.renameSync(from, to)
      })
    }
    return actual
  }

  function snapshot(fixture: Awaited<ReturnType<typeof arrange>>) {
    return {
      liveDatabase: identity(fixture.liveDb),
      originalAsideDatabase: identity(fixture.asideDb),
      workDatabase: identity(fixture.workDb),
      liveSession: content(path.join(fixture.liveDir, 'session.jsonl')),
      originalAsideSession: content(path.join(fixture.asideDir, 'session.jsonl')),
      liveNote: content(fixture.liveNote),
      originalAsideNote: content(fixture.asideNote),
      stagingExists: fs.existsSync(fixture.staging),
      journalKind: readRestoreJournal().kind,
      pendingRestore: hasPendingRestore()
    }
  }

  function assertRecovered(fixture: Awaited<ReturnType<typeof arrange>>, step: FixtureStep) {
    const result = snapshot(fixture)
    const restored = expectedDatabase[step] === 'restored'
    expect(result.liveDatabase).toBe(expectedDatabase[step])
    expect(result.liveSession).toBe(restored ? 'RESTORED SESSION' : 'ORIGINAL SESSION')
    expect(result.liveNote).toBe(restored ? 'RESTORED NOTE' : 'ORIGINAL NOTE')
    expect(result.journalKind).toBe('none')
    expect(result.stagingExists).toBe(false)
  }

  describe.each(fixtureSteps)('%s', (step) => {
    it.each(faults)('blocks boot and retains recovery data after %s, then recovers once readable', async (fault) => {
      const fixture = await arrange(step)
      const actual = await inject(fault, fixture.journalPath)
      const journalText = actual.readFileSync(fixture.journalPath, 'utf8')

      await expect(runBackupRestoreGate()).rejects.toThrow(/restore journal/i)

      const afterGate = snapshot(fixture)
      expect({
        originalDatabaseRetained: [afterGate.liveDatabase, afterGate.originalAsideDatabase].includes('original'),
        originalSessionRetained: [afterGate.liveSession, afterGate.originalAsideSession].includes('ORIGINAL SESSION'),
        originalNoteRetained: [afterGate.liveNote, afterGate.originalAsideNote].includes('ORIGINAL NOTE')
      }).toEqual({ originalDatabaseRetained: true, originalSessionRetained: true, originalNoteRetained: true })
      expect(afterGate.pendingRestore).toBe(true)
      expect(afterGate.stagingExists).toBe(true)
      expect(actual.readFileSync(fixture.journalPath, 'utf8')).toBe(journalText)

      if (fault === 'read-persistent') {
        await expect(runBackupRestoreGate()).rejects.toThrow(/restore journal/i)
        expect(actual.readFileSync(fixture.journalPath, 'utf8')).toBe(journalText)
      }
      vi.mocked(fs.readFileSync).mockImplementation(actual.readFileSync)
      if (fault === 'truncated-json' || fault === 'unsupported-version') {
        await expect(runBackupRestoreGate()).rejects.toThrow(/restore journal/i)
        expect(actual.readFileSync(fixture.journalPath, 'utf8')).toBe(journalText)
        writeRestoreJournal(fixture.journal)
      }
      await runBackupRestoreGate()
      assertRecovered(fixture, step)
    })

    it('recovers a readable journal normally', async () => {
      const fixture = await arrange(step)
      await runBackupRestoreGate()
      assertRecovered(fixture, step)
    })
  })

  it.each(['read-once', 'truncated-json'] as const)(
    'retains the only original even if quarantine rename fails (%s)',
    async (fault) => {
      const fixture = await arrange('live-aside')
      await inject(fault, fixture.journalPath, true)
      await expect(runBackupRestoreGate()).rejects.toThrow(/restore journal/i)
      const result = snapshot(fixture)
      expect([result.liveDatabase, result.originalAsideDatabase]).toContain('original')
      expect(fs.existsSync(fixture.journalPath)).toBe(true)
      expect(result.stagingExists).toBe(true)
    }
  )

  it('protects an original database outside staging without allowing an empty-database boot', async () => {
    const fixture = await arrange('live-aside', true)
    await inject('read-once', fixture.journalPath)
    await expect(runBackupRestoreGate()).rejects.toThrow(/restore journal/i)
    const result = snapshot(fixture)
    expect(result.originalAsideDatabase).toBe('original')
    expect(result.liveDatabase).toBe(null)
    expect(result.stagingExists).toBe(true)
    expect(result.pendingRestore).toBe(true)
  })

  it('blocks the missing-live slot until a retry restores the original database', async () => {
    const fixture = await arrange('live-aside')
    const actual = await inject('read-once', fixture.journalPath)
    await expect(runBackupRestoreGate()).rejects.toThrow(/restore journal/i)
    expect(fs.existsSync(fixture.liveDb)).toBe(false)
    expect(identity(fixture.asideDb)).toBe('original')
    vi.mocked(fs.readFileSync).mockImplementation(actual.readFileSync)
    await runBackupRestoreGate()
    const sqlite = new Database(fixture.liveDb)
    let row: unknown
    try {
      applyMigrations(drizzle({ client: sqlite, casing: 'snake_case' }), resolveMigrationsPath())
      row = sqlite.prepare('SELECT value FROM app_state WHERE key = ?').pluck().get('identity')
    } finally {
      sqlite.close()
    }
    expect(row).toBe('"original"')
  })

  it('retains originals when a journal read failure leaves an invalid promoted database live', async () => {
    const fixture = await arrange('entries-applied')
    fs.writeFileSync(fixture.liveDb, 'INVALID PROMOTED DATABASE'.repeat(300))
    const actual = await inject('read-once', fixture.journalPath)
    await expect(runBackupRestoreGate()).rejects.toThrow(/restore journal/i)
    const result = snapshot(fixture)
    expect({
      database: result.originalAsideDatabase,
      session: result.originalAsideSession,
      note: result.originalAsideNote
    }).toEqual({ database: 'original', session: 'ORIGINAL SESSION', note: 'ORIGINAL NOTE' })
    vi.mocked(fs.readFileSync).mockImplementation(actual.readFileSync)
    await runBackupRestoreGate()
    assertRecovered(fixture, 'live-aside')
  })

  it('retains original files when an interrupted rollback restored the database before the read failure', async () => {
    const fixture = await arrange('entries-applied')
    fs.rmSync(fixture.liveDb)
    fs.renameSync(fixture.asideDb, fixture.liveDb)
    const actual = await inject('read-once', fixture.journalPath)
    await expect(runBackupRestoreGate()).rejects.toThrow(/restore journal/i)
    const result = snapshot(fixture)
    expect(result.liveDatabase).toBe('original')
    expect({ session: result.originalAsideSession, note: result.originalAsideNote }).toEqual({
      session: 'ORIGINAL SESSION',
      note: 'ORIGINAL NOTE'
    })
    vi.mocked(fs.readFileSync).mockImplementation(actual.readFileSync)
    await runBackupRestoreGate()
    assertRecovered(fixture, 'live-aside')
  })
})
