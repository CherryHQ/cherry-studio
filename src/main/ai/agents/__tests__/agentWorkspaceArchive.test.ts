import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { create } from 'tar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  archiveSystemWorkspace,
  finalizeSystemWorkspaceRestore,
  purgeSystemWorkspace,
  restoreSystemWorkspace as prepareRestore
} from '../agentWorkspaceArchive'

async function restoreSystemWorkspace(root: string, workspace: string) {
  await prepareRestore(root, workspace)
  await finalizeSystemWorkspaceRestore(root, workspace)
}

describe('system workspace archives', () => {
  let root: string
  let workspace: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'workspace-archive-'))
    workspace = path.join(root, '2026-10-12', 'session')
    await mkdir(path.join(workspace, 'empty'), { recursive: true })
    await writeFile(path.join(workspace, 'result.txt'), 'recoverable output')
    await writeFile(path.join(workspace, '.hidden'), Buffer.from([0, 1, 255]))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('releases the directory and restores all output, hidden files and empty directories at the original path', async () => {
    await archiveSystemWorkspace(root, workspace)
    expect(existsSync(workspace)).toBe(false)
    expect(existsSync(`${workspace}.tar.gz`)).toBe(true)
    await restoreSystemWorkspace(root, workspace)
    expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('recoverable output')
    expect(await readFile(path.join(workspace, '.hidden'))).toEqual(Buffer.from([0, 1, 255]))
    expect(existsSync(path.join(workspace, 'empty'))).toBe(true)
    expect(existsSync(`${workspace}.tar.gz`)).toBe(false)
  })

  it('can restore after interruption before compression, and retry an already completed archive', async () => {
    await rename(workspace, `${workspace}.archiving`)
    await restoreSystemWorkspace(root, workspace)
    expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('recoverable output')
    await archiveSystemWorkspace(root, workspace)
    await archiveSystemWorkspace(root, workspace)
    await restoreSystemWorkspace(root, workspace)
    expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('recoverable output')
  })

  it('keeps a corrupt archive and does not publish a partial restored directory', async () => {
    await archiveSystemWorkspace(root, workspace)
    await writeFile(`${workspace}.tar.gz`, 'broken archive')
    await expect(restoreSystemWorkspace(root, workspace)).rejects.toThrow()
    expect(existsSync(workspace)).toBe(false)
    expect(existsSync(`${workspace}.tar.gz`)).toBe(true)
  })

  it('retains the original directory when links cannot be safely archived', async () => {
    const linked = path.join(root, 'linked')
    await mkdir(linked)
    await writeFile(path.join(linked, 'keep.txt'), 'external')
    await symlink(linked, path.join(workspace, 'link'), 'junction')
    await expect(archiveSystemWorkspace(root, workspace)).rejects.toThrow()
    expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('recoverable output')
    expect(await readFile(path.join(linked, 'keep.txt'), 'utf8')).toBe('external')
    expect(existsSync(`${workspace}.tar.gz`)).toBe(false)
  })

  it('puts the original directory back when writing the compressed file fails', async () => {
    await mkdir(`${workspace}.tar.gz.tmp`)
    await expect(archiveSystemWorkspace(root, workspace)).rejects.toThrow()
    expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('recoverable output')
    expect(existsSync(`${workspace}.archiving`)).toBe(false)
    expect(existsSync(`${workspace}.tar.gz`)).toBe(false)
  })

  it('rejects archive paths that escape the workspace before extracting anything', async () => {
    await create({ cwd: workspace, file: `${workspace}.tar.gz`, gzip: true, prefix: '../escape' }, ['result.txt'])
    await rm(workspace, { recursive: true })
    await expect(restoreSystemWorkspace(root, workspace)).rejects.toThrow('Unsafe workspace archive entry')
    expect(existsSync(path.join(root, '2026-10-12', 'escape'))).toBe(false)
    expect(existsSync(workspace)).toBe(false)
  })

  it('restores from a complete archive after interruption during directory removal', async () => {
    await archiveSystemWorkspace(root, workspace)
    await mkdir(`${workspace}.archiving`)
    await writeFile(path.join(`${workspace}.archiving`, 'result.txt'), 'partial residue')
    await mkdir(`${workspace}.restoring`)
    await writeFile(path.join(`${workspace}.restoring`, 'result.txt'), 'partial extraction')
    await restoreSystemWorkspace(root, workspace)
    expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('recoverable output')
    expect(await readFile(path.join(`${workspace}.archiving`, 'result.txt'), 'utf8')).toBe('partial residue')
    expect(await readFile(path.join(`${workspace}.restoring`, 'result.txt'), 'utf8')).toBe('partial extraction')
  })

  it.each(['file', 'directory'] as const)(
    'preserves the only archive when an unknown %s occupies the destination',
    async (type) => {
      await archiveSystemWorkspace(root, workspace)
      const archive = await readFile(`${workspace}.tar.gz`)
      if (type === 'file') await writeFile(workspace, 'unrelated file')
      else {
        await mkdir(workspace)
        await writeFile(path.join(workspace, 'keep.txt'), 'unrelated directory')
      }
      await expect(prepareRestore(root, workspace)).rejects.toThrow()
      expect(await readFile(`${workspace}.tar.gz`)).toEqual(archive)
      expect(await readFile(type === 'file' ? workspace : path.join(workspace, 'keep.txt'), 'utf8')).toMatch(
        'unrelated'
      )
    }
  )

  it('retries a published restore while retaining its archive until completion', async () => {
    await archiveSystemWorkspace(root, workspace)
    const archive = await readFile(`${workspace}.tar.gz`)
    await prepareRestore(root, workspace)
    expect(await readFile(`${workspace}.tar.gz`)).toEqual(archive)
    await prepareRestore(root, workspace)
    expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('recoverable output')
    await finalizeSystemWorkspaceRestore(root, workspace)
    expect(existsSync(`${workspace}.tar.gz`)).toBe(false)
    expect(existsSync(`${workspace}.restore.json`)).toBe(false)
  })

  it.each(['archive', 'pending'] as const)(
    'resumes %s restoration after recording preparation but before publication',
    async (source) => {
      if (source === 'archive') await archiveSystemWorkspace(root, workspace)
      else await rename(workspace, `${workspace}.archiving`)
      await prepareRestore(root, workspace)
      const record = JSON.parse(await readFile(`${workspace}.restore.json`, 'utf8')) as { operationId: string }
      await rename(workspace, path.join(`${workspace}.restoring`, record.operationId))
      expect(existsSync(workspace)).toBe(false)
      expect(existsSync(`${workspace}.restore.json`)).toBe(true)
      await restoreSystemWorkspace(root, workspace)
      expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('recoverable output')
    }
  )

  it('retains the archive when the published directory is replaced', async () => {
    await archiveSystemWorkspace(root, workspace)
    const archive = await readFile(`${workspace}.tar.gz`)
    await prepareRestore(root, workspace)
    await rename(workspace, `${workspace}.kept`)
    await mkdir(workspace)
    await writeFile(path.join(workspace, 'keep.txt'), 'replacement')
    await expect(prepareRestore(root, workspace)).rejects.toThrow('destination changed')
    await expect(finalizeSystemWorkspaceRestore(root, workspace)).rejects.toThrow('destination changed')
    expect(await readFile(`${workspace}.tar.gz`)).toEqual(archive)
    expect(await readFile(path.join(workspace, 'keep.txt'), 'utf8')).toBe('replacement')
  })

  it('retains a replacement archive rather than deleting it during completion', async () => {
    await archiveSystemWorkspace(root, workspace)
    await prepareRestore(root, workspace)
    await writeFile(`${workspace}.tar.gz`, 'replacement archive')
    await expect(finalizeSystemWorkspaceRestore(root, workspace)).rejects.toThrow('archive changed')
    expect(await readFile(`${workspace}.tar.gz`, 'utf8')).toBe('replacement archive')
    expect(existsSync(`${workspace}.restore.json`)).toBe(true)
  })

  it('preserves an archive when its restore record is corrupt', async () => {
    await archiveSystemWorkspace(root, workspace)
    const archive = await readFile(`${workspace}.tar.gz`)
    await writeFile(`${workspace}.restore.json`, '{broken')
    await expect(prepareRestore(root, workspace)).rejects.toThrow()
    expect(await readFile(`${workspace}.tar.gz`)).toEqual(archive)
    expect(existsSync(workspace)).toBe(false)
  })

  it('returns an unmaterialized workspace without creating storage', async () => {
    await rm(workspace, { recursive: true })
    await expect(prepareRestore(root, workspace)).resolves.toEqual({ kind: 'unmaterialized' })
    expect(existsSync(workspace)).toBe(false)
    expect(existsSync(`${workspace}.restoring`)).toBe(false)
  })

  it('retains a pending directory when writing the restore record fails', async () => {
    await rename(workspace, `${workspace}.archiving`)
    await mkdir(`${workspace}.restore.json.tmp`)
    await expect(prepareRestore(root, workspace)).rejects.toThrow()
    expect(await readFile(path.join(`${workspace}.archiving`, 'result.txt'), 'utf8')).toBe('recoverable output')
    await rm(`${workspace}.restore.json.tmp`, { recursive: true })
    await restoreSystemWorkspace(root, workspace)
    expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('recoverable output')
  })

  it('purges the archive and interrupted-operation artifacts without touching siblings', async () => {
    await archiveSystemWorkspace(root, workspace)
    await mkdir(`${workspace}.restoring`)
    await writeFile(path.join(root, 'keep.txt'), 'keep')
    await purgeSystemWorkspace(root, workspace)
    expect(existsSync(`${workspace}.tar.gz`)).toBe(false)
    expect(existsSync(`${workspace}.restoring`)).toBe(false)
    expect(await readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('rearchives a published restore without losing files newer than the old snapshot', async () => {
    await archiveSystemWorkspace(root, workspace)
    const oldArchive = await readFile(`${workspace}.tar.gz`)
    await restoreSystemWorkspace(root, workspace)
    await writeFile(`${workspace}.tar.gz`, oldArchive)
    await writeFile(path.join(workspace, 'result.txt'), 'newer output')
    await writeFile(path.join(workspace, 'new.txt'), 'new file')
    await archiveSystemWorkspace(root, workspace)
    expect(existsSync(workspace)).toBe(false)
    await restoreSystemWorkspace(root, workspace)
    expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('newer output')
    expect(await readFile(path.join(workspace, 'new.txt'), 'utf8')).toBe('new file')
  })

  it('retains newer restored files when recompression fails and recovers on retry', async () => {
    await archiveSystemWorkspace(root, workspace)
    const oldArchive = await readFile(`${workspace}.tar.gz`)
    await restoreSystemWorkspace(root, workspace)
    await writeFile(`${workspace}.tar.gz`, oldArchive)
    await writeFile(path.join(workspace, 'result.txt'), 'newer output')
    await mkdir(`${workspace}.tar.gz.tmp`)
    await expect(archiveSystemWorkspace(root, workspace)).rejects.toThrow()
    expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('newer output')
    await rm(`${workspace}.tar.gz.tmp`, { recursive: true })
    await archiveSystemWorkspace(root, workspace)
    await restoreSystemWorkspace(root, workspace)
    expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('newer output')
  })
  it('refuses to archive the root or paths outside managed storage', async () => {
    await expect(archiveSystemWorkspace(root, root)).rejects.toThrow()
    await expect(archiveSystemWorkspace(root, path.dirname(root))).rejects.toThrow()
    expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('recoverable output')
  })
})
