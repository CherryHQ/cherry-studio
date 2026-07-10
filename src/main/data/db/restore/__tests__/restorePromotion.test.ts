import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { applyMigrations } from '@data/db/applyMigrations'
import { readAppliedChain } from '@data/db/restore/appliedChain'
import { hashDbFile } from '@data/db/restore/hashDbFile'
import type * as RestoreJournalModule from '@data/db/restore/restoreJournal'
import type { RestoreJournal } from '@data/db/restore/restoreJournal'
import { readRestoreJournal, writeRestoreJournal } from '@data/db/restore/restoreJournal'
import { isLiveDbStranded, markRestoreFailedAfterCrash, runRestorePromotion } from '@data/db/restore/restorePromotion'
import { appStateTable } from '@data/db/schemas/appState'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Crash matrix for the restore promotion gate.
 *
 * Strategy: fake userData via a shadowed `@application.getPath` (mirrors
 * v2MigrationGate.test.ts), everything else REAL — real SQLite files built by
 * the production applyMigrations, real renames on a real temp FS. Each case
 * ends in one of exactly two states: the old database is intact and live, or
 * the new database is complete and live. No third state may exist.
 */

let userData = ''

/**
 * Journal-write fault injection: the module is passed through untouched except
 * writeRestoreJournal, which throws when the predicate matches the journal
 * being written. Lets cases fail exactly one marker write (e.g. the commit
 * step's) while every other write — fixtures included — stays real.
 */
const markerFailure = vi.hoisted(() => ({
  shouldFail: null as ((journal: { state: string; step?: string }) => boolean) | null
}))

vi.mock('@data/db/restore/restoreJournal', async (importOriginal) => {
  const actual = await importOriginal<typeof RestoreJournalModule>()
  return {
    ...actual,
    writeRestoreJournal: (journal: RestoreJournal) => {
      if (markerFailure.shouldFail?.(journal)) {
        throw new Error('injected journal write failure')
      }
      actual.writeRestoreJournal(journal)
    }
  }
})

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn((key: string, filename?: string) => {
      const bases: Record<string, string> = {
        'app.userdata': userData,
        'app.database.file': join(userData, 'cherrystudio.sqlite'),
        'app.database.migrations': resolveMigrationsPath(),
        'feature.backup.restore.file': join(userData, 'restore-journal.json'),
        'feature.backup.restore.staging': join(userData, 'restore-staging')
      }
      const base = bases[key]
      if (!base) throw new Error(`Unexpected path key in restorePromotion test: ${key}`)
      return filename ? join(base, filename) : base
    })
  }
}))

const RID = 'restore-t1'
const MARKER_KEY = 'restore-test-marker'

const livePath = () => join(userData, 'cherrystudio.sqlite')
const asideRel = `cherrystudio.sqlite.pre-restore-${RID}`
const asidePath = () => join(userData, asideRel)
const workRel = `restore-staging/${RID}/work.sqlite`
const workPath = () => join(userData, workRel)
const stagingDir = () => join(userData, 'restore-staging', RID)
const journalPath = () => join(userData, 'restore-journal.json')

