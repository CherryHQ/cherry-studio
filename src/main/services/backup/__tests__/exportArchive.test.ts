import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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
import { exportArchive } from '../exportArchive'
import { driftHooks } from '../sourceDrift'

/**
 * End-to-end proof for the export path: a real migrated database in, a
 * `.cherrybackup` out, and the same archive back through the Phase 1b-ii
 * admission gate unchanged. The round trip is the point — it is the only check
 * that proves the producer and the hostile-input consumer still agree on layout,
 * hashes, chain identity, and manifest shape.
 */

describe('exportArchive', () => {
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
    driftHooks.afterInitialLstat = async () => {}
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
      case 'feature.agents.data':
        return join(userData, 'Data', 'Agents')
      case 'feature.agents.system_workspaces':
        return join(userData, 'Data', 'Agents', 'system')
      case 'feature.agents.skills':
        return join(userData, 'Data', 'Skills')
      default:
        throw new Error(`Unexpected path key in export test: ${key}`)
    }
  }

  /** Create a file's parent directories and hand the path back for writing. */
  function mkFile(absPath: string): string {
    mkdirSync(dirname(absPath), { recursive: true })
    return absPath
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

  it('publishes a Full archive whose payloads admission re-verifies byte for byte', async () => {
    seedResources()
    writeFileSync(mkFile(join(userData, 'Data', 'Files', '11111111-1111-4111-8111-111111111111.pdf')), 'BLOB')
    writeFileSync(mkFile(join(userData, 'Data', 'KnowledgeBase', 'kb-1', 'raw', 'doc.txt')), 'SOURCE')
    // Derived state export drops on purpose (§6.7) — it is rebuilt after restore.
    writeFileSync(mkFile(join(userData, 'Data', 'KnowledgeBase', 'kb-1', '.cherry', 'index.sqlite')), 'INDEX')
    writeFileSync(mkFile(join(userData, 'Data', 'Notes', 'a.md')), '# note')
    mkdirSync(join(userData, 'Data', 'Notes', 'empty', 'nested'), { recursive: true })
    // Declared by a row but not present here: a degraded archive, not a failure.
    expect(existsSync(join(userData, 'Data', 'Agents', 'system', 's-1'))).toBe(false)

    const result = await exportArchive({ outPath })

    expect(result.manifest.preset).toBe('full')
    expect(result.manifest.producer.buildType).toBe('development')
    const payloads = result.manifest.resourcePayloads
    expect(payloads.map((p) => p.livePath).sort()).toEqual([
      'Data/Files/11111111-1111-4111-8111-111111111111.pdf',
      'Data/KnowledgeBase/kb-1',
      'Data/Notes'
    ])
    expect(result.manifest.degradations).toContainEqual({
      kind: 'resource:agent-workspace',
      livePath: 'Data/Agents/system/s-1',
      reason: 'absent-at-snapshot'
    })

    const stagingParent = await mkdtemp(join(tmpdir(), 'cs-admit-'))
    const admitted = await admitArchive({
      archivePath: outPath,
      stagingParent,
      migrationsFolder: resolveMigrationsPath()
    })
    try {
      // Admission recomputes every hash from the extracted bytes; agreement here
      // is the producer/consumer contract for directory units as well as files.
      expect(admitted.resources.map((r) => r.livePath).sort()).toEqual(payloads.map((p) => p.livePath).sort())
      const kb = admitted.resources.find((r) => r.livePath === 'Data/KnowledgeBase/kb-1')
      expect(kb?.hash).toBe(payloads.find((p) => p.livePath === 'Data/KnowledgeBase/kb-1')?.hash)
      expect(existsSync(join(kb!.stagedPath, '.cherry', 'index.sqlite'))).toBe(false)
      expect(readFileSync(join(kb!.stagedPath, 'raw', 'doc.txt'), 'utf8')).toBe('SOURCE')
      const notes = admitted.resources.find((resource) => resource.livePath === 'Data/Notes')
      expect(existsSync(join(notes!.stagedPath, 'empty', 'nested'))).toBe(true)
    } finally {
      await admitted.cleanup()
      rmSync(stagingParent, { recursive: true, force: true })
    }
  })

  it('publishes an archive with no payloads when this device holds none', async () => {
    seedResources()

    const { manifest } = await exportArchive({ outPath })

    expect(manifest.resourcePayloads).toEqual([])
    // Every requirement is still declared, so the restoring device can report
    // exactly what this archive could not carry.
    expect(manifest.resourceRequirements).toHaveLength(4)
    expect(manifest.degradations).toHaveLength(4)
  })

  it('carries the producer roots and requirement inventory a cross-device restore needs', async () => {
    seedResources()

    const { manifest } = await exportArchive({ outPath })

    // Without these two roots the materializer cannot rebase note.rootPath or
    // agent_workspace.path on another machine.
    expect(manifest.producer.managedRoots.map((r) => r.key).sort()).toEqual([
      'feature.agents.system_workspaces',
      'feature.notes.data'
    ])
    expect(manifest.migrationChain.length).toBeGreaterThan(0)

    const byKind = (kind: string) => manifest.resourceRequirements.filter((r) => r.kind === kind).map((r) => r.livePath)
    expect(byKind('file-blob')).toEqual(['Data/Files/11111111-1111-4111-8111-111111111111.pdf'])
    expect(byKind('knowledge-base')).toEqual(['Data/KnowledgeBase/kb-1'])
    expect(byKind('note-root')).toEqual(['Data/Notes'])
    expect(byKind('agent-workspace')).toEqual(['Data/Agents/system/s-1'])
  })

  it('derives requirements without reading a single target resource byte', async () => {
    seedResources()
    // Nothing under `userData/Data` exists on disk — no Files, no KnowledgeBase,
    // no Notes, no Agents. A producer that stat-ed its targets would report an
    // empty inventory here.
    expect(existsSync(join(userData, 'Data'))).toBe(false)

    const { manifest } = await exportArchive({ outPath })

    expect(manifest.resourceRequirements).toHaveLength(4)
  })

  it('leaves no staging tree behind on success', async () => {
    await exportArchive({ outPath })

    expect(readdirSync(join(userData, 'backup-temp'))).toEqual([])
  })

  it('removes its staging tree and writes nothing when publication fails', async () => {
    await exportArchive({ outPath })
    const before = readFileSync(outPath)

    await expect(exportArchive({ outPath })).rejects.toBeInstanceOf(OutputPathExistsError)

    // The prior good backup survives byte-for-byte, and nothing is left staged.
    expect(readFileSync(outPath)).toEqual(before)
    expect(readdirSync(join(userData, 'backup-temp'))).toEqual([])
  })

  it('fails before snapshotting when the staging volume has no headroom', async () => {
    vi.spyOn(diskProbe, 'statfs').mockResolvedValue({ bavail: 0n, bsize: 4096n } as never)
    await expect(exportArchive({ outPath })).rejects.toBeInstanceOf(InsufficientDiskSpaceError)

    expect(snapshotMock()).not.toHaveBeenCalled()
    expect(existsSync(outPath)).toBe(false)
    expect(readdirSync(join(userData, 'backup-temp'))).toEqual([])
  })

  it('preflights all resource bytes before copying the first resource', async () => {
    dbh.db
      .insert(fileEntryTable)
      .values({ id: '22222222-2222-4222-8222-222222222222', origin: 'internal', name: 'b', ext: 'bin', size: 4 })
      .run()
    writeFileSync(mkFile(join(userData, 'Data', 'Files', '22222222-2222-4222-8222-222222222222.bin')), 'DATA')

    const statfs = vi.spyOn(diskProbe, 'statfs')
    statfs.mockResolvedValueOnce({ bavail: 1_000_000_000n, bsize: 4096n } as never)
    statfs.mockResolvedValueOnce({ bavail: 0n, bsize: 4096n } as never)
    let copied = false
    driftHooks.afterInitialLstat = async () => {
      copied = true
    }

    await expect(exportArchive({ outPath })).rejects.toBeInstanceOf(InsufficientDiskSpaceError)

    expect(snapshotMock()).toHaveBeenCalledOnce()
    expect(copied).toBe(false)
    expect(existsSync(outPath)).toBe(false)
    expect(readdirSync(join(userData, 'backup-temp'))).toEqual([])
  })

  it('aborts at the first cancellation checkpoint and cleans up', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(exportArchive({ outPath, signal: controller.signal })).rejects.toThrow(/cancel/i)

    expect(existsSync(outPath)).toBe(false)
  })
})
