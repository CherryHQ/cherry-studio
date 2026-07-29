import type * as NodeFs from 'node:fs'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { applyMigrations } from '@data/db/applyMigrations'
import { readAppliedChain } from '@data/db/restore/appliedChain'
import type * as ResourceInstallModule from '@data/db/restore/resourceInstallV2'
import { hasPendingRestore } from '@data/db/restore/restoreGuard'
import type * as RestoreJournalModule from '@data/db/restore/restoreJournalV2'
import type { PromotionStepV2, RestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { readRestoreJournalV2, writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import {
  isLiveDbStrandedV2,
  isRestoreRecoveryPendingV2,
  markRestoreFailedAfterCrashV2,
  runRestorePromotionV2
} from '@data/db/restore/restorePromotionV2'
import { appStateTable } from '@data/db/schemas/appState'
import { runBackupRestoreGate } from '@main/core/preboot/backupRestoreGate'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Crash matrix for the Backup v2 promotion gate.
 *
 * Strategy: fake userData through a shadowed `@application.getPath`, everything
 * else REAL — real SQLite files built by the production `applyMigrations`, real
 * renames on a real temp filesystem. Each case must end in one of exactly two
 * states: the OLD database is intact and live, or the NEW one is complete and
 * live. Anything else is the third state the design forbids, so every assertion
 * reads the marker row out of the file that actually sits in the live slot.
 */

let userData = ''

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn((key: string, filename?: string) => {
      const bases: Record<string, string> = {
        'app.userdata': userData,
        'app.database.file': join(userData, 'cherrystudio.sqlite'),
        'app.database.migrations': resolveMigrationsPath(),
        'feature.backup.restore.file': join(userData, 'restore-journal.json'),
        'feature.backup.restore.staging': join(userData, 'restore-staging'),
        'feature.knowledgebase.data': join(userData, 'Data', 'KnowledgeBase')
      }
      const base = bases[key]
      if (!base) throw new Error(`Unexpected path key in restorePromotionV2 test: ${key}`)
      return filename ? join(base, filename) : base
    })
  }
}))

/**
 * Fault injection for the journal write itself. A real ENOSPC/EACCES is not
 * portable (CI runs as root, where permission bits are advisory), and what is
 * under test is only what the promotion may still delete when the state it is
 * deleting on the strength of never reached the disk.
 */
const failJournalWrite: {
  when: ((journal: RestoreJournalV2) => boolean) | null
} = { when: null }

/**
 * Fault injection for the rollback of the resource units: while set, the pass
 * fails the way a locked or still-open node makes it fail — a rename the OS
 * refuses, which is exactly the class of failure a restart clears and the retry
 * exists for. Injected at the module boundary because the underlying
 * `fs.renameSync` cannot be spied on through an ESM namespace.
 */
const failResourceRollback = { on: false }

/** The same fault in the committed direction: a unit that cannot be put in place. */
const failResourceInstall = { on: false }

/**
 * Every rename that happens under this module graph. Rename is the ONLY way
 * this machinery moves a database or a resource unit in or out of its live
 * slot, so an empty window here is proof no live mutation occurred — a fact no
 * comparison of end states can establish, since a pair of moves can restore the
 * state it started from. Recorded through the module boundary because an ESM
 * namespace export cannot be spied on.
 */
const renames: string[] = []

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  const renameSync: typeof actual.renameSync = (source, target) => {
    renames.push(`${String(source)} → ${String(target)}`)
    actual.renameSync(source, target)
  }
  // `node:fs` is CJS: the default export carries the same members as the
  // namespace, and the code under test imports it that way.
  return { ...actual, renameSync, default: { ...actual, renameSync } }
})

vi.mock('@data/db/restore/resourceInstallV2', async (importOriginal) => {
  const actual = await importOriginal<typeof ResourceInstallModule>()
  return {
    ...actual,
    recoverResourceUnits: (...args: Parameters<typeof actual.recoverResourceUnits>) => {
      if (failResourceRollback.on && args[2] === 'pre-commit') {
        throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })
      }
      if (failResourceInstall.on && args[2] === 'committed') {
        throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })
      }
      actual.recoverResourceUnits(...args)
    }
  }
})

vi.mock('@data/db/restore/restoreJournalV2', async (importOriginal) => {
  const actual = await importOriginal<typeof RestoreJournalModule>()
  return {
    ...actual,
    writeRestoreJournalV2: (journal: RestoreJournalV2) => {
      if (failJournalWrite.when?.(journal)) {
        throw new Error(`simulated journal write failure for state '${journal.state}'`)
      }
      actual.writeRestoreJournalV2(journal)
    }
  }
})

const RID = '11111111-2222-4333-8444-555555555555'
const MARKER_KEY = 'restore-test-marker'

const livePath = () => join(userData, 'cherrystudio.sqlite')
const asideRel = `cherrystudio.sqlite.pre-restore-${RID}`
const asidePath = () => join(userData, asideRel)
const stagedRel = `restore-staging/${RID}/backup.sqlite`
const stagedPath = () => join(userData, stagedRel)
const stagingDir = () => join(userData, 'restore-staging', RID)
const journalPath = () => join(userData, 'restore-journal.json')

/**
 * A migrated database carrying a marker row.
 *
 * `mode` mirrors production: the live database runs in WAL, and a staged one
 * arrives SEALED in DELETE mode (materialization's contract). The difference is
 * load-bearing here — a read-only open of a WAL database re-creates its
 * sidecars, which the gate rightly refuses to promote.
 */
function makeDb(dbPath: string, which: 'old' | 'new', mode: 'wal' | 'delete' = 'wal'): void {
  mkdirSync(dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle({ client: sqlite, casing: 'snake_case' })
  applyMigrations(db, resolveMigrationsPath())
  db.insert(appStateTable).values({ key: MARKER_KEY, value: { which } }).run()
  if (mode === 'delete') {
    sqlite.pragma('journal_mode = DELETE')
  }
  sqlite.close()
}

/** The staged database as materialization leaves it: sealed, no sidecars. */
function makeStagedDb(which: 'old' | 'new' = 'new'): void {
  makeDb(stagedPath(), which, 'delete')
}

function readMarker(dbPath: string): string {
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const row = sqlite.prepare('SELECT value FROM app_state WHERE key = ?').get(MARKER_KEY) as
      | { value: string }
      | undefined
    if (!row) throw new Error(`marker row missing in ${dbPath}`)
    return (JSON.parse(row.value) as { which: string }).which
  } finally {
    sqlite.close()
  }
}

