import type * as NodeFsModule from 'node:fs'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { readAppliedChain } from '@data/db/restore/appliedChain'
import {
  hasPendingRestore,
  type RestoreJournal,
  readRestoreJournal,
  writeRestoreJournal
} from '@data/db/restore/restoreJournal'
import { cleanupTerminalRestoreArtifacts, markRestoreFailedAfterCrash } from '@data/db/restore/restorePromotion'
import { appStateTable } from '@data/db/schemas/appState'
import { runBackupRestoreGate } from '@main/core/preboot/backupRestoreGate'

vi.mock('node:fs', async () => {
  const { createNodeFsMock } = await import('@test-helpers/mocks/nodeFsMock')
  const actual = await vi.importActual<typeof NodeFsModule>('node:fs')
  const mocked = await createNodeFsMock()
  const renameSync = mocked.renameSync.mockImplementation(actual.renameSync)
  const rmSync = vi.fn(actual.rmSync)
  return { ...actual, renameSync, rmSync, default: { ...actual, renameSync, rmSync } }
})

describe('restore rollback retains old resources until recovery succeeds', () => {
  const dbh = setupTestDatabase()
  let root: string

  beforeEach(async () => {
    const actual = await vi.importActual<typeof NodeFsModule>('node:fs')
    vi.mocked(fs.renameSync).mockImplementation(actual.renameSync)
    vi.mocked(fs.rmSync).mockImplementation(actual.rmSync)
    root = fs.mkdtempSync(path.join(tmpdir(), 'cs-restore-retention-'))
    const paths: Record<string, string> = {
      'app.userdata': root,
      'app.database.file': path.join(root, 'Data', 'cherrystudio.sqlite'),
      'app.database.migrations': resolveMigrationsPath(),
      'feature.backup.restore.file': path.join(root, 'Data', 'restore-journal.json'),
      'feature.backup.restore.staging': path.join(root, 'restore-staging')
    }
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      const base = paths[key]
      if (!base) throw new Error(`Unexpected path key: ${key}`)
      return filename ? path.join(base, filename) : base
    })
    dbh.db
      .insert(appStateTable)
      .values({ key: 'original-data', value: { retained: true } })
      .run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  async function arrangeRevert(kind: 'overwrite' | 'note-overwrite') {
    const restoreId = 'retention-test'
    const staging = path.join(root, 'restore-staging', restoreId)
    const liveDb = path.join(root, 'Data', 'cherrystudio.sqlite')
    const asideDb = path.join(staging, 'aside', 'cherrystudio.sqlite')
    fs.mkdirSync(path.dirname(liveDb), { recursive: true })
    fs.mkdirSync(path.dirname(asideDb), { recursive: true })
    await dbh.sqlite.backup(asideDb)
    fs.writeFileSync(liveDb, 'INVALID PROMOTED DATABASE'.repeat(300))

    const live = path.join(root, kind === 'overwrite' ? '.claude' : 'Notes/note.md')
    const aside = path.join(staging, 'aside', path.relative(root, live))
    const originalFile = kind === 'overwrite' ? path.join(aside, 'session.jsonl') : aside
    const replacementFile = kind === 'overwrite' ? path.join(live, 'session.jsonl') : live
    fs.mkdirSync(path.dirname(originalFile), { recursive: true })
    fs.mkdirSync(path.dirname(replacementFile), { recursive: true })
    fs.writeFileSync(originalFile, 'ORIGINAL USER CONTENT')
    fs.writeFileSync(replacementFile, 'RESTORED BACKUP CONTENT')

    const healthyAside = path.join(staging, 'aside', 'Notes/healthy.md')
    const healthyLive = path.join(root, 'Notes/healthy.md')
    fs.mkdirSync(path.dirname(healthyAside), { recursive: true })
    fs.mkdirSync(path.dirname(healthyLive), { recursive: true })
    fs.writeFileSync(healthyAside, 'HEALTHY ORIGINAL')
    fs.writeFileSync(healthyLive, 'HEALTHY REPLACEMENT')
    const journal: RestoreJournal = {
      version: 1,
      restoreId,
      createdAt: '2026-10-10T00:00:00.000Z',
      state: 'promoting',
      step: 'entries-applied',
      db: {
        promote: path.relative(root, path.join(staging, 'work.sqlite')),
        aside: path.relative(root, asideDb),
        fingerprint: 'unused-after-commit',
        chain: readAppliedChain(dbh.sqlite)
      },
      fileResources: [
        {
          kind,
          livePath: path.relative(root, live),
          asidePath: path.relative(root, aside),
          stagingPath: path.relative(root, path.join(staging, 'replacement'))
        },
        {
          kind: 'note-overwrite',
          livePath: path.relative(root, healthyLive),
          asidePath: path.relative(root, healthyAside),
          stagingPath: path.relative(root, path.join(staging, 'healthy-replacement'))
        }
      ]
    }
    writeRestoreJournal(journal)
    return { live, aside, originalFile, replacementFile, liveDb, asideDb, staging, healthyLive }
  }

  function content(filename: string) {
    return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null
  }

  function assertOriginalDatabase(liveDb: string) {
    const sqlite = new Database(liveDb, { readonly: true, fileMustExist: true })
    try {
      expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(sqlite.prepare('SELECT value FROM app_state WHERE key = ?').pluck().get('original-data')).toBe(
        '{"retained":true}'
      )
    } finally {
      sqlite.close()
    }
  }

  describe.each(['overwrite', 'note-overwrite'] as const)('%s', (kind) => {
    it.each(['remove', 'rename'] as const)(
      'retains the old copy after %s fails and recovers it on the next gate run',
      async (operation) => {
        const fixture = await arrangeRevert(kind)
        const actual = await vi.importActual<typeof NodeFsModule>('node:fs')
        const realRemove = actual.rmSync
        const realRename = actual.renameSync
        if (operation === 'remove') {
          vi.mocked(fs.rmSync).mockImplementation((target, options) => {
            if (target === fixture.live)
              throw Object.assign(new Error('Injected resource removal failure'), { code: 'EPERM' })
            return realRemove(target, options)
          })
        } else {
          vi.mocked(fs.renameSync).mockImplementation((source, target) => {
            if (source === fixture.aside)
              throw Object.assign(new Error('Injected resource rename failure'), { code: 'EPERM' })
            return realRename(source, target)
          })
        }

        await expect(runBackupRestoreGate()).rejects.toThrow(/recovery is incomplete/)
        const retainedAfterFailure = content(fixture.originalFile)
        const journalAfterFailure = readRestoreJournal()
        assertOriginalDatabase(fixture.liveDb)
        expect(content(fixture.healthyLive)).toBe('HEALTHY ORIGINAL')
        expect(hasPendingRestore()).toBe(true)
        cleanupTerminalRestoreArtifacts()
        expect(content(fixture.originalFile)).toBe('ORIGINAL USER CONTENT')
        if (operation === 'remove') vi.mocked(fs.rmSync).mockImplementation(realRemove)
        else vi.mocked(fs.renameSync).mockImplementation(realRename)

        await runBackupRestoreGate()

        expect({
          retainedAfterFailure,
          restoredAfterRestart: content(fixture.replacementFile),
          journalAfterFailure: journalAfterFailure.kind
        }).toEqual({
          retainedAfterFailure: 'ORIGINAL USER CONTENT',
          restoredAfterRestart: 'ORIGINAL USER CONTENT',
          journalAfterFailure: 'ok'
        })
        expect(journalAfterFailure).toMatchObject({ kind: 'ok', journal: { state: 'promoting' } })
        expect(readRestoreJournal()).toEqual({ kind: 'none' })
        expect(fs.existsSync(fixture.staging)).toBe(false)
        assertOriginalDatabase(fixture.liveDb)
      }
    )

    it('restores old content and consumes artifacts when rollback has no I/O failure', async () => {
      const fixture = await arrangeRevert(kind)

      await runBackupRestoreGate()

      expect(content(fixture.replacementFile)).toBe('ORIGINAL USER CONTENT')
      expect(content(fixture.healthyLive)).toBe('HEALTHY ORIGINAL')
      expect(fs.existsSync(fixture.staging)).toBe(false)
      expect(readRestoreJournal()).toEqual({ kind: 'none' })
      assertOriginalDatabase(fixture.liveDb)
    })

    it('recovers a resource aside left in a failed journal by an earlier build', async () => {
      const fixture = await arrangeRevert(kind)
      const journal = readRestoreJournal()
      if (journal.kind !== 'ok') throw new Error('Expected a readable fixture journal')
      fs.rmSync(fixture.liveDb)
      fs.renameSync(path.resolve(root, journal.journal.db.aside), fixture.liveDb)
      writeRestoreJournal({ ...journal.journal, state: 'failed' })

      await runBackupRestoreGate()

      assertOriginalDatabase(fixture.liveDb)
      expect(content(fixture.replacementFile)).toBe('ORIGINAL USER CONTENT')
      expect(content(fixture.healthyLive)).toBe('HEALTHY ORIGINAL')
      expect(readRestoreJournal()).toEqual({ kind: 'none' })
      expect(fs.existsSync(fixture.staging)).toBe(false)
    })

    it('retains a failed journal and its original copies while legacy recovery is blocked', async () => {
      const fixture = await arrangeRevert(kind)
      const journal = readRestoreJournal()
      if (journal.kind !== 'ok') throw new Error('Expected a readable fixture journal')
      fs.rmSync(fixture.liveDb)
      fs.renameSync(fixture.asideDb, fixture.liveDb)
      writeRestoreJournal({ ...journal.journal, state: 'failed' })
      const actual = await vi.importActual<typeof NodeFsModule>('node:fs')
      vi.mocked(fs.renameSync).mockImplementation((source, target) => {
        if (source === fixture.aside) throw Object.assign(new Error('Resource is locked'), { code: 'EPERM' })
        return actual.renameSync(source, target)
      })

      await expect(runBackupRestoreGate()).rejects.toThrow(/recovery is incomplete/)

      expect(content(fixture.originalFile)).toBe('ORIGINAL USER CONTENT')
      expect(content(fixture.healthyLive)).toBe('HEALTHY ORIGINAL')
      expect(hasPendingRestore()).toBe(true)
      expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'failed' } })
      assertOriginalDatabase(fixture.liveDb)

      vi.mocked(fs.renameSync).mockImplementation(actual.renameSync)
      await runBackupRestoreGate()

      expect(content(fixture.replacementFile)).toBe('ORIGINAL USER CONTENT')
      expect(readRestoreJournal()).toEqual({ kind: 'none' })
    })

    it('does not consume original resources when database rollback itself is blocked', async () => {
      const fixture = await arrangeRevert(kind)
      const actual = await vi.importActual<typeof NodeFsModule>('node:fs')
      vi.mocked(fs.renameSync).mockImplementation((source, target) => {
        if (source === fixture.asideDb) throw Object.assign(new Error('Database is locked'), { code: 'EPERM' })
        return actual.renameSync(source, target)
      })

      await expect(runBackupRestoreGate()).rejects.toThrow(/empty database/)

      expect(content(fixture.originalFile)).toBe('ORIGINAL USER CONTENT')
      expect(content(fixture.replacementFile)).toBe('RESTORED BACKUP CONTENT')
      expect(hasPendingRestore()).toBe(true)

      vi.mocked(fs.renameSync).mockImplementation(actual.renameSync)
      await runBackupRestoreGate()

      assertOriginalDatabase(fixture.liveDb)
      expect(content(fixture.replacementFile)).toBe('ORIGINAL USER CONTENT')
      expect(readRestoreJournal()).toEqual({ kind: 'none' })
    })

    it('keeps a rollback resumable when the terminal journal write fails', async () => {
      const fixture = await arrangeRevert(kind)
      const actual = await vi.importActual<typeof NodeFsModule>('node:fs')
      const journalPath = application.getPath('feature.backup.restore.file')
      vi.mocked(fs.renameSync).mockImplementation((source, target) => {
        if (source === `${journalPath}.tmp` && actual.readFileSync(source, 'utf8').includes('"state": "failed"')) {
          throw Object.assign(new Error('Journal is locked'), { code: 'EPERM' })
        }
        return actual.renameSync(source, target)
      })

      await expect(runBackupRestoreGate()).rejects.toThrow(/recovery is incomplete/)

      assertOriginalDatabase(fixture.liveDb)
      expect(content(fixture.replacementFile)).toBe('ORIGINAL USER CONTENT')
      expect(fs.existsSync(fixture.staging)).toBe(true)
      expect(hasPendingRestore()).toBe(true)

      vi.mocked(fs.renameSync).mockImplementation(actual.renameSync)
      await runBackupRestoreGate()

      expect(content(fixture.replacementFile)).toBe('ORIGINAL USER CONTENT')
      expect(readRestoreJournal()).toEqual({ kind: 'none' })
    })

    it('keeps a failed journal pending until staging cleanup can finish', async () => {
      const fixture = await arrangeRevert(kind)
      const actual = await vi.importActual<typeof NodeFsModule>('node:fs')
      vi.mocked(fs.rmSync).mockImplementation((target, options) => {
        if (target === fixture.staging) throw Object.assign(new Error('Staging is locked'), { code: 'EPERM' })
        return actual.rmSync(target, options)
      })

      await expect(runBackupRestoreGate()).rejects.toThrow(/recovery is incomplete/)

      assertOriginalDatabase(fixture.liveDb)
      expect(content(fixture.replacementFile)).toBe('ORIGINAL USER CONTENT')
      expect(content(fixture.healthyLive)).toBe('HEALTHY ORIGINAL')
      expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'failed' } })
      expect(hasPendingRestore()).toBe(true)

      vi.mocked(fs.rmSync).mockImplementation(actual.rmSync)
      await runBackupRestoreGate()

      expect(content(fixture.replacementFile)).toBe('ORIGINAL USER CONTENT')
      expect(readRestoreJournal()).toEqual({ kind: 'none' })
      expect(fs.existsSync(fixture.staging)).toBe(false)
    })

    it('protects old copies when the escaped-crash net encounters an inverse failure', async () => {
      const fixture = await arrangeRevert(kind)
      fs.rmSync(fixture.liveDb)
      fs.renameSync(fixture.asideDb, fixture.liveDb)
      const actual = await vi.importActual<typeof NodeFsModule>('node:fs')
      vi.mocked(fs.renameSync).mockImplementation((source, target) => {
        if (source === fixture.aside) throw Object.assign(new Error('Resource is locked'), { code: 'EPERM' })
        return actual.renameSync(source, target)
      })

      expect(() => markRestoreFailedAfterCrash()).toThrow(/rollback is incomplete/)

      expect(content(fixture.originalFile)).toBe('ORIGINAL USER CONTENT')
      expect(content(fixture.healthyLive)).toBe('HEALTHY ORIGINAL')
      expect(hasPendingRestore()).toBe(true)
      assertOriginalDatabase(fixture.liveDb)

      vi.mocked(fs.renameSync).mockImplementation(actual.renameSync)
      await runBackupRestoreGate()

      expect(content(fixture.replacementFile)).toBe('ORIGINAL USER CONTENT')
      expect(readRestoreJournal()).toEqual({ kind: 'none' })
    })
  })

  it.each(['blob-add', 'dir-add', 'note-add'] as const)(
    'keeps a pre-existing %s target when terminal cleanup has removed its staging source',
    async (kind) => {
      const fixture = await arrangeRevert('note-overwrite')
      const journal = readRestoreJournal()
      if (journal.kind !== 'ok') throw new Error('Expected a readable fixture journal')
      fs.rmSync(fixture.liveDb)
      fs.renameSync(fixture.asideDb, fixture.liveDb)
      const live = path.join(root, 'pre-existing-resource')
      if (kind === 'dir-add') fs.mkdirSync(live)
      const original = kind === 'dir-add' ? path.join(live, 'content.txt') : live
      fs.writeFileSync(original, 'PRE-EXISTING ORIGINAL')
      writeRestoreJournal({
        ...journal.journal,
        state: 'failed',
        fileResources: [
          ...journal.journal.fileResources,
          {
            kind,
            livePath: path.relative(root, live),
            stagingPath: path.relative(root, path.join(fixture.staging, 'gone'))
          }
        ]
      })

      await runBackupRestoreGate()

      expect(content(original)).toBe('PRE-EXISTING ORIGINAL')
      expect(content(fixture.replacementFile)).toBe('ORIGINAL USER CONTENT')
      expect(readRestoreJournal()).toEqual({ kind: 'none' })
      expect(fs.existsSync(fixture.staging)).toBe(false)
      assertOriginalDatabase(fixture.liveDb)
    }
  )

  it.each([
    ['blob-add', false],
    ['dir-add', false],
    ['blob-add', true],
    ['dir-add', true],
    ['note-add', true]
  ] as const)('restores the database before retrying a blocked %s inverse (committed: %s)', async (kind, committed) => {
    const restoreId = 'add-retention-test'
    const staging = path.join(root, 'restore-staging', restoreId)
    const liveDb = application.getPath('app.database.file')
    const asideDb = path.join(staging, 'aside', 'cherrystudio.sqlite')
    const workDb = path.join(staging, 'work.sqlite')
    const live = path.join(root, 'added-resource')
    const source = path.join(staging, 'resource')
    fs.mkdirSync(path.dirname(liveDb), { recursive: true })
    fs.mkdirSync(staging, { recursive: true })
    fs.mkdirSync(path.dirname(asideDb), { recursive: true })
    await dbh.sqlite.backup(asideDb)
    fs.copyFileSync(asideDb, workDb)
    if (committed) {
      fs.writeFileSync(liveDb, 'INVALID PROMOTED DATABASE'.repeat(300))
      fs.rmSync(workDb)
    }
    if (kind === 'dir-add') fs.mkdirSync(live)
    const addedFile = kind === 'dir-add' ? path.join(live, 'content.txt') : live
    fs.writeFileSync(addedFile, 'ADDED CONTENT')
    writeRestoreJournal({
      version: 1,
      restoreId,
      createdAt: '2026-10-11T00:00:00.000Z',
      state: 'promoting',
      step: committed ? 'entries-applied' : 'live-aside',
      db: {
        promote: path.relative(root, workDb),
        aside: path.relative(root, asideDb),
        fingerprint: 'unused-during-rollback',
        chain: readAppliedChain(dbh.sqlite)
      },
      fileResources: [{ kind, livePath: path.relative(root, live), stagingPath: path.relative(root, source) }]
    })
    const actual = await vi.importActual<typeof NodeFsModule>('node:fs')
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      if (from === live) throw Object.assign(new Error('Added resource is locked'), { code: 'EPERM' })
      return actual.renameSync(from, to)
    })

    await expect(runBackupRestoreGate()).rejects.toThrow(/recovery is incomplete/)

    assertOriginalDatabase(liveDb)
    expect(content(addedFile)).toBe('ADDED CONTENT')
    expect(fs.existsSync(workDb)).toBe(!committed)
    expect(hasPendingRestore()).toBe(true)

    vi.mocked(fs.renameSync).mockImplementation(actual.renameSync)
    await runBackupRestoreGate()

    assertOriginalDatabase(liveDb)
    expect(fs.existsSync(live)).toBe(false)
    expect(fs.existsSync(staging)).toBe(false)
    expect(readRestoreJournal()).toEqual({ kind: 'none' })
  })
})
