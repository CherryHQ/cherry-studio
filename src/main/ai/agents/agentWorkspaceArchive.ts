import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

import { create, extract, list } from 'tar'

import { isPathInside } from '@main/utils/file'

import { assertAgentStoragePath, removeAgentStorageSubdirectory } from './agentDataDirectory'

export const WORKSPACE_ARCHIVE_SUFFIXES = ['.tar.gz', '.tar.gz.tmp', '.archiving', '.restoring'] as const

async function statIfExists(target: string) {
  try {
    return await lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function validatePaths(root: string, workspace: string): Promise<boolean> {
  if (!isPathInside(path.resolve(workspace), path.resolve(root))) {
    throw new Error(`Workspace is outside managed storage: ${workspace}`)
  }
  if (!(await statIfExists(root))) return false
  for (const suffix of ['', ...WORKSPACE_ARCHIVE_SUFFIXES]) {
    await assertAgentStoragePath(root, `${workspace}${suffix}`)
  }
  return true
}

async function validateContents(directory: string): Promise<void> {
  const stat = await lstat(directory)
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink > 1)) {
    throw new Error(`Cannot safely archive linked or special workspace entry: ${directory}`)
  }
  if (stat.isDirectory()) {
    for (const entry of await readdir(directory)) await validateContents(path.join(directory, entry))
  }
}

async function validateArchive(file: string): Promise<void> {
  let invalidEntry: string | undefined
  await list({
    file,
    strict: true,
    onReadEntry: (entry) => {
      const name = entry.path.replaceAll('\\', '/')
      if (
        !['File', 'Directory'].includes(entry.type) ||
        path.posix.isAbsolute(name) ||
        path.win32.isAbsolute(name) ||
        name.split('/').includes('..')
      )
        invalidEntry = entry.path
    }
  })
  if (invalidEntry !== undefined) throw new Error(`Unsafe workspace archive entry: ${invalidEntry}`)
}

export async function archiveSystemWorkspace(root: string, workspace: string): Promise<void> {
  if (!(await validatePaths(root, workspace))) return
  const archive = `${workspace}.tar.gz`
  const pending = `${workspace}.archiving`
  const temporary = `${archive}.tmp`
  if (await statIfExists(archive)) {
    if (await statIfExists(workspace)) throw new Error(`Workspace and archive both exist: ${workspace}`)
    if (await statIfExists(pending)) {
      await validateArchive(archive)
      await removeAgentStorageSubdirectory(root, pending)
    }
    return
  }
  if (await statIfExists(workspace)) {
    if (await statIfExists(pending)) throw new Error(`Workspace archive is already pending: ${workspace}`)
    await validateContents(workspace)
    await rename(workspace, pending)
  }
  if (!(await statIfExists(pending))) return
  try {
    await validateContents(pending)
    await create({ cwd: pending, file: temporary, gzip: true, strict: true, portable: true }, ['.'])
    await validateArchive(temporary)
    const handle = await open(temporary, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, archive)
  } catch (error) {
    await rename(pending, workspace)
    throw error
  } finally {
    await rm(temporary, { force: true })
  }
  await removeAgentStorageSubdirectory(root, pending)
}

export async function restoreSystemWorkspace(root: string, workspace: string): Promise<void> {
  if (!(await validatePaths(root, workspace))) return
  const archive = `${workspace}.tar.gz`
  const pending = `${workspace}.archiving`
  const restoring = `${workspace}.restoring`
  if (!(await statIfExists(workspace))) {
    if (await statIfExists(archive)) {
      await validateArchive(archive)
      await removeAgentStorageSubdirectory(root, restoring)
      await mkdir(restoring)
      await extract({ cwd: restoring, file: archive, strict: true, preservePaths: false })
      await validateContents(restoring)
      await rename(restoring, workspace)
    } else if (await statIfExists(pending)) {
      await rename(pending, workspace)
    }
  }
  // A published directory is complete, even when a previous restore stopped before cleanup.
  if (await statIfExists(workspace)) {
    await removeAgentStorageSubdirectory(root, pending)
    await removeAgentStorageSubdirectory(root, restoring)
    await rm(archive, { force: true })
    await rm(`${archive}.tmp`, { force: true })
  }
}

export async function purgeSystemWorkspace(root: string, workspace: string): Promise<void> {
  if (!(await validatePaths(root, workspace))) return
  for (const suffix of ['', '.archiving', '.restoring']) {
    await removeAgentStorageSubdirectory(root, `${workspace}${suffix}`)
  }
  await rm(`${workspace}.tar.gz`, { force: true })
  await rm(`${workspace}.tar.gz.tmp`, { force: true })
}