function hasRow(dbPath: string, key: string): boolean {
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    return sqlite.prepare('SELECT 1 FROM app_state WHERE key = ?').get(key) !== undefined
  } finally {
    sqlite.close()
  }
}

function chainOf(dbPath: string): Array<{ folderMillis: number; hash: string }> {
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    return readAppliedChain(sqlite)
  } finally {
    sqlite.close()
  }
}

interface JournalOverrides {
  state?: RestoreJournalV2['state']
  step?: PromotionStepV2
  chain?: Array<{ folderMillis: number; hash: string }>
  resourceInstalls?: RestoreJournalV2['resourceInstalls']
}

function buildJournal(overrides: JournalOverrides = {}): RestoreJournalV2 {
  const resourceInstalls = overrides.resourceInstalls ?? []
  const base = {
    version: 2 as const,
    restoreId: RID,
    preset: 'full' as const,
    createdAt: '2026-07-27T00:00:00.000Z',
    db: {
      promote: stagedRel,
      aside: asideRel,
      chain: overrides.chain ?? chainOf(stagedPath())
    },
    resourceInstalls
  }
  const state = overrides.state ?? 'armed'
  if (state === 'promoting') return { ...base, state, step: overrides.step ?? 'gate-passed' }
  if (state === 'reverting') {
    return { ...base, state, step: overrides.step ?? 'db-promoted', reason: 'integrity check failed' }
  }
  if (state === 'completed' || state === 'rollback-armed' || state === 'rolled-back') {
    return { ...base, state, summary: { knowledgeBaseIds: [] } }
  }
  return { ...base, state } as RestoreJournalV2
}

function journalState(): string {
  const read = readRestoreJournalV2()
  return read.kind === 'ok' ? read.journal.state : read.kind
}

/** Every file under `dir` as relative path → bytes, for byte-for-byte comparison. */
function treeSnapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(current, entry.name), relative)
      else files[relative] = readFileSync(join(current, entry.name)).toString('base64')
    }
  }
  if (existsSync(dir)) walk(dir, '')
  return files
}

/**
 * Everything the next boot decides from: the journal bytes and the staging
 * tree. A terminal write that failed may leave every one of them untouched.
 */
function recoveryEvidence(): { journal: string; staging: Record<string, string> } {
  return { journal: readFileSync(journalPath()).toString('base64'), staging: treeSnapshot(stagingDir()) }
}

/**
 * Park the crash arrangement's live database exactly as the `live-aside` step
 * would have.
 */
function arrangeLiveParked(): void {
  renameSync(livePath(), asidePath())
}

