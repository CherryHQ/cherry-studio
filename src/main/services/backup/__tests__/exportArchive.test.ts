import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { application } from '@application'
import { snapshotTo } from '@data/db/restore/snapshot'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { fileEntryTable } from '@data/db/schemas/file'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { noteTable } from '@data/db/schemas/note'
import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { admitArchive } from '../admission/admitArchive'
import { diskProbe } from '../diskPreflight'
import { InsufficientDiskSpaceError, OutputPathExistsError } from '../errors'
import { exportLiteArchive } from '../exportArchive'

/**
 * End-to-end proof for the Lite export path: a real migrated database in, a
 * `.cherrybackup` out, and the same archive back through the Phase 1b-ii
 * admission gate unchanged. The round trip is the point — it is the only check
 * that proves the producer and the hostile-input consumer still agree on layout,
 * hashes, chain identity, and manifest shape.
 */

describe('exportLiteArchive', () => {
  const dbh = setupTestDatabase()
  let workDir: string
  let userData: string
  let outPath: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'cs-export-'))
    userData = join(workDir, 'userData')
    outPath = join(workDir, 'out', 'backup.cherrybackup')
    mkdirSync(join(workDir, 'out'), { recursive: true })
    mkdirSync(join(userData, 'backup-temp'), { recursive: true })

    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      const base = pathFor(key)
      return filename ? join(base, filename) : base
    })
    // `createSnapshot` is already a `vi.fn()` on the shared DbService mock, and
    // the harness clears it during teardown. Giving it an implementation (rather
    // than spying over it) keeps it a mock function so that teardown still works.
    snapshotMock().mockImplementation((target: string) => {
      snapshotTo(dbh.sqlite, target)
    })
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
        return dbh.sqlite.name
      case 'feature.backup.temp':
        return join(userData, 'backup-temp')
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
        throw new Error(`Unexpected path key in export test: ${key}`)
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

  it('publishes a Lite archive that admission accepts unchanged', async () => {
    seedResources()

    const result = await exportLiteArchive({ outPath })

    expect(existsSync(outPath)).toBe(true)
    expect(result.manifest.preset).toBe('lite')
    expect(result.manifest).not.toHaveProperty('resourcePayloads')

    const stagingParent = await mkdtemp(join(tmpdir(), 'cs-admit-'))
    const admitted = await admitArchive({
      archivePath: outPath,
      stagingParent,
      migrationsFolder: resolveMigrationsPath()
    })
    try {
      expect(admitted.manifest.db.hash).toBe(result.manifest.db.hash)
      expect(admitted.resources).toEqual([])
      expect(admitted.migratedForward).toBe(false)
    } finally {
      await admitted.cleanup()
      rmSync(stagingParent, { recursive: true, force: true })
    }
  })

  it('carries the producer roots and requirement inventory a cross-device restore needs', async () => {
    seedResources()

    const { manifest } = await exportLiteArchive({ outPath })

    // Without these two roots the materializer cannot rebase note.rootPath or
    // agent_workspace.path on another machine.
    expect(manifest.producer.managedRoots.map((r) => r.key).sort()).toEqual([
      'feature.agents.workspaces',
      'feature.notes.data'
    ])
    expect(manifest.migrationChain.length).toBeGreaterThan(0)

    const byKind = (kind: string) => manifest.resourceRequirements.filter((r) => r.kind === kind).map((r) => r.livePath)
    expect(byKind('file-blob')).toEqual(['Data/Files/11111111-1111-4111-8111-111111111111.pdf'])
    expect(byKind('knowledge-base')).toEqual(['Data/KnowledgeBase/kb-1'])
    expect(byKind('note-root')).toEqual(['Data/Notes'])
    expect(byKind('agent-workspace')).toEqual(['Data/Agents/s-1'])
  })

  it('derives requirements without reading a single target resource byte', async () => {
    seedResources()
    // Nothing under `userData/Data` exists on disk — no Files, no KnowledgeBase,
    // no Notes, no Agents. A producer that stat-ed its targets would report an
    // empty inventory here.
    expect(existsSync(join(userData, 'Data'))).toBe(false)

    const { manifest } = await exportLiteArchive({ outPath })

    expect(manifest.resourceRequirements).toHaveLength(4)
  })

  it('leaves no staging tree behind on success', async () => {
    await exportLiteArchive({ outPath })

    expect(readdirSync(join(userData, 'backup-temp'))).toEqual([])
  })

  it('removes its staging tree and writes nothing when publication fails', async () => {
    await exportLiteArchive({ outPath })
    const before = readFileSync(outPath)

    await expect(exportLiteArchive({ outPath })).rejects.toBeInstanceOf(OutputPathExistsError)

    // The prior good backup survives byte-for-byte, and nothing is left staged.
    expect(readFileSync(outPath)).toEqual(before)
    expect(readdirSync(join(userData, 'backup-temp'))).toEqual([])
  })

  it('fails before snapshotting when the staging volume has no headroom', async () => {
    vi.spyOn(diskProbe, 'statfs').mockResolvedValue({ bavail: 0n, bsize: 4096n } as never)
    await expect(exportLiteArchive({ outPath })).rejects.toBeInstanceOf(InsufficientDiskSpaceError)

    expect(snapshotMock()).not.toHaveBeenCalled()
    expect(existsSync(outPath)).toBe(false)
    expect(readdirSync(join(userData, 'backup-temp'))).toEqual([])
  })

  it('aborts at the first cancellation checkpoint and cleans up', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(exportLiteArchive({ outPath, signal: controller.signal })).rejects.toThrow(/cancel/i)

    expect(existsSync(outPath)).toBe(false)
  })
})
