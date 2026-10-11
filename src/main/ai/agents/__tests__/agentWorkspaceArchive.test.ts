import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { create } from 'tar'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { archiveSystemWorkspace, purgeSystemWorkspace, restoreSystemWorkspace } from '../agentWorkspaceArchive'

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
    expect(existsSync(`${workspace}.archiving`)).toBe(false)
    expect(existsSync(`${workspace}.restoring`)).toBe(false)
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

  it('refuses to archive the root or paths outside managed storage', async () => {
    await expect(archiveSystemWorkspace(root, root)).rejects.toThrow()
    await expect(archiveSystemWorkspace(root, path.dirname(root))).rejects.toThrow()
    expect(await readFile(path.join(workspace, 'result.txt'), 'utf8')).toBe('recoverable output')
  })
})