describe('restore promotion v2', () => {
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'cs-promote-v2-'))
    mkdirSync(stagingDir(), { recursive: true })
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
    failJournalWrite.when = null
    failResourceRollback.on = false
    failResourceInstall.on = false
    renames.length = 0
    vi.clearAllMocks()
  })

  describe('journal states that must not promote', () => {
    it('does nothing when no journal exists', async () => {
      makeDb(livePath(), 'old')

      await runRestorePromotionV2()

      expect(readMarker(livePath())).toBe('old')
    })

    it('expires an unarmed preparation instead of promoting it', async () => {
      // The user prepared a restore and then simply restarted the app. A
      // preparation is a staged file, not consent (§6.1).
      makeDb(livePath(), 'old')
      makeStagedDb()
      writeRestoreJournalV2(buildJournal({ state: 'prepared' }))

      await runRestorePromotionV2()

      expect(journalState()).toBe('expired')
      expect(readMarker(livePath())).toBe('old')
      expect(existsSync(stagingDir())).toBe(false)
      expect(existsSync(asidePath())).toBe(false)
    })

    it.each(['completed', 'rolled-back', 'failed', 'expired'] as const)(
      'leaves the terminal state %s alone',
      async (state) => {
        makeDb(livePath(), 'old')
        makeStagedDb()
        writeRestoreJournalV2(buildJournal({ state }))

        await runRestorePromotionV2()

        expect(journalState()).toBe(state)
        expect(readMarker(livePath())).toBe('old')
        expect(existsSync(stagedPath())).toBe(true)
      }
    )

    it('fails closed on a journal it cannot parse and preserves all recovery evidence', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      writeFileSync(journalPath(), '{ "version": 3, "state": "future" }')

      await expect(runRestorePromotionV2()).rejects.toThrow(/refusing to discard recovery evidence/)

      expect(readMarker(livePath())).toBe('old')
      expect(existsSync(journalPath())).toBe(true)
      expect(existsSync(stagingDir())).toBe(true)
      expect(isRestoreRecoveryPendingV2()).toBe(true)
    })

    it('refuses to boot on an unreadable journal while the live database sits parked aside', async () => {
      // The crash landed past `live-aside`, and the journal that named the park
      // slot can no longer be parsed. Quarantining would clear the only record
      // of the restore and let the boot go on to CREATE a fresh empty database
      // beside the user's real one — so refuse while every artifact is still
      // where a repair needs it.
      makeDb(asidePath(), 'old')
      makeStagedDb()
      writeFileSync(journalPath(), '{ "version": 1, "state": "staged" }')

      await expect(runRestorePromotionV2()).rejects.toThrow(/refusing to discard recovery evidence/)

      expect(isLiveDbStrandedV2()).toBe(true)
      expect(existsSync(journalPath())).toBe(true)
      expect(readMarker(asidePath())).toBe('old')
      expect(existsSync(stagedPath())).toBe(true)
    })

    it('preserves an unreadable journal even when no parked database can be named', async () => {
      makeStagedDb()
      writeFileSync(journalPath(), '{ not json')

      await expect(runRestorePromotionV2()).rejects.toThrow(/refusing to discard recovery evidence/)

      expect(existsSync(journalPath())).toBe(true)
      expect(existsSync(stagingDir())).toBe(true)
      expect(isRestoreRecoveryPendingV2()).toBe(true)
    })
  })

  /**
   * A terminal outcome that will not persist is not an outcome. The gate must
   * refuse the boot rather than start the app under a journal still describing
   * a restore in flight, keep every artifact the next boot decides from, and —
   * on that next boot — reach the SAME terminal conclusion without moving
   * anything in or out of the live slot.
   */
  describe('a terminal state that never reached the disk', () => {
    /**
     * The disk stopped taking journal writes — a condition of the disk, not of
     * the state being written, so every write fails, including the crash net's
     * own attempt to record a different outcome.
     */
    function noJournalWritesLand(): void {
      failJournalWrite.when = () => true
    }

    async function expectGateRefusesBoot(): Promise<void> {
      await expect(runBackupRestoreGate()).rejects.toThrow(/mixed restore state|empty database/)
    }

    /** Re-run the gate with the fault cleared, proving the retry needs no live rename. */
    async function retryWithoutFault(): Promise<void> {
      failJournalWrite.when = null
      renames.length = 0

      await runBackupRestoreGate()

      // The first boot already did every move this outcome needed; all the
      // retry owes is the marker — whose own write is an atomic tmp rename, and
      // the only rename allowed here.
      expect(renames.filter((move) => !move.includes('restore-journal.json'))).toEqual([])
    }

    it('refuses the boot and retries the same expiry when the expired journal cannot be written', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      writeRestoreJournalV2(buildJournal({ chain: [{ folderMillis: 1, hash: 'forked' }] }))
      const before = recoveryEvidence()
      noJournalWritesLand()

      await expectGateRefusesBoot()

      expect(journalState()).toBe('armed')
      expect(readMarker(livePath())).toBe('old')
      expect(recoveryEvidence()).toEqual(before)

      await retryWithoutFault()

      expect(journalState()).toBe('expired')
      expect(readMarker(livePath())).toBe('old')
      expect(existsSync(stagingDir())).toBe(false)
    })

    it('refuses the boot and retries the same completion when the completed journal cannot be written', async () => {
      // Past the commit: the new database is already live, so the retry has
      // only the marker left to write.
      makeDb(asidePath(), 'old')
      makeDb(livePath(), 'new')
      writeRestoreJournalV2(buildJournal({ state: 'promoting', step: 'db-promoted', chain: chainOf(livePath()) }))
      const before = recoveryEvidence()
      noJournalWritesLand()

      await expectGateRefusesBoot()

      expect(journalState()).toBe('promoting')
      expect(readMarker(livePath())).toBe('new')
      expect(readMarker(asidePath())).toBe('old')
      expect(recoveryEvidence()).toEqual(before)

      await retryWithoutFault()

      expect(journalState()).toBe('completed')
      expect(readMarker(livePath())).toBe('new')
      expect(readMarker(asidePath())).toBe('old')
    })

    it('refuses the boot and retries the same failure when a pre-commit rollback cannot be written', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      writeRestoreJournalV2(buildJournal({ state: 'promoting', step: 'resources-installed' }))
      const journalBefore = readFileSync(journalPath()).toString('base64')
      noJournalWritesLand()

      await expectGateRefusesBoot()

      // The staged database is discarded by the rollback itself, not by the
      // terminal write — the journal and the protected tree are what must stay.
      expect(journalState()).toBe('promoting')
      expect(readMarker(livePath())).toBe('old')
      expect(readFileSync(journalPath()).toString('base64')).toBe(journalBefore)
      expect(existsSync(stagingDir())).toBe(true)

      await retryWithoutFault()

      expect(journalState()).toBe('failed')
      expect(readMarker(livePath())).toBe('old')
      expect(existsSync(stagingDir())).toBe(false)
    })

    it('refuses the boot and retries the same rollback when the rolled-back journal cannot be written', async () => {
      makeDb(livePath(), 'old')
      makeDb(join(userData, `restore-failed-${RID}.sqlite`), 'new')
      makeStagedDb()
      writeRestoreJournalV2(
        buildJournal({ state: 'rollback-armed', chain: chainOf(join(userData, `restore-failed-${RID}.sqlite`)) })
      )
      const before = recoveryEvidence()
      noJournalWritesLand()

      await expectGateRefusesBoot()

      expect(journalState()).toBe('rollback-armed')
      expect(readMarker(livePath())).toBe('old')
      expect(recoveryEvidence()).toEqual(before)

      await retryWithoutFault()

      expect(journalState()).toBe('rolled-back')
      expect(readMarker(livePath())).toBe('old')
      expect(readMarker(join(userData, `restore-failed-${RID}.sqlite`))).toBe('new')
    })

    it('writes the expiry of an unarmed preparation before dropping its staging tree', async () => {
      // Reverse order would delete a tree the on-disk journal still describes
      // as preparable — and a write that then failed would leave it pointing at
      // nothing.
      makeDb(livePath(), 'old')
      makeStagedDb()
      writeRestoreJournalV2(buildJournal({ state: 'prepared' }))
      const stagingAtWrite: boolean[] = []
      failJournalWrite.when = (journal) => {
        if (journal.state === 'expired') stagingAtWrite.push(existsSync(stagedPath()))
        return false
      }

      await runRestorePromotionV2()

      expect(stagingAtWrite).toEqual([true])
      expect(journalState()).toBe('expired')
      expect(existsSync(stagingDir())).toBe(false)
    })
  })

  describe('armed promotion', () => {
    it('replaces the live database and parks the previous one aside', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      writeRestoreJournalV2(buildJournal())

      await runRestorePromotionV2()

      expect(journalState()).toBe('completed')
      expect(readMarker(livePath())).toBe('new')
      // Retained until acknowledgement (§6.5) — this is the rollback source.
      expect(readMarker(asidePath())).toBe('old')
      expect(existsSync(stagingDir())).toBe(false)
    })

    it('carries the live WAL into the aside (no fingerprint means the checkpoint is the only guarantee)', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      // Dirty-exit simulation: commit a row, preserve the (main, -wal) pair from
      // BEFORE the clean close, then put it back — committed data left in WAL.
      const sqlite = new Database(livePath())
      sqlite.pragma('journal_mode = WAL')
      sqlite.prepare("INSERT INTO app_state (key, value, created_at, updated_at) VALUES ('wal-row', '1', 0, 0)").run()
      copyFileSync(livePath(), `${livePath()}.dirty`)
      copyFileSync(`${livePath()}-wal`, `${livePath()}.dirty-wal`)
      sqlite.close()
      renameSync(`${livePath()}.dirty`, livePath())
      renameSync(`${livePath()}.dirty-wal`, `${livePath()}-wal`)
      writeRestoreJournalV2(buildJournal())

      await runRestorePromotionV2()

      expect(journalState()).toBe('completed')
      expect(readMarker(livePath())).toBe('new')
      // The rename moves the main file alone; without the §6.2 checkpoint this
      // committed row would have been thrown away with the sidecar.
      expect(hasRow(asidePath(), 'wal-row')).toBe(true)
      expect(existsSync(`${livePath()}-wal`)).toBe(false)
    })

    it('refuses a journal whose chain is not a prefix of the bundled one', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      writeRestoreJournalV2(buildJournal({ chain: [{ folderMillis: 1, hash: 'forked' }] }))

      await runRestorePromotionV2()

      expect(journalState()).toBe('expired')
      expect(readMarker(livePath())).toBe('old')
      expect(existsSync(stagingDir())).toBe(false)
    })

    it('refuses a staged database that still carries a sidecar', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      const journal = buildJournal()
      // The gate renames the main file only, so committed rows sitting in this
      // WAL would vanish. Refuse rather than guess what they were.
      writeFileSync(`${stagedPath()}-wal`, 'leftover')
      writeRestoreJournalV2(journal)

      await runRestorePromotionV2()

      expect(journalState()).toBe('expired')
      expect(readMarker(livePath())).toBe('old')
    })

    it('refuses to promote when there is no live database to replace', async () => {
      makeStagedDb()
      writeRestoreJournalV2(buildJournal())

      await runRestorePromotionV2()

      // Promoting into an empty slot would break the recovery model's reading of
      // "live present, aside absent" and leave no rollback target.
      expect(journalState()).toBe('expired')
      expect(existsSync(livePath())).toBe(false)
    })

    it('reverts to the old database when the promoted one fails its integrity check', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      const journal = buildJournal()
      // Chain lives in the journal, so a garbage file passes admission and is
      // only caught post-commit — exactly the case the revert path exists for.
      writeFileSync(stagedPath(), 'not a database')
      writeRestoreJournalV2(journal)

      await runRestorePromotionV2()

      expect(journalState()).toBe('failed')
      expect(readMarker(livePath())).toBe('old')
      expect(existsSync(asidePath())).toBe(false)
      expect(existsSync(join(userData, `restore-failed-${RID}.sqlite`))).toBe(true)
    })

    it('does not reverse a committed database before the reverting marker is durable', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      const stagedChain = chainOf(stagedPath())
      writeFileSync(stagedPath(), 'not a database')
      writeRestoreJournalV2(buildJournal({ chain: stagedChain }))
      failJournalWrite.when = (candidate) => candidate.state === 'reverting'

      await expect(runRestorePromotionV2()).rejects.toThrow(/state 'reverting'/)

      expect(journalState()).toBe('promoting')
      expect(readFileSync(livePath(), 'utf8')).toBe('not a database')
      expect(readMarker(asidePath())).toBe('old')
    })

    it('keeps a durable reverse direction if power fails after the old database returns', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      const stagedChain = chainOf(stagedPath())
      writeFileSync(stagedPath(), 'not a database')
      writeRestoreJournalV2(buildJournal({ chain: stagedChain }))
      failJournalWrite.when = (candidate) => candidate.state === 'failed'

      await expect(runRestorePromotionV2()).rejects.toThrow(/terminal 'failed' journal is not durable/)

      expect(journalState()).toBe('reverting')
      expect(readMarker(livePath())).toBe('old')
      expect(readFileSync(join(userData, `restore-failed-${RID}.sqlite`), 'utf8')).toBe('not a database')
      expect(hasPendingRestore()).toBe(true)

      failJournalWrite.when = null
      await runRestorePromotionV2()

      expect(journalState()).toBe('failed')
      expect(readMarker(livePath())).toBe('old')
    })
  })

  describe('explicit rollback of a completed restore', () => {
    const parkedPath = () => join(userData, `restore-failed-${RID}.sqlite`)

    it('moves the previous database back and retains the displaced restored database', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      writeRestoreJournalV2(buildJournal())
      await runRestorePromotionV2()
      const completed = readRestoreJournalV2()
      if (completed.kind !== 'ok' || completed.journal.state !== 'completed')
        throw new Error('promotion did not complete')
      const restored = new Database(livePath())
      restored
        .prepare("INSERT INTO app_state (key, value, created_at, updated_at) VALUES ('post-restore', '1', 0, 0)")
        .run()
      restored.close()
      writeRestoreJournalV2({ ...completed.journal, state: 'rollback-armed' })

      await runRestorePromotionV2()

      expect(journalState()).toBe('rolled-back')
      expect(readMarker(livePath())).toBe('old')
      expect(readMarker(parkedPath())).toBe('new')
      expect(hasRow(parkedPath(), 'post-restore')).toBe(true)
      expect(hasRow(livePath(), 'post-restore')).toBe(false)
      expect(existsSync(asidePath())).toBe(false)
      expect(hasPendingRestore()).toBe(true)
    })

    it('resumes after the restored database was parked but before the previous database returned', async () => {
      makeDb(asidePath(), 'old')
      makeDb(parkedPath(), 'new')
      makeStagedDb()
      writeRestoreJournalV2(buildJournal({ state: 'rollback-armed', chain: chainOf(parkedPath()) }))

      await runRestorePromotionV2()

      expect(journalState()).toBe('rolled-back')
      expect(readMarker(livePath())).toBe('old')
      expect(readMarker(parkedPath())).toBe('new')
      expect(existsSync(asidePath())).toBe(false)
    })

    it('resumes after the previous database returned but before the terminal marker landed', async () => {
      makeDb(livePath(), 'old')
      makeDb(parkedPath(), 'new')
      makeStagedDb()
      writeRestoreJournalV2(buildJournal({ state: 'rollback-armed', chain: chainOf(parkedPath()) }))

      await runRestorePromotionV2()

      expect(journalState()).toBe('rolled-back')
      expect(readMarker(livePath())).toBe('old')
      expect(readMarker(parkedPath())).toBe('new')
    })

    it('refuses a database path redirected after the restore completed', async () => {
      makeDb(asidePath(), 'old')
      const outside = join(userData, 'outside.sqlite')
      makeDb(outside, 'new')
      symlinkSync(outside, livePath())
      makeStagedDb()
      writeRestoreJournalV2(buildJournal({ state: 'rollback-armed', chain: chainOf(outside) }))

      await expect(runRestorePromotionV2()).rejects.toThrow(/not a regular file/)

      expect(journalState()).toBe('rollback-armed')
      expect(readMarker(outside)).toBe('new')
      expect(readMarker(asidePath())).toBe('old')
    })

    it('keeps rollback armed and all data when the terminal journal write fails', async () => {
      makeDb(livePath(), 'old')
      makeDb(parkedPath(), 'new')
      makeStagedDb()
      writeRestoreJournalV2(buildJournal({ state: 'rollback-armed', chain: chainOf(parkedPath()) }))
      failJournalWrite.when = (journal) => journal.state === 'rolled-back'

      await expect(runRestorePromotionV2()).rejects.toThrow("simulated journal write failure for state 'rolled-back'")

      expect(journalState()).toBe('rollback-armed')
      expect(readMarker(livePath())).toBe('old')
      expect(readMarker(parkedPath())).toBe('new')
      expect(hasPendingRestore()).toBe(true)
    })
  })

  describe('crash recovery', () => {
    it('rolls back a crash before the live database was parked', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      writeRestoreJournalV2(buildJournal({ state: 'promoting', step: 'live-checkpointed' }))

      await runRestorePromotionV2()

      expect(journalState()).toBe('failed')
      expect(readMarker(livePath())).toBe('old')
      expect(existsSync(stagingDir())).toBe(false)
    })

    it('never deletes the live database when the staged one is already gone (the uninstall row)', async () => {
      // pre-commit, staged absent, live present, aside absent. The generic unit
      // table would call this "an installed backup with no aside → remove it";
      // for the DB unit that would delete the user's database.
      makeDb(livePath(), 'old')
      writeRestoreJournalV2(
        buildJournal({
          state: 'promoting',
          step: 'live-checkpointed',
          chain: chainOf(livePath())
        })
      )

      await runRestorePromotionV2()

      expect(journalState()).toBe('failed')
      expect(readMarker(livePath())).toBe('old')
    })

    it('restores the aside when the crash landed between parking and promoting', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      arrangeLiveParked()
      writeRestoreJournalV2(buildJournal({ state: 'promoting', step: 'live-aside' }))

      await runRestorePromotionV2()

      expect(journalState()).toBe('failed')
      expect(readMarker(livePath())).toBe('old')
      expect(existsSync(asidePath())).toBe(false)
      expect(existsSync(stagingDir())).toBe(false)
    })

    it('resumes forward when the commit rename outran its own marker', async () => {
      // The marker is written AFTER the action, so `live-aside` with the staged
      // file gone and both live and aside present can only mean the commit
      // landed. Rolling back here would discard a database that is already live.
      makeDb(asidePath(), 'old')
      makeDb(livePath(), 'new')
      const journal = buildJournal({
        state: 'promoting',
        step: 'live-aside',
        chain: chainOf(livePath())
      })
      writeRestoreJournalV2(journal)

      await runRestorePromotionV2()

      expect(journalState()).toBe('completed')
      expect(readMarker(livePath())).toBe('new')
      expect(readMarker(asidePath())).toBe('old')
    })

    it('finishes a crash at the commit point', async () => {
      makeDb(asidePath(), 'old')
      makeDb(livePath(), 'new')
      writeRestoreJournalV2(
        buildJournal({
          state: 'promoting',
          step: 'db-promoted',
          chain: chainOf(livePath())
        })
      )

      await runRestorePromotionV2()

      expect(journalState()).toBe('completed')
      expect(readMarker(livePath())).toBe('new')
    })

    it('re-runs the commit rename when the marker claims committed but the staged DB is still there', async () => {
      makeDb(asidePath(), 'old')
      makeStagedDb()
      writeRestoreJournalV2(buildJournal({ state: 'promoting', step: 'db-promoted' }))

      await runRestorePromotionV2()

      expect(journalState()).toBe('completed')
      expect(readMarker(livePath())).toBe('new')
    })

    it('fails closed on a state the algorithm cannot produce, keeping the artifacts', async () => {
      // committed with both the staged DB and a live node present: `live` cannot
      // be proven to be the promoted database, so nothing may be moved.
      makeDb(livePath(), 'old')
      makeStagedDb()
      writeRestoreJournalV2(buildJournal({ state: 'promoting', step: 'db-promoted' }))

      await expect(runRestorePromotionV2()).rejects.toThrow(/inconsistent/)

      expect(journalState()).toBe('promoting')
      expect(readMarker(livePath())).toBe('old')
      // Evidence, not garbage: repair needs the staged database.
      expect(existsSync(stagedPath())).toBe(true)
    })
  })

  describe('escaped-crash net', () => {
    it('reports a stranded database and puts it back', () => {
      makeDb(asidePath(), 'old')
      writeRestoreJournalV2(
        buildJournal({
          state: 'promoting',
          step: 'live-aside',
          chain: chainOf(asidePath())
        })
      )

      expect(isLiveDbStrandedV2()).toBe(true)

      markRestoreFailedAfterCrashV2()

      expect(journalState()).toBe('failed')
      expect(readMarker(livePath())).toBe('old')
      expect(isLiveDbStrandedV2()).toBe(false)
    })

    it('leaves a committed promotion resumable rather than freezing it to failed', () => {
      makeDb(asidePath(), 'old')
      makeDb(livePath(), 'new')
      writeRestoreJournalV2(
        buildJournal({
          state: 'promoting',
          step: 'db-promoted',
          chain: chainOf(livePath())
        })
      )

      markRestoreFailedAfterCrashV2()

      expect(journalState()).toBe('promoting')
      expect(readMarker(livePath())).toBe('new')
    })
  })

  describe('resource installation', () => {
    const BASE_REL = 'Data/KnowledgeBase/base-1'

    /** One Knowledge base unit, exactly as preparation seals it into the journal. */
    function baseUnit(hadLive = true): RestoreJournalV2['resourceInstalls'][number] {
      return {
        resourceType: 'directory',
        staging: `restore-staging/${RID}/resources/${BASE_REL}`,
        live: BASE_REL,
        aside: `restore-aside/${RID}/0-base-1`,
        // Whether preparation found a base to replace. Every arrangement below
        // that creates `unit.live` up front is a replacement, so `true` is the
        // default; the install-over-nothing cases pass `false`.
        hadLive
      }
    }

    function makeUnitDir(relative: string, content: string): void {
      const dir = join(userData, ...relative.split('/'))
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'doc.txt'), content)
    }

    function readUnitDir(relative: string): string {
      return readFileSync(join(userData, ...relative.split('/'), 'doc.txt'), 'utf8')
    }

    function unitExists(relative: string): boolean {
      return existsSync(join(userData, ...relative.split('/')))
    }

    /** Whether the failed journal on disk still claims outstanding repair work. */
    function recoveryIncomplete(): boolean {
      const read = readRestoreJournalV2()
      if (read.kind !== 'ok' || read.journal.state !== 'failed') throw new Error(`not failed: ${journalState()}`)
      return read.journal.recoveryIncomplete === true
    }

    /** Whether the completed journal on disk still claims an unfinished install. */
    function resourcesIncomplete(): boolean {
      const read = readRestoreJournalV2()
      if (read.kind !== 'ok' || read.journal.state !== 'completed') throw new Error(`not completed: ${journalState()}`)
      return read.journal.resourcesIncomplete === true
    }

    function completedSummary(): string[] {
      const read = readRestoreJournalV2()
      if (read.kind !== 'ok' || read.journal.state !== 'completed') throw new Error(`not completed: ${journalState()}`)
      return [...read.journal.summary.knowledgeBaseIds]
    }

    it('installs the archive resources and records what it installed', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      const unit = baseUnit()
      makeUnitDir(unit.staging, 'ARCHIVE')
      makeUnitDir(unit.live, 'TARGET')
      writeRestoreJournalV2(buildJournal({ resourceInstalls: [unit] }))

      await runRestorePromotionV2()

      expect(journalState()).toBe('completed')
      expect(readMarker(livePath())).toBe('new')
      expect(readUnitDir(unit.live)).toBe('ARCHIVE')
      // Same rollback material as the database aside, released together (§6.5).
      expect(readUnitDir(unit.aside)).toBe('TARGET')
      expect(completedSummary()).toEqual(['base-1'])
    })

    it('rolls replaced resource units back without deleting either side', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      const unit = baseUnit()
      makeUnitDir(unit.staging, 'ARCHIVE')
      makeUnitDir(unit.live, 'TARGET')
      writeRestoreJournalV2(buildJournal({ resourceInstalls: [unit] }))
      await runRestorePromotionV2()
      const completed = readRestoreJournalV2()
      if (completed.kind !== 'ok' || completed.journal.state !== 'completed')
        throw new Error('promotion did not complete')
      writeRestoreJournalV2({ ...completed.journal, state: 'rollback-armed' })

      await runRestorePromotionV2()

      expect(journalState()).toBe('rolled-back')
      expect(readMarker(livePath())).toBe('old')
      expect(readUnitDir(unit.live)).toBe('TARGET')
      expect(readUnitDir(unit.staging)).toBe('ARCHIVE')
      expect(unitExists(unit.aside)).toBe(false)
      expect(readMarker(join(userData, `restore-failed-${RID}.sqlite`))).toBe('new')
    })

    it('rolls the resources back out when the promotion fails after the commit', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      const unit = baseUnit()
      makeUnitDir(unit.staging, 'ARCHIVE')
      makeUnitDir(unit.live, 'TARGET')
      const journal = buildJournal({ resourceInstalls: [unit] })
      // Garbage passes admission (the chain lives in the journal) and is caught
      // by the post-commit integrity check — a database rollback the resources
      // must follow, or the restore ends half applied.
      writeFileSync(stagedPath(), 'not a database')
      writeRestoreJournalV2(journal)

      await runRestorePromotionV2()

      expect(journalState()).toBe('failed')
      expect(readMarker(livePath())).toBe('old')
      expect(readUnitDir(unit.live)).toBe('TARGET')
      expect(unitExists(unit.aside)).toBe(false)
    })

    it('keeps the new database live until a blocked post-commit resource reverse can finish', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      const stagedChain = chainOf(stagedPath())
      const unit = baseUnit()
      makeUnitDir(unit.staging, 'ARCHIVE')
      makeUnitDir(unit.live, 'TARGET')
      writeFileSync(stagedPath(), 'not a database')
      writeRestoreJournalV2(buildJournal({ chain: stagedChain, resourceInstalls: [unit] }))
      failResourceRollback.on = true

      await expect(runRestorePromotionV2()).rejects.toThrow(/EPERM/)

      expect(journalState()).toBe('reverting')
      expect(readFileSync(livePath(), 'utf8')).toBe('not a database')
      expect(readMarker(asidePath())).toBe('old')
      expect(readUnitDir(unit.live)).toBe('ARCHIVE')
      expect(readUnitDir(unit.aside)).toBe('TARGET')

      failResourceRollback.on = false
      await runRestorePromotionV2()

      expect(journalState()).toBe('failed')
      expect(readMarker(livePath())).toBe('old')
      expect(readUnitDir(unit.live)).toBe('TARGET')
    })

    it('rolls back a crash that landed between installing the resources and parking the database', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      const unit = baseUnit()
      // The install ran: the archive copy is live and the target is parked.
      makeUnitDir(unit.live, 'ARCHIVE')
      makeUnitDir(unit.aside, 'TARGET')
      writeRestoreJournalV2(
        buildJournal({
          state: 'promoting',
          step: 'resources-installed',
          resourceInstalls: [unit]
        })
      )

      await runRestorePromotionV2()

      expect(journalState()).toBe('failed')
      expect(readMarker(livePath())).toBe('old')
      expect(readUnitDir(unit.live)).toBe('TARGET')
      expect(unitExists(unit.aside)).toBe(false)
    })

    /**
     * `-L-` — live present, nothing staged, no aside — is the one triple whose
     * meaning the filesystem cannot settle: either the target was originally
     * absent (so `live` is the archive's copy and belongs back in staging), or
     * the aside holding the user's original is gone (so `live` is all that is
     * left of it). `hadLive` is what tells the two apart.
     */
    describe('what the missing aside means', () => {
      it('takes the archive copy back out when the journal proves nothing was replaced', async () => {
        makeDb(livePath(), 'old')
        makeStagedDb()
        const unit = baseUnit(false)
        makeUnitDir(unit.live, 'ARCHIVE')
        writeRestoreJournalV2(
          buildJournal({ state: 'promoting', step: 'resources-installed', resourceInstalls: [unit] })
        )

        await runRestorePromotionV2()

        expect(journalState()).toBe('failed')
        // Out of the live slot and back into staging, which the terminal
        // cleanup then collects along with the rest of the tree.
        expect(unitExists(unit.live)).toBe(false)
        expect(existsSync(stagingDir())).toBe(false)
      })

      it('refuses to remove the only copy left when the journal says a target was replaced', async () => {
        makeDb(livePath(), 'old')
        makeStagedDb()
        const unit = baseUnit(true)
        // The aside that held the user's base is gone — deleted by hand, lost to
        // a sweep, whatever. Rolling the unit back out now would leave nothing.
        makeUnitDir(unit.live, 'ARCHIVE')
        writeRestoreJournalV2(
          buildJournal({ state: 'promoting', step: 'resources-installed', resourceInstalls: [unit] })
        )

        await expect(runBackupRestoreGate()).rejects.toThrow(/mixed restore state/)

        expect(readUnitDir(unit.live)).toBe('ARCHIVE')
        expect(journalState()).toBe('promoting')
      })

      it('keeps the old reading for a journal that predates the record, so forward crashes still resolve', async () => {
        makeDb(livePath(), 'old')
        makeStagedDb()
        const { hadLive: _hadLive, ...unit } = baseUnit(false)
        makeUnitDir(unit.live, 'ARCHIVE')
        writeRestoreJournalV2(
          buildJournal({ state: 'promoting', step: 'resources-installed', resourceInstalls: [unit] })
        )

        await runRestorePromotionV2()

        expect(journalState()).toBe('failed')
        expect(readMarker(livePath())).toBe('old')
      })
    })

    describe('a journal from a build that never recorded what it replaced', () => {
      /** The same two-unit arrangement, minus the field the older build never wrote. */
      function legacyUnits(): RestoreJournalV2['resourceInstalls'] {
        const { hadLive: _hadLive, ...unit } = baseUnit()
        return [unit]
      }

      it('boots normally on a completed restore and leaves it usable', async () => {
        makeDb(livePath(), 'new')
        makeDb(asidePath(), 'old')
        const units = legacyUnits()
        makeUnitDir(units[0].live, 'ARCHIVE')
        makeUnitDir(units[0].aside, 'TARGET')
        writeRestoreJournalV2(buildJournal({ state: 'completed', chain: chainOf(livePath()), resourceInstalls: units }))

        // Only the rollback is withheld (armRestoreRollback refuses it); the
        // restored profile itself is in no way suspect.
        await expect(runBackupRestoreGate()).resolves.toBeUndefined()

        expect(journalState()).toBe('completed')
        expect(readMarker(livePath())).toBe('new')
        expect(readUnitDir(units[0].live)).toBe('ARCHIVE')
      })

      it('refuses to boot an armed rollback rather than guess at the reverse pass', async () => {
        makeDb(livePath(), 'new')
        makeDb(asidePath(), 'old')
        const units = legacyUnits()
        makeUnitDir(units[0].live, 'ARCHIVE')
        makeUnitDir(units[0].aside, 'TARGET')
        writeRestoreJournalV2(
          buildJournal({ state: 'rollback-armed', chain: chainOf(livePath()), resourceInstalls: units })
        )

        await expect(runBackupRestoreGate()).rejects.toThrow(/mixed restore state/)

        expect(journalState()).toBe('rollback-armed')
        expect(readMarker(livePath())).toBe('new')
        expect(readMarker(asidePath())).toBe('old')
        expect(readUnitDir(units[0].live)).toBe('ARCHIVE')
        expect(readUnitDir(units[0].aside)).toBe('TARGET')
      })
    })

    it('converges a crash that reversed one unit but not the next', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      const done = baseUnit()
      const pending: RestoreJournalV2['resourceInstalls'][number] = {
        resourceType: 'directory',
        staging: `restore-staging/${RID}/resources/Data/KnowledgeBase/base-2`,
        live: 'Data/KnowledgeBase/base-2',
        aside: `restore-aside/${RID}/1-base-2`,
        hadLive: true
      }
      // The rollback pass got through the first unit and crashed: its original
      // is back and the archive copy is parked in staging, while the second unit
      // is still installed with its original in the aside.
      makeUnitDir(done.live, 'TARGET')
      makeUnitDir(done.staging, 'ARCHIVE')
      makeUnitDir(pending.live, 'ARCHIVE')
      makeUnitDir(pending.aside, 'TARGET')
      writeRestoreJournalV2(
        buildJournal({ state: 'promoting', step: 'resources-installed', resourceInstalls: [done, pending] })
      )

      await runRestorePromotionV2()

      expect(journalState()).toBe('failed')
      expect(readMarker(livePath())).toBe('old')
      expect(readUnitDir(done.live)).toBe('TARGET')
      expect(readUnitDir(pending.live)).toBe('TARGET')
      expect(unitExists(pending.aside)).toBe(false)
    })

    it('keeps the installed resources when the crash landed past the commit', async () => {
      makeDb(asidePath(), 'old')
      makeDb(livePath(), 'new')
      const unit = baseUnit()
      makeUnitDir(unit.live, 'ARCHIVE')
      makeUnitDir(unit.aside, 'TARGET')
      writeRestoreJournalV2(
        buildJournal({
          state: 'promoting',
          step: 'db-promoted',
          chain: chainOf(livePath()),
          resourceInstalls: [unit]
        })
      )

      await runRestorePromotionV2()

      expect(journalState()).toBe('completed')
      expect(readUnitDir(unit.live)).toBe('ARCHIVE')
      expect(readUnitDir(unit.aside)).toBe('TARGET')
      expect(completedSummary()).toEqual(['base-1'])
    })

    it('refuses the whole restore when a resource target cannot be installed', async () => {
      // A symlink appeared where the base belongs AFTER preparation vetted it.
      // The install runs before the commit precisely so this still has the old
      // database to fall back to.
      makeDb(livePath(), 'old')
      makeStagedDb()
      const unit = baseUnit()
      makeUnitDir(unit.staging, 'ARCHIVE')
      makeUnitDir('outside-target', 'OUTSIDE')
      mkdirSync(join(userData, 'Data', 'KnowledgeBase'), { recursive: true })
      symlinkSync(join(userData, 'outside-target'), join(userData, ...BASE_REL.split('/')))
      writeRestoreJournalV2(buildJournal({ resourceInstalls: [unit] }))

      await runRestorePromotionV2()

      expect(journalState()).toBe('failed')
      expect(readMarker(livePath())).toBe('old')
      expect(readUnitDir('outside-target')).toBe('OUTSIDE')
      expect(unitExists(unit.aside)).toBe(false)
    })

    it('keeps the rolled-back units in staging when the failed journal cannot be written', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      const unit = baseUnit()
      makeUnitDir(unit.live, 'ARCHIVE')
      makeUnitDir(unit.aside, 'TARGET')
      writeRestoreJournalV2(
        buildJournal({
          state: 'promoting',
          step: 'resources-installed',
          resourceInstalls: [unit]
        })
      )
      failJournalWrite.when = (journal) => journal.state === 'failed'

      await expect(runRestorePromotionV2()).rejects.toThrow(/terminal 'failed' journal is not durable/)

      // The rollback itself completed — the original is back in place and the
      // archive copy is parked in staging.
      expect(readMarker(livePath())).toBe('old')
      expect(readUnitDir(unit.live)).toBe('TARGET')
      expect(readUnitDir(unit.staging)).toBe('ARCHIVE')
      // …but the journal still says `promoting`, and dropping the tree now would
      // leave every rolled-back unit at "live present, nothing staged, no aside"
      // — the one triple recovery reads as an installed backup, sending the next
      // boot out to move the user's own directory back out.
      expect(journalState()).toBe('promoting')
      expect(existsSync(stagingDir())).toBe(true)
    })

    it('keeps preboot recovery pending until a blocked rollback completes', async () => {
      makeDb(livePath(), 'old')
      makeStagedDb()
      const unit = baseUnit()
      makeUnitDir(unit.live, 'ARCHIVE')
      makeUnitDir(unit.aside, 'TARGET')
      writeRestoreJournalV2(
        buildJournal({
          state: 'promoting',
          step: 'resources-installed',
          resourceInstalls: [unit]
        })
      )
      failResourceRollback.on = true

      await expect(runRestorePromotionV2()).rejects.toThrow(/EPERM/)

      // Keep the pre-commit direction instead of booting old DB + archive files.
      expect(journalState()).toBe('promoting')
      expect(readMarker(livePath())).toBe('old')
      expect(readUnitDir(unit.live)).toBe('ARCHIVE')
      expect(readUnitDir(unit.aside)).toBe('TARGET')
      expect(existsSync(stagingDir())).toBe(true)
      expect(hasPendingRestore()).toBe(true)

      // Next boot: the OS is no longer refusing the rename.
      failResourceRollback.on = false
      await runRestorePromotionV2()

      expect(journalState()).toBe('failed')
      expect(readUnitDir(unit.live)).toBe('TARGET')
      expect(hasPendingRestore()).toBe(false)
      expect(existsSync(stagingDir())).toBe(false)
    })

    it('keeps preboot recovery pending until a committed install completes', async () => {
      // Crash re-entry past the commit: the database is live, but this unit only
      // got as far as "old copy parked aside, new copy still in staging".
      makeDb(asidePath(), 'old')
      makeDb(livePath(), 'new')
      const unit = baseUnit()
      makeUnitDir(unit.staging, 'ARCHIVE')
      makeUnitDir(unit.aside, 'TARGET')
      writeRestoreJournalV2(
        buildJournal({
          state: 'promoting',
          step: 'db-promoted',
          chain: chainOf(livePath()),
          resourceInstalls: [unit]
        })
      )
      failResourceInstall.on = true

      await expect(runRestorePromotionV2()).rejects.toThrow(/EPERM/)

      // Keep the committed direction and block normal boot until the resource
      // catches up with the already-live restored database.
      expect(journalState()).toBe('promoting')
      expect(readMarker(livePath())).toBe('new')
      expect(unitExists(unit.live)).toBe(false)
      expect(readUnitDir(unit.staging)).toBe('ARCHIVE')
      expect(readUnitDir(unit.aside)).toBe('TARGET')
      expect(existsSync(stagingDir())).toBe(true)
      expect(hasPendingRestore()).toBe(true)

      // Next boot: the OS is no longer refusing the rename.
      failResourceInstall.on = false
      await runRestorePromotionV2()

      expect(journalState()).toBe('completed')
      expect(readUnitDir(unit.live)).toBe('ARCHIVE')
      // Only now is the tree spent — the unit it was holding is in place.
      expect(existsSync(stagingDir())).toBe(false)
    })

    it('keeps the install marker when the retry still cannot put the unit in place', async () => {
      makeDb(livePath(), 'new')
      const unit = baseUnit()
      makeUnitDir(unit.staging, 'ARCHIVE')
      makeUnitDir(unit.aside, 'TARGET')
      writeRestoreJournalV2({
        ...buildJournal({
          state: 'completed',
          resourceInstalls: [unit],
          chain: chainOf(livePath())
        }),
        resourcesIncomplete: true
      } as RestoreJournalV2)
      failResourceInstall.on = true

      await expect(runRestorePromotionV2()).rejects.toThrow(/EPERM/)

      // No progress is not an excuse to release anything or start normal services.
      expect(resourcesIncomplete()).toBe(true)
      expect(isRestoreRecoveryPendingV2()).toBe(true)
      expect(readUnitDir(unit.staging)).toBe('ARCHIVE')
      expect(readUnitDir(unit.aside)).toBe('TARGET')
      expect(existsSync(stagingDir())).toBe(true)
      expect(hasPendingRestore()).toBe(true)
    })

    it('keeps the marker when the retry still cannot finish the rollback', async () => {
      makeDb(livePath(), 'old')
      const unit = baseUnit()
      makeUnitDir(unit.live, 'ARCHIVE')
      makeUnitDir(unit.aside, 'TARGET')
      writeRestoreJournalV2({
        ...buildJournal({
          state: 'failed',
          resourceInstalls: [unit],
          chain: chainOf(livePath())
        }),
        recoveryIncomplete: true
      } as RestoreJournalV2)
      failResourceRollback.on = true

      await expect(runRestorePromotionV2()).rejects.toThrow(/EPERM/)

      // No progress is not an excuse to release anything: protection and the
      // refusal both stand until a boot actually finishes the work.
      expect(recoveryIncomplete()).toBe(true)
      expect(isRestoreRecoveryPendingV2()).toBe(true)
      expect(readUnitDir(unit.live)).toBe('ARCHIVE')
      expect(readUnitDir(unit.aside)).toBe('TARGET')
      expect(hasPendingRestore()).toBe(true)
    })
  })

  it('promotes under a relocated userData through relative paths alone', async () => {
    // runUserDataRelocation copies the whole tree before this gate runs (§6.6).
    makeDb(livePath(), 'old')
    makeStagedDb()
    writeRestoreJournalV2(buildJournal())
    const original = userData
    const relocated = mkdtempSync(join(tmpdir(), 'cs-promote-v2-moved-'))
    cpSync(original, relocated, { recursive: true })
    userData = relocated

    try {
      await runRestorePromotionV2()

      expect(journalState()).toBe('completed')
      expect(readMarker(join(relocated, 'cherrystudio.sqlite'))).toBe('new')
      // The pre-relocation tree is not this gate's business.
      expect(readMarker(join(original, 'cherrystudio.sqlite'))).toBe('old')
    } finally {
      userData = original
      rmSync(relocated, { recursive: true, force: true })
    }
  })
})
