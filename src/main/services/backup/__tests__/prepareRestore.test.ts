import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { application } from '@application'
import { readRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { snapshotTo } from '@data/db/restore/snapshot'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { fileEntryTable } from '@data/db/schemas/file'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { noteTable } from '@data/db/schemas/note'
import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { exportArchive } from '../exportArchive'
import { armPreparedRestore, cancelPreparedRestore, prepareLiteRestore } from '../prepareRestore'

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
    snapshotMock().mockImplementation((target: string) => snapshotTo(dbh.sqlite, target))

    seedResources()
    await exportArchive({ outPath: archivePath, preset: 'lite' })
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
    snapshotMock().mockReset()
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
      case 'feature.files.data':
        return join(userData, 'Data', 'Files')
      case 'feature.knowledgebase.data':
        return join(userData, 'Data', 'KnowledgeBase')
      case 'feature.notes.data':
        return join(userData, 'Data', 'Notes')
      case 'feature.agents.workspaces':
        return join(userData, 'Data', 'Agents')
      case 'feature.agents.skills':
        return join(userData, 'Data', 'Skills')
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
      .values({ id: 'w-1', name: 'ws', path: join(userData, 'Data', 'Agents', 's-1'), type: 'system', orderKey: 'a' })
      .run()
  }

  /** Materialize the resources the seeded database references. */
  function createTargetResources(): void {
    mkdirSync(join(userData, 'Data', 'Files'), { recursive: true })
    writeFileSync(join(userData, 'Data', 'Files', '11111111-1111-4111-8111-111111111111.pdf'), 'blob')
    mkdirSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1'), { recursive: true })
    mkdirSync(join(userData, 'Data', 'Notes'), { recursive: true })
    mkdirSync(join(userData, 'Data', 'Agents', 's-1'), { recursive: true })
  }

  describe('prepare', () => {
    it('reports every resource available on the device that produced the archive', async () => {
      createTargetResources()

      const preview = await prepareLiteRestore({ archivePath })

      expect(preview.coverage).toEqual({ available: 4, missing: 0, unverifiable: 0 })
      expect(preview.preset).toBe('lite')
    })

    it('reports resources missing on an empty device without creating any of them', async () => {
      const preview = await prepareLiteRestore({ archivePath })

      expect(preview.coverage).toEqual({ available: 0, missing: 4, unverifiable: 0 })
      // Diagnostic only: a coverage probe must never conjure the content it
      // failed to find.
      expect(existsSync(join(userData, 'Data'))).toBe(false)
    })

    it('counts a wrong-typed target as missing rather than available', async () => {
      createTargetResources()
      // A file standing where the Knowledge base directory belongs.
      rmSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1'), { recursive: true })
      writeFileSync(join(userData, 'Data', 'KnowledgeBase', 'kb-1'), 'not a directory')

      const preview = await prepareLiteRestore({ archivePath })

      expect(preview.coverage).toEqual({ available: 3, missing: 1, unverifiable: 0 })
    })

    it('writes a prepared journal pointing at a staged database that exists', async () => {
      const preview = await prepareLiteRestore({ archivePath })

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
      const preview = await prepareLiteRestore({ archivePath })

      expect(readdirSync(join(userData, 'restore-staging'))).toEqual([preview.restoreId])
    })

    it('does not touch the live database', async () => {
      await prepareLiteRestore({ archivePath })

      expect(readFileSync(join(userData, 'cherrystudio.sqlite'), 'utf8')).toBe('LIVE-DB')
    })
  })

  describe('cancel', () => {
    it('removes the staged tree and the journal, and is idempotent', async () => {
      const preview = await prepareLiteRestore({ archivePath })

      cancelPreparedRestore()

      expect(readRestoreJournalV2().kind).toBe('none')
      expect(existsSync(join(userData, 'restore-staging', preview.restoreId))).toBe(false)

      expect(() => cancelPreparedRestore()).not.toThrow()
    })

    it('refuses to cancel a restore the user already confirmed', async () => {
      await prepareLiteRestore({ archivePath })
      armPreparedRestore()

      expect(() => cancelPreparedRestore()).toThrow(/only a prepared restore/i)
      expect(readRestoreJournalV2().kind).toBe('ok')
    })
  })

  describe('arm', () => {
    it('writes armed durably before relaunch is initiated', async () => {
      await prepareLiteRestore({ archivePath })
      let stateAtRelaunch: string | undefined
      vi.mocked(application.relaunch).mockImplementation(() => {
        const read = readRestoreJournalV2()
        stateAtRelaunch = read.kind === 'ok' ? read.journal.state : read.kind
      })

      armPreparedRestore()

      // The marker is what the preboot gate acts on; a relaunch that outran it
      // would boot into an unarmed preparation and expire it.
      expect(stateAtRelaunch).toBe('armed')
    })

    it('rolls the arm back to prepared when relaunch initiation fails', async () => {
      await prepareLiteRestore({ archivePath })
      vi.mocked(application.relaunch).mockImplementation(() => {
        throw new Error('relaunch refused')
      })

      expect(() => armPreparedRestore()).toThrow(/relaunch refused/)

      const read = readRestoreJournalV2()
      expect(read.kind).toBe('ok')
      if (read.kind !== 'ok') return
      // An armed journal nothing is about to consume would promote on the next
      // unrelated restart — a failed button press must not replace a database.
      expect(read.journal.state).toBe('prepared')
    })

    it('refuses to arm when nothing is prepared', () => {
      cancelPreparedRestore()

      expect(() => armPreparedRestore()).toThrow(/no prepared restore/i)
    })
  })
})