/** Create a migrated, sealed (cleanly closed ⇒ no -wal) DB with a marker row. */
function makeDb(dbPath: string, which: 'old' | 'new'): void {
  mkdirSync(dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle({ client: sqlite, casing: 'snake_case' })
  applyMigrations(db, resolveMigrationsPath())
  db.insert(appStateTable).values({ key: MARKER_KEY, value: { which } }).run()
  sqlite.close()
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
  state?: RestoreJournal['state']
  step?: Extract<RestoreJournal, { state: 'promoting' }>['step']
  fingerprint?: string
  chain?: Array<{ folderMillis: number; hash: string }>
  fileResources?: RestoreJournal['fileResources']
}

async function buildJournal(overrides: JournalOverrides = {}): Promise<RestoreJournal> {
  const base = {
    version: 1 as const,
    restoreId: RID,
    createdAt: '2026-07-09T12:00:00.000Z',
    db: {
      promote: workRel,
      aside: asideRel,
      fingerprint: overrides.fingerprint ?? (await hashDbFile(livePath())),
      chain: overrides.chain ?? chainOf(workPath())
    },
    fileResources: overrides.fileResources ?? []
  }
  const state = overrides.state ?? 'staged'
  if (state === 'staged') return { ...base, state }
  if (state === 'promoting') return { ...base, state, step: overrides.step ?? 'gate-passed' }
  return { ...base, state, step: overrides.step }
}

/** Standard manifest exercising every kind: additive blob + KB dir, plus per-entry note add/overwrite. */
function standardManifest(): RestoreJournal['fileResources'] {
  return [
    {
      kind: 'blob-add',
      stagingPath: `restore-staging/${RID}/files/blob-1`,
      livePath: 'Data/Files/blob-1'
    },
    {
      kind: 'dir-add',
      stagingPath: `restore-staging/${RID}/kb/base-1`,
      livePath: 'Data/KnowledgeBase/base-1'
    },
    {
      kind: 'note-add',
      stagingPath: `restore-staging/${RID}/notes/added.md`,
      livePath: 'Notes/added.md'
    },
    {
      kind: 'note-overwrite',
      stagingPath: `restore-staging/${RID}/notes/note.md`,
      livePath: 'Notes/note.md',
      asidePath: `restore-aside/${RID}/note.md`
    }
  ]
}

function seedManifestFixtures(): void {
  // Staged copies
  mkdirSync(join(stagingDir(), 'files'), { recursive: true })
  writeFileSync(join(stagingDir(), 'files', 'blob-1'), 'BLOB-NEW')
  mkdirSync(join(stagingDir(), 'kb', 'base-1'), { recursive: true })
  writeFileSync(join(stagingDir(), 'kb', 'base-1', 'chunk.bin'), 'KB-NEW')
  mkdirSync(join(stagingDir(), 'notes'), { recursive: true })
  writeFileSync(join(stagingDir(), 'notes', 'note.md'), 'NOTE-NEW')
  writeFileSync(join(stagingDir(), 'notes', 'added.md'), 'NOTE-ADDED')
  // Live originals
  mkdirSync(join(userData, 'Notes'), { recursive: true })
  writeFileSync(join(userData, 'Notes', 'note.md'), 'NOTE-OLD')
  mkdirSync(join(userData, 'Data', 'Files'), { recursive: true })
}

const liveBlob = () => join(userData, 'Data', 'Files', 'blob-1')
const liveKbDir = () => join(userData, 'Data', 'KnowledgeBase', 'base-1')
const liveAddedNote = () => join(userData, 'Notes', 'added.md')
const liveNote = () => join(userData, 'Notes', 'note.md')
const noteAside = () => join(userData, 'restore-aside', RID, 'note.md')

/** Crash arrangement helper: the additive step (blob + KB dir moved staging→live) already ran. */
function arrangeAdditiveMoved(): void {
  renameSync(join(stagingDir(), 'files', 'blob-1'), liveBlob())
  mkdirSync(dirname(liveKbDir()), { recursive: true })
  renameSync(join(stagingDir(), 'kb', 'base-1'), liveKbDir())
}

function journalState(): string {
  const read = readRestoreJournal()
  if (read.kind !== 'ok') throw new Error(`expected readable journal, got ${read.kind}`)
  return read.journal.state
}

describe('runRestorePromotion', () => {
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'cs-restore-promotion-'))
    markerFailure.shouldFail = null
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('does nothing and creates nothing when no journal exists (zero-cost early exit)', async () => {
    await runRestorePromotion()

    expect(readdirSync(userData)).toEqual([])
  })

  it('returns without touching anything on a terminal journal', async () => {
    makeDb(livePath(), 'old')
    // Terminal journals are never gate-checked, so no work DB is needed.
    writeRestoreJournal(await buildJournal({ state: 'expired', chain: [{ folderMillis: 1, hash: 'x' }] }))

    await runRestorePromotion()

    expect(journalState()).toBe('expired')
    expect(readMarker(livePath())).toBe('old')
  })

  it('promotes a valid staged restore end to end (DB swap + manifest + terminal journal)', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    seedManifestFixtures()
    writeRestoreJournal(await buildJournal({ fileResources: standardManifest() }))

    await runRestorePromotion()

    // New DB is live; old DB is the undo aside.
    expect(readMarker(livePath())).toBe('new')
    expect(readMarker(asidePath())).toBe('old')
    // Manifest applied: blob + KB dir moved in, note added, note overwritten
    // with its original parked aside.
    expect(readFileSync(liveBlob(), 'utf8')).toBe('BLOB-NEW')
    expect(readFileSync(join(liveKbDir(), 'chunk.bin'), 'utf8')).toBe('KB-NEW')
    expect(readFileSync(liveAddedNote(), 'utf8')).toBe('NOTE-ADDED')
    expect(readFileSync(liveNote(), 'utf8')).toBe('NOTE-NEW')
    expect(readFileSync(noteAside(), 'utf8')).toBe('NOTE-OLD')
    // Terminal bookkeeping: journal completed, staging tree gone.
    expect(journalState()).toBe('completed')
    expect(existsSync(stagingDir())).toBe(false)
  })

  it('expires when the live fingerprint drifted (write-gate leak simulation)', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    writeRestoreJournal(await buildJournal())
    // Mutate live AFTER the journal captured its fingerprint.
    const sqlite = new Database(livePath())
    sqlite.prepare("INSERT INTO app_state (key, value, created_at, updated_at) VALUES ('drift', '1', 0, 0)").run()
    sqlite.close()

    await runRestorePromotion()

    expect(journalState()).toBe('expired')
    expect(readMarker(livePath())).toBe('old')
    expect(hasRow(livePath(), 'drift')).toBe(true)
    expect(existsSync(asidePath())).toBe(false)
    expect(existsSync(stagingDir())).toBe(false)
  })

  it('expires on a forked chain (same length, one differing hash)', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    const forked = chainOf(workPath())
    forked[Math.floor(forked.length / 2)] = { ...forked[Math.floor(forked.length / 2)], hash: 'forged' }
    writeRestoreJournal(await buildJournal({ chain: forked }))

    await runRestorePromotion()

    expect(journalState()).toBe('expired')
    expect(readMarker(livePath())).toBe('old')
  })

  it('promotes when the journal chain is a strict prefix (app ahead by a patch migration)', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    // Fixture direction note: reality is a work DB staged on an OLDER app
    // (fewer applied migrations); here work carries the full chain and only
    // the journal's CLAIMED chain is truncated. The gate compares only the
    // claimed chain against the bundled one, so the pinned contract is the same.
    const prefix = chainOf(workPath()).slice(0, -1)
    expect(prefix.length).toBeGreaterThan(0)
    writeRestoreJournal(await buildJournal({ chain: prefix }))

    await runRestorePromotion()

    expect(journalState()).toBe('completed')
    expect(readMarker(livePath())).toBe('new')
    expect(readMarker(asidePath())).toBe('old')
  })

  it('folds a leftover work WAL into the main file before promoting (dirty-exit defense)', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    const chain = chainOf(workPath())
    // Dirty-exit simulation: commit a row, then preserve the (main, -wal) pair
    // from BEFORE the clean close and put it back — committed data left in WAL.
    const sqlite = new Database(workPath())
    sqlite.pragma('journal_mode = WAL')
    sqlite.prepare("INSERT INTO app_state (key, value, created_at, updated_at) VALUES ('wal-marker', '1', 0, 0)").run()
    copyFileSync(workPath(), `${workPath()}.dirty`)
    copyFileSync(`${workPath()}-wal`, `${workPath()}.dirty-wal`)
    sqlite.close()
    renameSync(`${workPath()}.dirty`, workPath())
    renameSync(`${workPath()}.dirty-wal`, `${workPath()}-wal`)
    writeRestoreJournal(await buildJournal({ chain }))

    await runRestorePromotion()

    expect(journalState()).toBe('completed')
    expect(readMarker(livePath())).toBe('new')
    // The WAL-only row survived the promotion — it was folded in, not dropped.
    expect(hasRow(livePath(), 'wal-marker')).toBe(true)
  })

  it('rolls back a pre-commit crash (step=live-aside): old DB restored, additives removed', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    seedManifestFixtures()
    const journal = await buildJournal({ fileResources: standardManifest() })
    // Crash arrangement: additive moved, live renamed aside, work untouched.
    arrangeAdditiveMoved()
    renameSync(livePath(), asidePath())
    writeRestoreJournal({ ...journal, state: 'promoting', step: 'live-aside' } as RestoreJournal)

    await runRestorePromotion()

    // Old DB is back at its live location; the aside slot is empty again.
    expect(readMarker(livePath())).toBe('old')
    expect(existsSync(asidePath())).toBe(false)
    // Additive rollback removed the moved-in blob and KB dir (recursive); the
    // per-entry kinds were never applied and stay absent.
    expect(existsSync(liveBlob())).toBe(false)
    expect(existsSync(liveKbDir())).toBe(false)
    expect(existsSync(liveAddedNote())).toBe(false)
    expect(readFileSync(liveNote(), 'utf8')).toBe('NOTE-OLD')
    expect(journalState()).toBe('failed')
    expect(existsSync(stagingDir())).toBe(false)
  })

  it('continues the manifest inverse past a failing entry (best-effort rollback)', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    seedManifestFixtures()
    // Poisoned entry: its live path is a non-empty DIRECTORY, so the inverse's
    // non-recursive rmSync throws. The rollback must keep going — the healthy
    // entry's aside restore and the DB rollback may not be aborted by it.
    mkdirSync(join(userData, 'poison-target'), { recursive: true })
    writeFileSync(join(userData, 'poison-target', 'child.txt'), 'x')
    mkdirSync(join(userData, 'poison-aside'), { recursive: true })
    writeFileSync(join(userData, 'poison-aside', 'original.txt'), 'ORIGINAL')
    const manifest: RestoreJournal['fileResources'] = [
      {
        kind: 'overwrite',
        stagingPath: `restore-staging/${RID}/poison.bin`,
        livePath: 'poison-target',
        asidePath: 'poison-aside/original.txt'
      },
      {
        kind: 'note-overwrite',
        stagingPath: `restore-staging/${RID}/notes/note.md`,
        livePath: 'Notes/note.md',
        asidePath: `restore-aside/${RID}/note.md`
      }
    ]
    const journal = await buildJournal({ fileResources: manifest })
    // Pre-commit crash arrangement with the note already overwritten + parked.
    mkdirSync(dirname(noteAside()), { recursive: true })
    renameSync(liveNote(), noteAside())
    renameSync(join(stagingDir(), 'notes', 'note.md'), liveNote())
    renameSync(livePath(), asidePath())
    writeRestoreJournal({ ...journal, state: 'promoting', step: 'live-aside' } as RestoreJournal)

    await runRestorePromotion()

    // DB rollback and the healthy entry's restore happened despite entry 1 failing.
    expect(readMarker(livePath())).toBe('old')
    expect(readFileSync(liveNote(), 'utf8')).toBe('NOTE-OLD')
    expect(journalState()).toBe('failed')
    expect(existsSync(stagingDir())).toBe(false)
  })

  it('resumes a post-commit crash (step=work-promoted): entries applied, completed', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    seedManifestFixtures()
    const journal = await buildJournal({ fileResources: standardManifest() })
    // Crash arrangement: additives moved, live aside done, work promoted; entries pending.
    arrangeAdditiveMoved()
    renameSync(livePath(), asidePath())
    renameSync(workPath(), livePath())
    writeRestoreJournal({ ...journal, state: 'promoting', step: 'work-promoted' } as RestoreJournal)

    await runRestorePromotion()

    expect(readMarker(livePath())).toBe('new')
    expect(readMarker(asidePath())).toBe('old')
    expect(readFileSync(join(liveKbDir(), 'chunk.bin'), 'utf8')).toBe('KB-NEW')
    expect(readFileSync(liveAddedNote(), 'utf8')).toBe('NOTE-ADDED')
    expect(readFileSync(liveNote(), 'utf8')).toBe('NOTE-NEW')
    expect(readFileSync(noteAside(), 'utf8')).toBe('NOTE-OLD')
    expect(journalState()).toBe('completed')
    expect(existsSync(stagingDir())).toBe(false)
  })

  it('resumes when the commit rename landed but its marker lagged (power loss in the rename→marker window)', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    seedManifestFixtures()
    const journal = await buildJournal({ fileResources: standardManifest() })
    // Crash arrangement: additive moved, live aside done, work→live rename
    // durably on disk — but the journal marker never made it past live-aside
    // (the power cut hit between the commit rename's dir-fsync and markStep).
    arrangeAdditiveMoved()
    renameSync(livePath(), asidePath())
    renameSync(workPath(), livePath())
    writeRestoreJournal({ ...journal, state: 'promoting', step: 'live-aside' } as RestoreJournal)

    await runRestorePromotion()

    // The commit effect already landed: recovery must resume, not roll back —
    // a marker-driven rollback would delete the blob the new live DB
    // references while leaving the new DB in place (the forbidden third state).
    expect(readMarker(livePath())).toBe('new')
    expect(readMarker(asidePath())).toBe('old')
    expect(readFileSync(liveBlob(), 'utf8')).toBe('BLOB-NEW')
    expect(readFileSync(join(liveKbDir(), 'chunk.bin'), 'utf8')).toBe('KB-NEW')
    expect(readFileSync(liveAddedNote(), 'utf8')).toBe('NOTE-ADDED')
    expect(readFileSync(liveNote(), 'utf8')).toBe('NOTE-NEW')
    expect(journalState()).toBe('completed')
    expect(existsSync(stagingDir())).toBe(false)
  })

  it('resumes (never rolls back) past the commit point at step=entries-applied', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    seedManifestFixtures()
    const journal = await buildJournal({ fileResources: standardManifest() })
    // Crash arrangement: everything through entries-applied already done.
    arrangeAdditiveMoved()
    renameSync(livePath(), asidePath())
    renameSync(workPath(), livePath())
    mkdirSync(dirname(noteAside()), { recursive: true })
    renameSync(liveNote(), noteAside())
    renameSync(join(stagingDir(), 'notes', 'note.md'), liveNote())
    renameSync(join(stagingDir(), 'notes', 'added.md'), liveAddedNote())
    writeRestoreJournal({ ...journal, state: 'promoting', step: 'entries-applied' } as RestoreJournal)

    await runRestorePromotion()

    // Lexicographically 'entries-applied' < 'work-promoted', so a string
    // comparison would classify this as pre-commit and roll back, clobbering
    // the promoted DB with the aside. Pin the indexOf semantics: it resumes.
    expect(readMarker(livePath())).toBe('new')
    expect(readMarker(asidePath())).toBe('old')
    expect(readFileSync(liveNote(), 'utf8')).toBe('NOTE-NEW')
    expect(readFileSync(liveAddedNote(), 'utf8')).toBe('NOTE-ADDED')
    expect(journalState()).toBe('completed')
    expect(existsSync(stagingDir())).toBe(false)
  })

  it('reverts everything when post-commit integrity check fails: old DB back, all file ops undone', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    seedManifestFixtures()
    const journal = await buildJournal({ fileResources: standardManifest() })
    // Crash arrangement at step=work-promoted, but the promoted live file is
    // corrupt garbage — integrity must fail AFTER entries get applied.
    arrangeAdditiveMoved()
    renameSync(livePath(), asidePath())
    rmSync(workPath())
    writeFileSync(livePath(), 'THIS IS NOT A SQLITE DATABASE'.repeat(300))
    writeRestoreJournal({ ...journal, state: 'promoting', step: 'work-promoted' } as RestoreJournal)

    await runRestorePromotion()

    // Old DB is live again; the broken candidate is retained for forensics.
    expect(readMarker(livePath())).toBe('old')
    const workFailed = readdirSync(userData).filter((name) => name.includes(`work-failed-${RID}`))
    expect(workFailed).toHaveLength(1)
    // ALL file operations undone — note aside restored, every add removed.
    expect(readFileSync(liveNote(), 'utf8')).toBe('NOTE-OLD')
    expect(existsSync(noteAside())).toBe(false)
    expect(existsSync(liveBlob())).toBe(false)
    expect(existsSync(liveKbDir())).toBe(false)
    expect(existsSync(liveAddedNote())).toBe(false)
    expect(journalState()).toBe('failed')
    expect(existsSync(stagingDir())).toBe(false)
  })

  it('finishes an interrupted revert instead of resuming forward (old DB already re-installed)', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    seedManifestFixtures()
    const journal = await buildJournal({ fileResources: standardManifest() })
    // Power loss inside revertPostCommit AFTER the aside restore: the failed
    // candidate is parked as work-failed-*, the OLD DB is back in the live
    // slot, the aside is gone — but the manifest entries are still applied
    // and the journal marker still reads entries-applied. A forward resume
    // would integrity-check the (valid) old DB and misreport 'completed'.
    arrangeAdditiveMoved()
    mkdirSync(dirname(noteAside()), { recursive: true })
    renameSync(liveNote(), noteAside())
    renameSync(join(stagingDir(), 'notes', 'note.md'), liveNote())
    renameSync(join(stagingDir(), 'notes', 'added.md'), liveAddedNote())
    renameSync(workPath(), join(userData, `work-failed-${RID}.sqlite`))
    writeRestoreJournal({ ...journal, state: 'promoting', step: 'entries-applied' } as RestoreJournal)

    await runRestorePromotion()

    // The revert is finished, never misreported: old DB live, every file
    // operation undone, the parked candidate kept for forensics.
    expect(journalState()).toBe('failed')
    expect(readMarker(livePath())).toBe('old')
    expect(readMarker(join(userData, `work-failed-${RID}.sqlite`))).toBe('new')
    expect(existsSync(liveBlob())).toBe(false)
    expect(existsSync(liveKbDir())).toBe(false)
    expect(existsSync(liveAddedNote())).toBe(false)
    expect(readFileSync(liveNote(), 'utf8')).toBe('NOTE-OLD')
    expect(existsSync(noteAside())).toBe(false)
    expect(existsSync(stagingDir())).toBe(false)
  })

  it('does not misfire the commit probe on an interrupted revert (marker stuck at live-aside)', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    seedManifestFixtures()
    const journal = await buildJournal({ fileResources: standardManifest() })
    // Deeper variant: the commit marker itself had failed (marker stuck at
    // live-aside), the promotion continued in memory, integrity failed, the
    // revert re-installed the old DB — then power loss. The probe pattern
    // "work gone ∧ live present" now matches the REVERTED state; only the
    // cleared aside tells it apart from a freshly-landed commit.
    arrangeAdditiveMoved()
    mkdirSync(dirname(noteAside()), { recursive: true })
    renameSync(liveNote(), noteAside())
    renameSync(join(stagingDir(), 'notes', 'note.md'), liveNote())
    renameSync(join(stagingDir(), 'notes', 'added.md'), liveAddedNote())
    renameSync(workPath(), join(userData, `work-failed-${RID}.sqlite`))
    writeRestoreJournal({ ...journal, state: 'promoting', step: 'live-aside' } as RestoreJournal)

    await runRestorePromotion()

    expect(journalState()).toBe('failed')
    expect(readMarker(livePath())).toBe('old')
    expect(existsSync(liveBlob())).toBe(false)
    expect(existsSync(liveKbDir())).toBe(false)
    expect(existsSync(liveAddedNote())).toBe(false)
    expect(readFileSync(liveNote(), 'utf8')).toBe('NOTE-OLD')
    expect(existsSync(stagingDir())).toBe(false)
  })

  it('quarantines a corrupt journal and clears the staging root', async () => {
    makeDb(livePath(), 'old')
    mkdirSync(stagingDir(), { recursive: true })
    writeFileSync(join(stagingDir(), 'leftover.bin'), 'x')
    writeFileSync(journalPath(), '{ definitely not a journal')

    await runRestorePromotion()

    expect(existsSync(journalPath())).toBe(false)
    const quarantined = readdirSync(userData).filter((name) => name.startsWith('restore-journal.json.corrupt-'))
    expect(quarantined).toHaveLength(1)
    expect(existsSync(join(userData, 'restore-staging'))).toBe(false)
    expect(readMarker(livePath())).toBe('old')
  })

  it('expires when work.sqlite is missing (nothing to promote)', async () => {
    makeDb(livePath(), 'old')
    makeDb(workPath(), 'new')
    const journal = await buildJournal()
    rmSync(workPath())
    writeRestoreJournal(journal)

    await runRestorePromotion()

    expect(journalState()).toBe('expired')
    expect(readMarker(livePath())).toBe('old')
  })

  describe('marker write failures (action succeeded, journal write threw — NOT a crash)', () => {
    it('completes in memory when the commit-step marker write fails', async () => {
      makeDb(livePath(), 'old')
      makeDb(workPath(), 'new')
      seedManifestFixtures()
      writeRestoreJournal(await buildJournal({ fileResources: standardManifest() }))
      // The work→live rename lands, then its own marker write throws. The
      // rename is durable — rolling back or freezing here would strand a
      // half-promoted DB. The promotion must finish in memory.
      markerFailure.shouldFail = (j) => j.state === 'promoting' && j.step === 'work-promoted'

      await runRestorePromotion()

      expect(readMarker(livePath())).toBe('new')
      expect(readMarker(asidePath())).toBe('old')
      expect(readFileSync(liveBlob(), 'utf8')).toBe('BLOB-NEW')
      expect(readFileSync(liveNote(), 'utf8')).toBe('NOTE-NEW')
      expect(readFileSync(liveAddedNote(), 'utf8')).toBe('NOTE-ADDED')
      expect(journalState()).toBe('completed')
      expect(existsSync(stagingDir())).toBe(false)
    })

    it('rolls back when a pre-commit marker write fails (write-ahead contract unrecoverable)', async () => {
      makeDb(livePath(), 'old')
      makeDb(workPath(), 'new')
      seedManifestFixtures()
      writeRestoreJournal(await buildJournal({ fileResources: standardManifest() }))
      // Before the commit point a lost marker means later crash recovery
      // could lag more than the one step the FS probe covers — the only safe
      // direction is a full rollback while the old DB still exists.
      markerFailure.shouldFail = (j) => j.state === 'promoting' && j.step === 'additive-moved'

      await runRestorePromotion()

      expect(readMarker(livePath())).toBe('old')
      expect(existsSync(asidePath())).toBe(false)
      expect(existsSync(liveBlob())).toBe(false)
      expect(existsSync(liveKbDir())).toBe(false)
      expect(readFileSync(liveNote(), 'utf8')).toBe('NOTE-OLD')
      expect(journalState()).toBe('failed')
      expect(existsSync(stagingDir())).toBe(false)
    })

    it('resumes in memory when the probe-detected commit marker cannot be persisted', async () => {
      makeDb(livePath(), 'old')
      makeDb(workPath(), 'new')
      seedManifestFixtures()
      const journal = await buildJournal({ fileResources: standardManifest() })
      // Same arrangement as the marker-lag probe case, plus: the journal is
      // still unwritable when the probe fires. Recovery must proceed in
      // memory rather than escape to the shell (which would freeze a
      // committed promotion to failed and delete the staging tree).
      arrangeAdditiveMoved()
      renameSync(livePath(), asidePath())
      renameSync(workPath(), livePath())
      writeRestoreJournal({ ...journal, state: 'promoting', step: 'live-aside' } as RestoreJournal)
      markerFailure.shouldFail = (j) => j.state === 'promoting' && j.step === 'work-promoted'

      await runRestorePromotion()

      expect(readMarker(livePath())).toBe('new')
      expect(readMarker(asidePath())).toBe('old')
      expect(readFileSync(liveNote(), 'utf8')).toBe('NOTE-NEW')
      expect(journalState()).toBe('completed')
      expect(existsSync(stagingDir())).toBe(false)
    })

    it('escapes a terminal finalize write failure, then converges on the next boot', async () => {
      makeDb(livePath(), 'old')
      makeDb(workPath(), 'new')
      seedManifestFixtures()
      writeRestoreJournal(await buildJournal({ fileResources: standardManifest() }))
      markerFailure.shouldFail = (j) => j.state === 'completed'

      // The FS reached the fully-promoted state; only the terminal journal
      // write failed. The escape must NOT have deleted the staging tree —
      // it is the resume's raw material.
      await expect(runRestorePromotion()).rejects.toThrow('injected journal write failure')
      expect(readMarker(livePath())).toBe('new')
      expect(journalState()).toBe('promoting')
      expect(existsSync(stagingDir())).toBe(true)

      // Next boot, disk healthy again: the promoting journal resumes
      // idempotently and the terminal write goes through.
      markerFailure.shouldFail = null
      await runRestorePromotion()

      expect(journalState()).toBe('completed')
      expect(readMarker(livePath())).toBe('new')
      expect(readMarker(asidePath())).toBe('old')
      expect(existsSync(stagingDir())).toBe(false)
    })
  })

  describe('add-target conflicts (target pre-exists — never clobber, never mis-delete)', () => {
    it('expires at admission when an add target already exists (preflight, nothing touched)', async () => {
      makeDb(livePath(), 'old')
      makeDb(workPath(), 'new')
      seedManifestFixtures()
      writeFileSync(liveAddedNote(), 'USER-DATA')
      writeRestoreJournal(await buildJournal({ fileResources: standardManifest() }))

      await runRestorePromotion()

      expect(journalState()).toBe('expired')
      expect(readMarker(livePath())).toBe('old')
      expect(readFileSync(liveAddedNote(), 'utf8')).toBe('USER-DATA')
      expect(existsSync(liveBlob())).toBe(false)
      expect(existsSync(asidePath())).toBe(false)
      expect(existsSync(stagingDir())).toBe(false)
    })

    it('rollback leaves conflicted targets intact and only returns adds this promotion moved in', async () => {
      makeDb(livePath(), 'old')
      makeDb(workPath(), 'new')
      seedManifestFixtures()
      const journal = await buildJournal({ fileResources: standardManifest() })
      // Provenance split: the blob WAS moved in by this promotion (staging
      // source gone); the KB dir and the added note were NOT — their staging
      // sources remain and their live targets are pre-existing user data.
      // (Defense-in-depth: admission preflight normally expires such a
      // journal before it ever reaches promoting — this pins the inverse's
      // own provenance guard should a conflict slip past it.)
      renameSync(join(stagingDir(), 'files', 'blob-1'), liveBlob())
      mkdirSync(liveKbDir(), { recursive: true })
      writeFileSync(join(liveKbDir(), 'user.txt'), 'USER-KB')
      writeFileSync(liveAddedNote(), 'USER-DATA')
      renameSync(livePath(), asidePath())
      writeRestoreJournal({ ...journal, state: 'promoting', step: 'live-aside' } as RestoreJournal)

      await runRestorePromotion()

      // Old DB restored; the user's pre-existing file and directory survived
      // the inverse — deleting them would be unrecoverable data loss.
      expect(readMarker(livePath())).toBe('old')
      expect(readFileSync(liveAddedNote(), 'utf8')).toBe('USER-DATA')
      expect(readFileSync(join(liveKbDir(), 'user.txt'), 'utf8')).toBe('USER-KB')
      // The blob this promotion DID move in was returned to staging and
      // discarded with it.
      expect(existsSync(liveBlob())).toBe(false)
      expect(journalState()).toBe('failed')
      expect(existsSync(stagingDir())).toBe(false)
    })
  })

  describe("markRestoreFailedAfterCrash (the gate shell's last-resort net)", () => {
    it('is a no-op when no journal exists', () => {
      markRestoreFailedAfterCrash()

      expect(readdirSync(userData)).toEqual([])
    })

    it('leaves a terminal journal untouched', async () => {
      makeDb(livePath(), 'old')
      writeRestoreJournal(await buildJournal({ state: 'expired', chain: [{ folderMillis: 1, hash: 'x' }] }))

      markRestoreFailedAfterCrash()

      expect(journalState()).toBe('expired')
    })

    it('marks a staged journal failed and removes the staging tree', async () => {
      makeDb(livePath(), 'old')
      makeDb(workPath(), 'new')
      writeRestoreJournal(await buildJournal())

      markRestoreFailedAfterCrash()

      expect(journalState()).toBe('failed')
      expect(existsSync(stagingDir())).toBe(false)
      expect(readMarker(livePath())).toBe('old')
    })

    it('restores the aside to the live slot before freezing to failed (no empty-DB boot)', async () => {
      makeDb(livePath(), 'old')
      makeDb(workPath(), 'new')
      const journal = await buildJournal()
      // Escaped-crash arrangement mid-revert: live was parked away, the aside
      // still holds the old DB, and the promotion logic threw before putting
      // it back. Freezing to failed without restoring it would strand the
      // user on a fresh empty database next boot.
      renameSync(livePath(), asidePath())
      // The work slot must be empty too — mid-revert the candidate DB was
      // already parked as work-failed-*, so nothing here reads as resumable.
      rmSync(workPath())
      writeRestoreJournal({ ...journal, state: 'promoting', step: 'work-promoted' } as RestoreJournal)

      markRestoreFailedAfterCrash()

      expect(readMarker(livePath())).toBe('old')
      expect(existsSync(asidePath())).toBe(false)
      expect(journalState()).toBe('failed')
      expect(existsSync(stagingDir())).toBe(false)
    })

    it('leaves a resumable post-commit state untouched (new DB live, old DB aside)', async () => {
      makeDb(livePath(), 'old')
      makeDb(workPath(), 'new')
      seedManifestFixtures()
      const journal = await buildJournal({ fileResources: standardManifest() })
      // Escape AFTER the commit rename: the new DB is live, the old DB is
      // parked aside. Freezing to failed would strand a half-promoted DB and
      // delete the staging tree the next boot's resume still needs.
      arrangeAdditiveMoved()
      renameSync(livePath(), asidePath())
      renameSync(workPath(), livePath())
      writeRestoreJournal({ ...journal, state: 'promoting', step: 'work-promoted' } as RestoreJournal)

      markRestoreFailedAfterCrash()

      expect(journalState()).toBe('promoting')
      expect(existsSync(stagingDir())).toBe(true)
      expect(readMarker(livePath())).toBe('new')
      expect(readMarker(asidePath())).toBe('old')
    })

    it('leaves the probe-detected commit state untouched (marker lagged at live-aside)', async () => {
      makeDb(livePath(), 'old')
      makeDb(workPath(), 'new')
      seedManifestFixtures()
      const journal = await buildJournal({ fileResources: standardManifest() })
      // The commit rename landed but its marker never did (the same window
      // recoverPromoting's FS probe covers) — then the resume escaped. The
      // net must recognize the committed state and leave it resumable.
      arrangeAdditiveMoved()
      renameSync(livePath(), asidePath())
      renameSync(workPath(), livePath())
      writeRestoreJournal({ ...journal, state: 'promoting', step: 'live-aside' } as RestoreJournal)

      markRestoreFailedAfterCrash()

      expect(journalState()).toBe('promoting')
      expect(existsSync(stagingDir())).toBe(true)
      expect(readMarker(livePath())).toBe('new')
      expect(readMarker(asidePath())).toBe('old')
    })
  })

  describe('isLiveDbStranded (the shell boot-refusal predicate)', () => {
    it('is true when the live DB is missing and the aside still holds the old DB', async () => {
      makeDb(livePath(), 'old')
      makeDb(workPath(), 'new')
      const journal = await buildJournal()
      renameSync(livePath(), asidePath())
      writeRestoreJournal({ ...journal, state: 'promoting', step: 'live-aside' } as RestoreJournal)

      expect(isLiveDbStranded()).toBe(true)
    })

    it('is false while the live DB exists', async () => {
      makeDb(livePath(), 'old')
      makeDb(workPath(), 'new')
      writeRestoreJournal(await buildJournal())

      expect(isLiveDbStranded()).toBe(false)
    })

    it('is false with no journal (missing live is not this machinery)', () => {
      expect(isLiveDbStranded()).toBe(false)
    })

    it('is false on a corrupt journal (no aside path to check)', () => {
      writeFileSync(journalPath(), '{ definitely not a journal')

      expect(isLiveDbStranded()).toBe(false)
    })
  })
})
