import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { create } from 'tar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import * as storage from '../agentWorkspaceStorage'
import { agentWorkspaceStorageService as service } from '../AgentWorkspaceStorageService'

const mocks = vi.hoisted(() => ({ close: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AgentSessionRuntimeService: {
      cancelSessionForks: async () => {},
      closeSessionForArchive: mocks.close
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

describe(`workspace storage protocol (${process.platform})`, () => {
  setupTestDatabase()
  let root: string
  let workspace: { id: string; path: string }
  const archive = () => service.archiveWorkspace(workspace)
  const restore = (activate: () => void = () => {}) => service.restoreWorkspaces([workspace], activate)
  const reconcile = (state: 'active' | 'archived' = 'archived') => service.reconcileWorkspace(workspace, state)
  const record = () => readFile(`${workspace.path}.storage.json`, 'utf8').then(JSON.parse)
  const output = (suffix = '') => readFile(path.join(`${workspace.path}${suffix}`, 'result.txt'), 'utf8')

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'workspace-protocol-'))
    workspace = { id: 'session', path: path.join(root, '2026-10-14', 'session') }
    vi.spyOn(application, 'getPath').mockReturnValue(root)
    mocks.close.mockResolvedValue(undefined)
    await mkdir(path.join(workspace.path, 'empty'), { recursive: true })
    await writeFile(path.join(workspace.path, 'result.txt'), 'recoverable output')
    await writeFile(path.join(workspace.path, '.hidden'), Buffer.from([0, 1, 255]))
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('round trips output, binary and hidden files, and empty directories', async () => {
    await archive()
    expect(existsSync(workspace.path)).toBe(false)
    await restore()
    expect(await output()).toBe('recoverable output')
    expect(await readFile(path.join(workspace.path, '.hidden'))).toEqual(Buffer.from([0, 1, 255]))
    expect(existsSync(path.join(workspace.path, 'empty'))).toBe(true)
    expect(existsSync(`${workspace.path}.tar.gz`)).toBe(false)
    expect(existsSync(`${workspace.path}.storage.json`)).toBe(false)
    await archive()
    await archive()
    await restore()
    expect(await output()).toBe('recoverable output')
  })

  it.each(['staging', 'packing', 'publishing'] as const)('resumes archive after durable %s intent', async (phase) => {
    const write = storage.writeWorkspaceStorageRecord
    vi.spyOn(storage, 'writeWorkspaceStorageRecord').mockImplementation(async (target, entry) => {
      await write(target, entry)
      if (entry.operation === 'archive' && entry.phase === phase) throw new Error('interrupted')
    })
    await expect(archive()).rejects.toThrow('interrupted')
    expect((await record()).operation).toBe('archive')
    vi.restoreAllMocks()
    vi.spyOn(application, 'getPath').mockReturnValue(root)
    await reconcile()
    expect(existsSync(workspace.path)).toBe(false)
    await restore()
    expect(await output()).toBe('recoverable output')
  })

  it.each(['preparing', 'prepared', 'published'] as const)(
    'sweep continues restore after %s without activating or recompressing',
    async (phase) => {
      await archive()
      const backup = await readFile(`${workspace.path}.tar.gz`)
      const write = storage.writeWorkspaceStorageRecord
      const failure = vi.spyOn(storage, 'writeWorkspaceStorageRecord').mockImplementation(async (target, entry) => {
        await write(target, entry)
        if (entry.operation === 'restore' && entry.phase === phase) throw new Error('interrupted')
      })
      let activated = false
      await expect(
        restore(() => {
          activated = true
        })
      ).rejects.toThrow('interrupted')
      failure.mockRestore()
      await reconcile()
      await reconcile()
      expect(activated).toBe(false)
      expect((await record()).operation).toBe('restore')
      expect((await record()).phase).toBe('published')
      expect(await readFile(`${workspace.path}.tar.gz`)).toEqual(backup)
      expect(await output()).toBe('recoverable output')
      await restore(() => {
        activated = true
      })
      expect(activated).toBe(true)
      expect(existsSync(`${workspace.path}.tar.gz`)).toBe(false)
    }
  )

  it.each(['archive', 'restore'] as const)(
    'recognizes a %s rename completed before its phase was recorded',
    async (operation) => {
      if (operation === 'restore') await archive()
      const move = storage.moveWorkspacePath
      const failure = vi.spyOn(storage, 'moveWorkspacePath').mockImplementation(async (managedRoot, from, to) => {
        await move(managedRoot, from, to)
        if (to === (operation === 'archive' ? `${workspace.path}.archiving` : workspace.path))
          throw new Error('rename interrupted')
      })
      await expect(operation === 'archive' ? archive() : restore()).rejects.toThrow('rename interrupted')
      failure.mockRestore()
      await reconcile()
      await restore()
      expect(await output()).toBe('recoverable output')
    }
  )

  it('retains the verified archive and intent when source cleanup is interrupted', async () => {
    const remove = storage.removeWorkspaceArtifact
    const failure = vi
      .spyOn(storage, 'removeWorkspaceArtifact')
      .mockImplementation(async (managedRoot, target, identity) => {
        if (target === `${workspace.path}.archiving`) {
          await rm(path.join(target, '.hidden'))
          throw new Error('cleanup interrupted')
        }
        return remove(managedRoot, target, identity)
      })
    await expect(archive()).rejects.toThrow('cleanup interrupted')
    expect((await record()).phase).toBe('publishing')
    failure.mockRestore()
    await restore()
    expect(await readFile(path.join(workspace.path, '.hidden'))).toEqual(Buffer.from([0, 1, 255]))
    expect(await output()).toBe('recoverable output')
  })

  it('keeps the complete pending source when compression fails and can restore it', async () => {
    vi.spyOn(storage, 'packWorkspaceDirectory').mockRejectedValueOnce(new Error('disk full'))
    await expect(archive()).rejects.toThrow('disk full')
    expect(await output('.archiving')).toBe('recoverable output')
    await restore()
    expect(await output()).toBe('recoverable output')
  })

  it.each(['preparing', 'prepared'] as const)(
    'sweep preserves an interrupted pending-source restore at %s',
    async (phase) => {
      vi.spyOn(storage, 'packWorkspaceDirectory').mockRejectedValueOnce(new Error('disk full'))
      await expect(archive()).rejects.toThrow()
      const write = storage.writeWorkspaceStorageRecord
      const failure = vi.spyOn(storage, 'writeWorkspaceStorageRecord').mockImplementation(async (target, entry) => {
        await write(target, entry)
        if (entry.operation === 'restore' && entry.phase === phase) throw new Error('interrupted')
      })
      await expect(restore()).rejects.toThrow('interrupted')
      failure.mockRestore()
      await reconcile()
      await reconcile()
      expect((await record()).operation).toBe('restore')
      expect(await output()).toBe('recoverable output')
      expect(existsSync(`${workspace.path}.tar.gz`)).toBe(false)
      await restore()
      expect(await output()).toBe('recoverable output')
    }
  )

  it('keeps the backup until activation succeeds and accepts a retry after DB failure', async () => {
    await archive()
    const backup = await readFile(`${workspace.path}.tar.gz`)
    await expect(
      restore(() => {
        throw new Error('DB failure')
      })
    ).rejects.toThrow('DB failure')
    await reconcile()
    expect(await readFile(`${workspace.path}.tar.gz`)).toEqual(backup)
    expect((await record()).phase).toBe('published')
    await restore()
    expect(existsSync(`${workspace.path}.tar.gz`)).toBe(false)
  })

  it('resumes a pending source moved into staging before publication', async () => {
    vi.spyOn(storage, 'packWorkspaceDirectory').mockRejectedValueOnce(new Error('disk full'))
    await expect(archive()).rejects.toThrow()
    const move = storage.moveWorkspacePath
    const interruption = vi.spyOn(storage, 'moveWorkspacePath').mockImplementation(async (managedRoot, from, to) => {
      await move(managedRoot, from, to)
      if (from === `${workspace.path}.archiving`) throw new Error('interrupted after staging')
    })
    await expect(restore()).rejects.toThrow('interrupted after staging')
    interruption.mockRestore()
    await reconcile()
    await restore()
    expect(await output()).toBe('recoverable output')
    expect(existsSync(`${workspace.path}.storage.json`)).toBe(false)
  })

  it.each(['committed', 'backup-removed'] as const)('finishes cleanup after %s and DB activation', async (phase) => {
    await archive()
    if (phase === 'committed')
      vi.spyOn(storage, 'removeWorkspaceArtifact').mockRejectedValueOnce(new Error('cleanup failed'))
    else vi.spyOn(storage, 'clearWorkspaceStorageRecord').mockRejectedValueOnce(new Error('cleanup failed'))
    let activated = false
    await restore(() => {
      activated = true
    })
    expect(activated).toBe(true)
    expect((await record()).phase).toBe('committed')
    await reconcile('active')
    expect(existsSync(`${workspace.path}.storage.json`)).toBe(false)
    expect(existsSync(`${workspace.path}.tar.gz`)).toBe(false)
    expect(await output()).toBe('recoverable output')
  })

  it('archives changes made after a published restore using the live directory', async () => {
    await archive()
    await expect(
      restore(() => {
        throw new Error('DB failure')
      })
    ).rejects.toThrow()
    await writeFile(path.join(workspace.path, 'result.txt'), 'newer output')
    await archive()
    await restore()
    expect(await output()).toBe('newer output')
  })

  it.each(['directory', 'archive', 'record'] as const)(
    'refuses recovery when its %s evidence was replaced',
    async (kind) => {
      await archive()
      const backup = await readFile(`${workspace.path}.tar.gz`)
      await expect(
        restore(() => {
          throw new Error('DB failure')
        })
      ).rejects.toThrow()
      if (kind === 'directory') {
        await rename(workspace.path, `${workspace.path}.kept`)
        await mkdir(workspace.path)
        await writeFile(path.join(workspace.path, 'keep.txt'), 'unrelated')
      } else if (kind === 'archive') await writeFile(`${workspace.path}.tar.gz`, 'replacement')
      else await writeFile(`${workspace.path}.storage.json`, '{broken')
      await expect(restore()).rejects.toThrow()
      await expect(reconcile('active')).rejects.toThrow()
      if (kind !== 'archive') expect(await readFile(`${workspace.path}.tar.gz`)).toEqual(backup)
      else expect(await readFile(`${workspace.path}.tar.gz`, 'utf8')).toBe('replacement')
    }
  )

  it('rejects corrupt archives and traversal entries before publishing', async () => {
    await archive()
    await writeFile(`${workspace.path}.tar.gz`, 'corrupt')
    await expect(restore()).rejects.toThrow()
    expect(existsSync(workspace.path)).toBe(false)
    await service.purgeWorkspace(workspace)
    await mkdir(workspace.path)
    await writeFile(path.join(workspace.path, 'result.txt'), 'safe')
    await create({ cwd: workspace.path, file: `${workspace.path}.tar.gz`, gzip: true, prefix: '../escape' }, [
      'result.txt'
    ])
    await rm(workspace.path, { recursive: true })
    await expect(restore()).rejects.toThrow('Unsafe workspace archive entry')
    expect(existsSync(path.join(root, '2026-10-14', 'escape'))).toBe(false)
  })

  it('preserves external link targets and retains a recoverable source', async () => {
    const linked = path.join(root, 'linked')
    await mkdir(linked)
    await writeFile(path.join(linked, 'keep.txt'), 'external')
    await symlink(linked, path.join(workspace.path, 'link'), 'junction')
    await expect(archive()).rejects.toThrow()
    expect(await output('.archiving')).toBe('recoverable output')
    expect(await readFile(path.join(linked, 'keep.txt'), 'utf8')).toBe('external')
  })

  it('leaves an unmaterialized workspace unmaterialized', async () => {
    await rm(workspace.path, { recursive: true })
    let activated = false
    await restore(() => {
      activated = true
    })
    expect(activated).toBe(true)
    expect(existsSync(workspace.path)).toBe(false)
    expect(existsSync(`${workspace.path}.storage.json`)).toBe(false)
  })

  it('retains purge intent when native shutdown fails and sweeps it as a group', async () => {
    await archive()
    await writeFile(path.join(root, 'keep.txt'), 'keep')
    mocks.close.mockRejectedValueOnce(new Error('native still open'))
    await expect(service.purgeWorkspace(workspace)).rejects.toThrow('native still open')
    expect((await record()).operation).toBe('purge')
    expect(existsSync(`${workspace.path}.tar.gz`)).toBe(true)
    await service.reclaimOrphanWorkspace(workspace.path, { now: Date.now() + 60_000, freshnessGateMs: 0 })
    expect(service.workspaceStoragePaths(workspace.path).some(existsSync)).toBe(false)
    expect(await readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('freshness of any orphan artifact protects its operation and every copy', async () => {
    await archive()
    await mkdir(`${workspace.path}.restoring`)
    const backup = await readFile(`${workspace.path}.tar.gz`)
    expect(await service.reclaimOrphanWorkspace(workspace.path, { now: Date.now(), freshnessGateMs: 300_000 })).toEqual(
      []
    )
    expect(await readFile(`${workspace.path}.tar.gz`)).toEqual(backup)
    expect(existsSync(`${workspace.path}.restoring`)).toBe(true)
  })

  it('retains deletion intent through partial removal and retries the remaining artifacts', async () => {
    await archive()
    const remove = storage.removeWorkspaceArtifact
    const interruption = vi
      .spyOn(storage, 'removeWorkspaceArtifact')
      .mockImplementation(async (managedRoot, target, identity) => {
        await remove(managedRoot, target, identity)
        if (target === `${workspace.path}.tar.gz`) throw new Error('interrupted deletion')
      })
    await expect(service.purgeWorkspace(workspace)).rejects.toThrow('interrupted deletion')
    expect((await record()).operation).toBe('purge')
    interruption.mockRestore()
    await service.reclaimOrphanWorkspace(workspace.path, { now: Date.now() + 60_000, freshnessGateMs: 0 })
    expect(service.workspaceStoragePaths(workspace.path).some(existsSync)).toBe(false)
  })

  it('refuses root and outside paths', async () => {
    await expect(service.archiveWorkspace({ id: 'root', path: root })).rejects.toThrow()
    await expect(service.archiveWorkspace({ id: 'outside', path: path.dirname(root) })).rejects.toThrow()
    expect(await output()).toBe('recoverable output')
  })
})
