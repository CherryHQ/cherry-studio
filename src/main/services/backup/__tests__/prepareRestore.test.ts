import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { application } from '@application'
import { readRestoreJournalV2, writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { snapshotTo } from '@data/db/restore/snapshot'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { fileEntryTable } from '@data/db/schemas/file'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { noteTable } from '@data/db/schemas/note'
import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { presentDegradations } from '../degradationReport'
import { exportArchive } from '../exportArchive'
import { armPreparedRestore, cancelPreparedRestore, prepareRestore } from '../prepareRestore'
import { restoreStagingDurability } from '../stagingDurability'

/**
 * Prepare/cancel/arm, driven with archives this repository's own producer made.
 * Using a real exported archive (rather than a hand-built fixture) is what makes
 * these tests a proof: preparation runs the same admission gate a hostile file
 * would hit, and the coverage numbers come from requirements the export pipeline
 * actually wrote.
 */

const migrationsFolder = resolveMigrationsPath()

describe('restore preparation', () => {
  const dbh = setupTestDatabase()
  let workDir: string
  let userData: string
  let archivePath: string

  beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'cs-prepare-'))
    userData = join(workDir, 'userData')
    archivePath = join(workDir, 'out', 'backup.cherrybackup')
    mkdirSync(join(workDir, 'out'), { recursive: true })
    mkdirSync(join(userData, 'backup-temp'), { recursive: true })
    mkdirSync(join(userData, 'restore-staging'), { recursive: true })
    // The export preflight sizes the staging volume from the live DB file.
    writeFileSync(join(userData, 'cherrystudio.sqlite'), 'LIVE-DB')

    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      const base = pathFor(key)
      return filename ? join(base, filename) : base
    })
    vi.mocked(application.relaunch).mockReset()
    snapshotMock().mockImplementation((target: string) => snapshotTo(dbh.sqlite, target))

    seedResources()
    await exportArchive({ outPath: archivePath })
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
    snapshotMock().mockReset()
    mockMainLoggerService.info.mockReset()
    mockMainLoggerService.warn.mockReset()
    vi.restoreAllMocks()
  })

  function snapshotMock(): Mock {
    return application.get('DbService').createSnapshot as unknown as Mock
  }

  function pathFor(key: string): string {
    switch (key) {
      case 'app.userdata':
        return userData
      case 'app.database.file':
        return join(userData, 'cherrystudio.sqlite')
      case 'app.database.migrations':
        return migrationsFolder
      case 'feature.backup.temp':
        return join(userData, 'backup-temp')
      case 'feature.backup.restore.file':
        return join(userData, 'restore-journal.json')
      case 'feature.backup.restore.staging':
        return join(userData, 'restore-staging')
      case 'feature.backup.restore.aside':
        return join(userData, 'restore-aside')
      case 'feature.files.data':
        return join(userData, 'Data', 'Files')
      case 'feature.knowledgebase.data':
        return join(userData, 'Data', 'KnowledgeBase')
      case 'feature.notes.data':
        return join(userData, 'Data', 'Notes')
      case 'feature.agents.data':
        return join(userData, 'Data', 'Agents')
      case 'feature.agents.system_workspaces':
        return join(userData, 'Data', 'Agents', 'system')
      case 'feature.agents.skills':
        return join(userData, 'Data', 'Skills')
      case 'feature.mcp.workspace':
        return join(userData, 'Data', 'Workspace')
      case 'feature.mcp.memory_file':
        return join(userData, 'Data', 'Mcp', 'memory.json')
      case 'feature.agents.channels':
        return join(userData, 'Data', 'Channels')
      case 'feature.agents.claude.root':
        return join(userData, 'Data', 'Agents', '.claude')
      default:
        throw new Error(`Unexpected path key in prepare test: ${key}`)
    }
  }

  function seedResources(): void {
    dbh.db
      .insert(fileEntryTable)
      .values({ id: '11111111-1111-4111-8111-111111111111', origin: 'internal', name: 'a', ext: 'pdf', size: 1 })
      .run()
    dbh.db
      .insert(knowledgeBaseTable)
      .values({ id: 'kb-1', name: 'kb', status: 'completed', chunkSize: 512, chunkOverlap: 32 })
      .run()
    dbh.db
      .insert(noteTable)
      .values({ id: 'n-1', rootPath: join(userData, 'Data', 'Notes'), path: 'a.md', isStarred: true })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({
        id: 'w-1',
        name: 'ws',
        path: join(userData, 'Data', 'Agents', 'system', 's-1'),
        type: 'system',
        orderKey: 'a'
      })
      .run()
  }

  /** Materialize the resources the seeded database references. */
  function createTargetResources(): void {
    mkdirSync(join(userData, 'Data', 'Files'), { recursive: true })
    writeFileSync(join(userData, 'Data', 'Files', '11111111-1111-4111-8111-111111111111.pdf'), 'blob')
    mkdirSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1'), { recursive: true })
    mkdirSync(join(userData, 'Data', 'Notes'), { recursive: true })
    mkdirSync(join(userData, 'Data', 'Agents', 'system', 's-1'), { recursive: true })
    mkdirSync(join(userData, 'Data', 'Workspace'), { recursive: true })
    mkdirSync(join(userData, 'Data', 'Mcp'), { recursive: true })
    writeFileSync(join(userData, 'Data', 'Mcp', 'memory.json'), '{"entities":[],"relations":[]}')
    mkdirSync(join(userData, 'Data', 'Channels'), { recursive: true })
    mkdirSync(join(userData, 'Data', 'Agents', '.claude'), { recursive: true })
  }

  describe('prepare', () => {
    it('reports every resource available on the device that produced the archive', async () => {
      createTargetResources()

      const preview = await prepareRestore({ archivePath })

      // The Knowledge base is present but ships without its index, so it is
      // reported as rebuildable — never as plain available, and never twice.
      expect(preview.coverage).toEqual({ available: 7, rebuildable: 1, missing: 0, unverifiable: 0 })
    })

    it('reports resources missing on an empty device without creating any of them', async () => {
      const preview = await prepareRestore({ archivePath })

      expect(preview.coverage).toEqual({ available: 0, rebuildable: 0, missing: 8, unverifiable: 0 })
      // Diagnostic only: a coverage probe must never conjure the managed
      // resource roots it failed to find. Data itself still owns the live DB.
      for (const resourceRoot of ['Files', 'KnowledgeBase', 'Notes', 'Agents', 'Skills']) {
        expect(existsSync(join(userData, 'Data', resourceRoot))).toBe(false)
      }
    })

    it('counts a wrong-typed target as missing rather than available', async () => {
      createTargetResources()
      // A file standing where the Knowledge base directory belongs.
      rmSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1'), { recursive: true })
      writeFileSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1'), 'not a directory')

      const preview = await prepareRestore({ archivePath })

      expect(preview.coverage).toEqual({ available: 7, rebuildable: 0, missing: 1, unverifiable: 0 })
    })

    it('partitions every requirement into exactly one coverage bucket', async () => {
      createTargetResources()

      const preview = await prepareRestore({ archivePath })
      const { available, rebuildable, missing } = preview.coverage

      // Eight requirements, whatever this device happens to hold; `unverifiable`
      // counts references that are not requirements and stays out of the sum.
      expect(available + rebuildable + missing).toBe(8)
      expect(rebuildable).toBeGreaterThan(0)
    })

    it('accepts an archive that informedly excluded an unrebuildable Knowledge base', async () => {
      // Re-export with a completed leaf whose material was never copied under
      // `raw/`: the producer must degrade the base out, and this side must
      // accept that archive rather than read it as a missing payload.
      dbh.db
        .insert(knowledgeItemTable)
        .values({
          id: 'i-virtual',
          baseId: 'kb-1',
          type: 'file',
          data: { source: 'virtual.pdf', relativePath: 'virtual.pdf' } as never,
          status: 'completed'
        })
        .run()
      // Everything else is on disk, so the base is the ONLY thing degraded.
      createTargetResources()
      mkdirSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1', 'raw'), { recursive: true })
      writeFileSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1', 'raw', 'other.txt'), 'OTHER')
      const degradedArchive = join(workDir, 'out', 'degraded.cherrybackup')
      await exportArchive({ outPath: degradedArchive })

      const preview = await prepareRestore({ archivePath: degradedArchive })

      expect(preview.degradations).toEqual([
        { kind: 'resource:knowledge-base', livePath: 'Data/KnowledgeBase/kb-1', reason: 'unrebuildable-content' }
      ])
      // What the renderer is allowed to see: the closed code, never the reason.
      expect(presentDegradations(preview.degradations)).toEqual([
        { code: 'resource-unavailable', count: 1, paths: ['Data/KnowledgeBase/kb-1'] }
      ])
      // The disclosure survives the relaunch the restore needs.
      const read = readRestoreJournalV2()
      expect(read.kind).toBe('ok')
      if (read.kind !== 'ok') return
      expect(read.journal.degradations).toContainEqual({
        kind: 'report:resource-unavailable',
        reason: 'count:1'
      })
    })

    it('refuses to write prepared when staged bytes cannot be made durable', async () => {
      vi.spyOn(restoreStagingDurability, 'syncFile').mockImplementation(() => {
        throw new Error('simulated fsync failure')
      })

      await expect(prepareRestore({ archivePath })).rejects.toThrow(/fsync failure/)

      expect(readRestoreJournalV2().kind).toBe('none')
      expect(readdirSync(join(userData, 'restore-staging'))).toEqual([])
      expect(readFileSync(join(userData, 'cherrystudio.sqlite'), 'utf8')).toBe('LIVE-DB')
    })

    it('writes a prepared journal pointing at a staged database that exists', async () => {
      const preview = await prepareRestore({ archivePath })

      const read = readRestoreJournalV2()
      expect(read.kind).toBe('ok')
      if (read.kind !== 'ok') return
      expect(read.journal.state).toBe('prepared')
      expect(read.journal.restoreId).toBe(preview.restoreId)
      expect(read.journal.resourceInstalls).toEqual([])
      expect(read.journal.db.promote).toBe(`restore-staging/${preview.restoreId}/backup.sqlite`)
      expect(read.journal.db.aside).toBe(`cherrystudio.sqlite.pre-restore-${preview.restoreId}`)
      expect(existsSync(join(userData, read.journal.db.promote))).toBe(true)
      expect(read.journal.db.chain.length).toBeGreaterThan(0)
      // The promotion gate renames the main file alone and refuses a staged
      // database carrying a sidecar, so preparation must hand it over sealed.
      expect(existsSync(join(userData, `${read.journal.db.promote}-wal`))).toBe(false)
      expect(existsSync(join(userData, `${read.journal.db.promote}-shm`))).toBe(false)
    })

    it('leaves no admission staging tree behind beyond the prepared restore', async () => {
      const preview = await prepareRestore({ archivePath })

      expect(readdirSync(join(userData, 'restore-staging'))).toEqual([preview.restoreId])
    })

    it('keeps a durable preparation when the disposable admission root cannot be cleaned', async () => {
      const replacement = join(workDir, 'replacement-admission-root')
      mkdirSync(replacement)
      mockMainLoggerService.warn.mockClear()
      mockMainLoggerService.info.mockImplementation((message) => {
        if (message !== 'Restore prepared') return
        const stagingParent = join(userData, 'restore-staging')
        const admittedRoot = readdirSync(stagingParent).find((entry) => entry.startsWith('cs-admit-'))
        if (!admittedRoot) throw new Error('expected the admission staging root')
        const admittedPath = join(stagingParent, admittedRoot)
        rmSync(admittedPath, { recursive: true })
        symlinkSync(replacement, admittedPath, 'dir')
      })

      const preview = await prepareRestore({ archivePath })

      expect(readRestoreJournalV2()).toMatchObject({
        kind: 'ok',
        journal: { state: 'prepared', restoreId: preview.restoreId }
      })
      expect(existsSync(join(userData, 'restore-staging', preview.restoreId, 'backup.sqlite'))).toBe(true)
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        'Could not remove admission staging after writing the restore journal; preserving it',
        expect.any(Error)
      )
    })

    it('does not touch the live database', async () => {
      await prepareRestore({ archivePath })

      expect(readFileSync(join(userData, 'cherrystudio.sqlite'), 'utf8')).toBe('LIVE-DB')
    })

    describe('degradations', () => {
      /**
       * A note whose root is not an absolute path cannot be rebased onto this
       * device. Rebasing happens ONLY on the restore side (the archive stores
       * producer-absolute paths), so this reduction exists nowhere in the
       * manifest — it is exactly the half of the report the journal has to carry.
       */
      async function exportWithUnportableNote(): Promise<string> {
        dbh.db.insert(noteTable).values({ id: 'n-bad', rootPath: 'not/absolute', path: 'b.md', isStarred: true }).run()
        const out = join(workDir, 'out', 'degraded.cherrybackup')
        await exportArchive({ outPath: out })
        return out
      }

      it('reports what THIS device reduced, not only what the archive declared', async () => {
        const preview = await prepareRestore({ archivePath: await exportWithUnportableNote() })

        expect(preview.degradations).toEqual(
          expect.arrayContaining([{ kind: 'restore-db:note', reason: 'path-unportable (1 row)' }])
        )
      })

      it('carries the report in the journal, which is all that survives the relaunch', async () => {
        // The report is rendered after the restart, by which point the staging
        // tree that produced it is gone — so a journal that dropped it would
        // make a degraded restore look like a complete one (§4).
        await prepareRestore({ archivePath: await exportWithUnportableNote() })

        const read = readRestoreJournalV2()
        expect(read.kind).toBe('ok')
        if (read.kind !== 'ok') return
        expect(read.journal.degradations).toEqual(
          expect.arrayContaining([{ kind: 'report:path-unportable', reason: 'count:1' }])
        )
      })

      it('omits the field entirely when nothing was reduced', async () => {
        // Every export inventories this device's resources, so "nothing was
        // reduced" only holds once the files the database references exist.
        createTargetResources()
        const clean = join(workDir, 'out', 'clean.cherrybackup')
        await exportArchive({ outPath: clean })

        await prepareRestore({ archivePath: clean })

        const read = readRestoreJournalV2()
        expect(read.kind).toBe('ok')
        if (read.kind !== 'ok') return
        expect(read.journal.degradations).toBeUndefined()
      })
    })
  })

  describe('prepare full', () => {
    /** Export a Full archive from this device's own resources, then clear them. */
    async function exportFull(): Promise<string> {
      const out = join(workDir, 'out', 'full.cherrybackup')
      createTargetResources()
      writeFileSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1', 'doc.txt'), 'SOURCE')
      writeFileSync(join(userData, 'Data', 'Notes', 'a.md'), '# note')
      await exportArchive({ outPath: out })
      return out
    }

    it('compacts omitted resources into durable totals and bounded path samples', async () => {
      const out = join(workDir, 'out', 'degraded-full.cherrybackup')
      await exportArchive({ outPath: out })

      const preview = await prepareRestore({ archivePath: out })
      const read = readRestoreJournalV2()

      expect(preview.degradations).toHaveLength(8)
      expect(read.kind).toBe('ok')
      if (read.kind !== 'ok') return
      expect(read.journal.degradations).toEqual([
        { kind: 'report:resource-unavailable', reason: 'count:8' },
        {
          kind: 'report-sample:resource-unavailable',
          reason: 'sample',
          livePath: 'Data/Files/11111111-1111-4111-8111-111111111111.pdf'
        },
        {
          kind: 'report-sample:resource-unavailable',
          reason: 'sample',
          livePath: 'Data/KnowledgeBase/kb-1'
        },
        { kind: 'report-sample:resource-unavailable', reason: 'sample', livePath: 'Data/Notes' }
      ])
    })

    it('seals an install entry per payload and stages the bytes the journal names', async () => {
      const full = await exportFull()
      for (const resourceRoot of [
        'Files',
        'KnowledgeBase',
        'Notes',
        'Agents',
        'Skills',
        'Workspace',
        'Mcp',
        'Channels'
      ]) {
        rmSync(join(userData, 'Data', resourceRoot), { recursive: true, force: true })
      }

      const preview = await prepareRestore({ archivePath: full })

      expect(preview.resources).toEqual({ install: 8, replace: 0 })
      const read = readRestoreJournalV2()
      if (read.kind !== 'ok') throw new Error('expected a prepared journal')
      expect(read.journal.resourceInstalls.map((entry) => entry.live).sort()).toEqual([
        'Data/Agents/.claude',
        'Data/Agents/system/s-1',
        'Data/Channels',
        'Data/Files/11111111-1111-4111-8111-111111111111.pdf',
        'Data/KnowledgeBase/kb-1',
        'Data/Mcp/memory.json',
        'Data/Notes',
        'Data/Workspace'
      ])
      expect(read.journal.ownerSummary).toEqual({
        knowledge: {
          baseIds: ['kb-1'],
          requiresRebuild: true
        }
      })
      for (const entry of read.journal.resourceInstalls) {
        expect(entry.staging).toBe(`restore-staging/${preview.restoreId}/resources/${entry.live}`)
        // Relocation-safe: everything the gate will rename is userData-relative.
        expect(existsSync(join(userData, entry.staging))).toBe(true)
        expect(entry.aside.startsWith(`restore-aside/${preview.restoreId}/`)).toBe(true)
      }
      expect(
        readFileSync(join(userData, 'restore-staging', preview.restoreId, 'resources', 'Data', 'Notes', 'a.md'), 'utf8')
      ).toBe('# note')
    })

    it('counts the targets it would park aside rather than create', async () => {
      const full = await exportFull()

      const preview = await prepareRestore({ archivePath: full })

      // Same-device restore: every declared target still exists, so every unit
      // replaces rather than installs.
      expect(preview.resources).toEqual({ install: 0, replace: 8 })
    })

    it.each([
      [
        'a symlinked target',
        () => {
          const target = join(userData, 'Data', 'Files', '11111111-1111-4111-8111-111111111111.pdf')
          rmSync(target)
          writeFileSync(join(workDir, 'elsewhere.pdf'), 'ELSEWHERE')
          symlinkSync(join(workDir, 'elsewhere.pdf'), target)
        },
        /target-not-installable/
      ],
      [
        'a symlinked ancestor',
        () => {
          rmSync(join(userData, 'Data', 'Files'), { recursive: true })
          mkdirSync(join(workDir, 'files-elsewhere'))
          symlinkSync(join(workDir, 'files-elsewhere'), join(userData, 'Data', 'Files'))
        },
        /unsafe-ancestor/
      ],
      [
        'a target of the wrong type',
        () => {
          rmSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1'), { recursive: true })
          writeFileSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1'), 'not a base')
        },
        /target-type-mismatch/
      ]
    ])('refuses the whole restore over %s', async (_label, breakTarget, expected) => {
      const full = await exportFull()
      breakTarget()

      // Fail closed, and fail ENTIRELY: a partial plan would promote a database
      // referencing resources nobody promised to deliver.
      await expect(prepareRestore({ archivePath: full })).rejects.toThrow(expected)
      expect(readRestoreJournalV2().kind).toBe('none')
      expect(readdirSync(join(userData, 'restore-staging'))).toEqual([])
      expect(readFileSync(join(userData, 'cherrystudio.sqlite'), 'utf8')).toBe('LIVE-DB')
    })
  })

  describe('preparing while another restore exists', () => {
    it('replaces a prepared restore and takes its staging tree with it', async () => {
      const first = await prepareRestore({ archivePath })

      const second = await prepareRestore({ archivePath })

      // Choosing another archive IS a cancellation of the first; overwriting the
      // journal instead would orphan a staging tree nothing points at.
      expect(second.restoreId).not.toBe(first.restoreId)
      expect(readdirSync(join(userData, 'restore-staging'))).toEqual([second.restoreId])
    })

    it.each([
      [
        'armed',
        async () => {
          const read = readRestoreJournalV2()
          if (read.kind !== 'ok') throw new Error('expected a journal')
          await armPreparedRestore(read.journal.restoreId)
        }
      ],
      [
        'completed',
        async () => {
          const read = readRestoreJournalV2()
          if (read.kind !== 'ok') throw new Error('expected a journal')
          writeRestoreJournalV2({ ...read.journal, state: 'completed' })
        }
      ]
    ])('refuses to prepare over a %s restore', async (_label, advance) => {
      await prepareRestore({ archivePath })
      await advance()

      // A confirmed or finished restore owns the rollback material; a silent
      // overwrite would leave the previous database unreferenced on disk.
      await expect(prepareRestore({ archivePath })).rejects.toThrow(/must be finished/)
      expect(readRestoreJournalV2().kind).toBe('ok')
    })

    it('refuses to prepare over a journal it cannot read', async () => {
      writeFileSync(join(userData, 'restore-journal.json'), '{ not json')

      await expect(prepareRestore({ archivePath })).rejects.toThrow(/unreadable/)
    })
  })

  describe('cancel', () => {
    it('removes the staged tree and the journal, and is idempotent', async () => {
      const preview = await prepareRestore({ archivePath })

      cancelPreparedRestore()

      expect(readRestoreJournalV2().kind).toBe('none')
      expect(existsSync(join(userData, 'restore-staging', preview.restoreId))).toBe(false)

      expect(() => cancelPreparedRestore()).not.toThrow()
    })

    it('refuses to cancel a restore the user already confirmed', async () => {
      const preview = await prepareRestore({ archivePath })
      await armPreparedRestore(preview.restoreId)

      expect(() => cancelPreparedRestore()).toThrow(/only a prepared restore/i)
      expect(readRestoreJournalV2().kind).toBe('ok')
    })
  })

  describe('arm', () => {
    async function prepareFullForArm(): Promise<Awaited<ReturnType<typeof prepareRestore>>> {
      const full = join(workDir, 'out', 'arm-full.cherrybackup')
      createTargetResources()
      writeFileSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1', 'doc.txt'), 'SOURCE')
      writeFileSync(join(userData, 'Data', 'Notes', 'a.md'), '# note')
      await exportArchive({ outPath: full })
      return prepareRestore({ archivePath: full })
    }

    it('writes armed durably before relaunch is initiated', async () => {
      const preview = await prepareFullForArm()
      let stateAtRelaunch: string | undefined
      vi.mocked(application.relaunch).mockImplementation(() => {
        const read = readRestoreJournalV2()
        stateAtRelaunch = read.kind === 'ok' ? read.journal.state : read.kind
      })

      await armPreparedRestore(preview.restoreId)

      // The marker is what the preboot gate acts on; a relaunch that outran it
      // would boot into an unarmed preparation and expire it.
      expect(stateAtRelaunch).toBe('armed')
    })

    it('reseals hadLive from the arm-time topology', async () => {
      const preview = await prepareFullForArm()
      const prepared = readRestoreJournalV2()
      if (prepared.kind !== 'ok') throw new Error('expected prepared restore')
      const knowledge = prepared.journal.resourceInstalls.find((entry) => entry.live === 'Data/KnowledgeBase/kb-1')
      if (!knowledge) throw new Error('expected Knowledge install entry')
      expect(knowledge.hadLive).toBe(true)
      rmSync(join(userData, ...knowledge.live.split('/')), { recursive: true })

      await armPreparedRestore(preview.restoreId)

      const armed = readRestoreJournalV2()
      expect(armed).toMatchObject({ kind: 'ok', journal: { state: 'armed' } })
      if (armed.kind !== 'ok') return
      expect(armed.journal.resourceInstalls.find((entry) => entry.live === knowledge.live)?.hadLive).toBe(false)
    })

    it('reseals a target that appeared after preparation as replaceable', async () => {
      const full = join(workDir, 'out', 'arm-target-added.cherrybackup')
      createTargetResources()
      writeFileSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1', 'doc.txt'), 'SOURCE')
      writeFileSync(join(userData, 'Data', 'Notes', 'a.md'), '# note')
      await exportArchive({ outPath: full })
      rmSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1'), { recursive: true })
      const preview = await prepareRestore({ archivePath: full })
      let prepared = readRestoreJournalV2()
      if (prepared.kind !== 'ok') throw new Error('expected prepared restore')
      expect(prepared.journal.resourceInstalls.find((entry) => entry.live === 'Data/KnowledgeBase/kb-1')?.hadLive).toBe(
        false
      )
      mkdirSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1'), { recursive: true })

      await armPreparedRestore(preview.restoreId)

      prepared = readRestoreJournalV2()
      if (prepared.kind !== 'ok') throw new Error('expected armed restore')
      expect(prepared.journal.resourceInstalls.find((entry) => entry.live === 'Data/KnowledgeBase/kb-1')?.hadLive).toBe(
        true
      )
    })

    it('refuses arm when a staged unit disappeared and leaves the journal prepared', async () => {
      const preview = await prepareFullForArm()
      const prepared = readRestoreJournalV2()
      if (prepared.kind !== 'ok') throw new Error('expected prepared restore')
      const unit = prepared.journal.resourceInstalls[prepared.journal.resourceInstalls.length - 1]
      rmSync(join(userData, ...unit.staging.split('/')), { recursive: true })

      await expect(armPreparedRestore(preview.restoreId)).rejects.toThrow(/staged-missing/)
      expect(readRestoreJournalV2()).toMatchObject({ kind: 'ok', journal: { state: 'prepared' } })
      expect(application.relaunch).not.toHaveBeenCalled()
    })

    it('refuses arm when a live target became a symlink', async () => {
      const preview = await prepareFullForArm()
      const prepared = readRestoreJournalV2()
      if (prepared.kind !== 'ok') throw new Error('expected prepared restore')
      const unit = prepared.journal.resourceInstalls.find((entry) => entry.live === 'Data/KnowledgeBase/kb-1')
      if (!unit) throw new Error('expected Knowledge install entry')
      rmSync(join(userData, ...unit.live.split('/')), { recursive: true })
      mkdirSync(join(userData, 'outside'), { recursive: true })
      symlinkSync(join(userData, 'outside'), join(userData, ...unit.live.split('/')))

      await expect(armPreparedRestore(preview.restoreId)).rejects.toThrow(/target-not-installable/)
      expect(readRestoreJournalV2()).toMatchObject({ kind: 'ok', journal: { state: 'prepared' } })
      expect(application.relaunch).not.toHaveBeenCalled()
    })

    it('refuses arm when an aside slot is already occupied', async () => {
      const preview = await prepareFullForArm()
      const prepared = readRestoreJournalV2()
      if (prepared.kind !== 'ok') throw new Error('expected prepared restore')
      const unit = prepared.journal.resourceInstalls[prepared.journal.resourceInstalls.length - 1]
      mkdirSync(join(userData, ...unit.aside.split('/')), { recursive: true })

      await expect(armPreparedRestore(preview.restoreId)).rejects.toThrow(/aside-occupied/)
      expect(readRestoreJournalV2()).toMatchObject({ kind: 'ok', journal: { state: 'prepared' } })
      expect(application.relaunch).not.toHaveBeenCalled()
    })

    it('rolls the arm back to prepared when relaunch initiation fails', async () => {
      const preview = await prepareRestore({ archivePath })
      vi.mocked(application.relaunch).mockImplementation(() => {
        throw new Error('relaunch refused')
      })

      await expect(armPreparedRestore(preview.restoreId)).rejects.toThrow(/relaunch refused/)

      const read = readRestoreJournalV2()
      expect(read.kind).toBe('ok')
      if (read.kind !== 'ok') return
      // An armed journal nothing is about to consume would promote on the next
      // unrelated restart — a failed button press must not replace a database.
      expect(read.journal.state).toBe('prepared')
    })

    it('refuses to arm an older preparation that has no sealed owner readiness', async () => {
      const preview = await prepareRestore({ archivePath })
      const read = readRestoreJournalV2()
      if (read.kind !== 'ok') throw new Error('expected a prepared restore')
      const { ownerSummary: _ownerSummary, ...legacyPrepared } = read.journal
      writeRestoreJournalV2(legacyPrepared)

      await expect(armPreparedRestore(preview.restoreId)).rejects.toThrow(/predates owner readiness sealing/)

      expect(readRestoreJournalV2()).toMatchObject({ kind: 'ok', journal: { state: 'prepared' } })
      expect(application.relaunch).not.toHaveBeenCalled()
    })

    it('refuses to arm when nothing is prepared', async () => {
      cancelPreparedRestore()

      await expect(armPreparedRestore('missing')).rejects.toThrow(/no prepared restore/i)
    })

    it('refuses a stale preview after another preparation replaced it', async () => {
      const stale = await prepareRestore({ archivePath })
      const current = await prepareRestore({ archivePath })

      await expect(armPreparedRestore(stale.restoreId)).rejects.toThrow(/no longer matches/)

      const read = readRestoreJournalV2()
      expect(read.kind).toBe('ok')
      if (read.kind !== 'ok') return
      expect(read.journal).toMatchObject({ state: 'prepared', restoreId: current.restoreId })
      expect(application.relaunch).not.toHaveBeenCalled()
    })
  })
})
