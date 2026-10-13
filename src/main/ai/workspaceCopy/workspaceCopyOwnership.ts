import { chmod, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'

import type { AgentWorkspaceCopyRow, WorkspaceCopyOwnership } from '@data/db/schemas/agentWorkspaceCopy'

import { WorkspaceCopyError, fileErrorCode } from './WorkspaceCopyError'
import { buildWorkspaceCopyPaths, type WorkspaceCopyPaths } from './workspaceCopyPaths'

export async function directoryIdentity(directory: string): Promise<string> {
  const stat = await lstat(directory, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n)
    throw new WorkspaceCopyError('ownership_mismatch', 'ownership')
  if (path.relative(await realpath(directory), path.resolve(directory)))
    throw new WorkspaceCopyError('ownership_mismatch', 'ownership')
  return `${stat.dev}:${stat.ino}`
}

export function pathsForCopy(record: AgentWorkspaceCopyRow): WorkspaceCopyPaths {
  if (record.location.version !== 1) throw new WorkspaceCopyError('ownership_mismatch', 'ownership')
  const paths = buildWorkspaceCopyPaths({ ...record.location, copyId: record.id })
  if (paths.root !== record.location.root || paths.project !== record.location.project)
    throw new WorkspaceCopyError('ownership_mismatch', 'ownership')
  return paths
}

function manifestFor(record: AgentWorkspaceCopyRow) {
  return {
    version: 1,
    copyId: record.id,
    ownershipToken: record.ownershipToken,
    location: record.location,
    ownership: record.ownership
  }
}

export async function createCopyOwnership(
  record: AgentWorkspaceCopyRow,
  save: (ownership: WorkspaceCopyOwnership) => AgentWorkspaceCopyRow
): Promise<AgentWorkspaceCopyRow> {
  const paths = pathsForCopy(record)
  await mkdir(paths.parent, { recursive: true })
  const parent = await directoryIdentity(paths.parent)
  await mkdir(paths.root, { mode: 0o700 })
  await mkdir(paths.staging)
  const index = await open(paths.index, 'wx', 0o600)
  let indexIdentity: string
  try {
    const stat = await index.stat({ bigint: true })
    if (stat.ino === 0n) throw new WorkspaceCopyError('ownership_mismatch', 'ownership')
    indexIdentity = `${stat.dev}:${stat.ino}`
  } finally {
    await index.close()
  }
  const owned = save({
    parent,
    container: await directoryIdentity(paths.root),
    project: await directoryIdentity(paths.staging),
    index: indexIdentity
  })
  const manifest = await open(paths.manifest, 'wx', 0o600)
  try {
    await manifest.writeFile(JSON.stringify(manifestFor(owned)))
    await manifest.sync()
  } finally {
    await manifest.close()
  }
  if (process.platform !== 'win32') {
    const directory = await open(paths.root, 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  }
  return owned
}

export async function assertCopyOwnership(
  record: AgentWorkspaceCopyRow,
  project?: 'staging' | 'project' | 'disposal'
): Promise<WorkspaceCopyPaths> {
  const paths = pathsForCopy(record)
  const expected = record.ownership
  if (
    !expected ||
    (await directoryIdentity(paths.parent)) !== expected.parent ||
    (await directoryIdentity(paths.root)) !== expected.container
  ) {
    throw new WorkspaceCopyError('ownership_mismatch', 'ownership')
  }
  const manifestStat = await lstat(paths.manifest)
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink())
    throw new WorkspaceCopyError('ownership_mismatch', 'ownership')
  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(paths.manifest, 'utf8'))
  } catch (cause) {
    throw new WorkspaceCopyError('ownership_mismatch', 'ownership', undefined, { cause })
  }
  if (JSON.stringify(manifest) !== JSON.stringify(manifestFor(record)))
    throw new WorkspaceCopyError('ownership_mismatch', 'ownership')
  if (project && (await directoryIdentity(paths[project])) !== expected.project)
    throw new WorkspaceCopyError('ownership_mismatch', 'ownership')
  return paths
}

async function makeDirectoriesWritable(directory: string): Promise<void> {
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) return
  await chmod(directory, stat.mode | 0o700)
  for (const name of await readdir(directory)) await makeDirectoriesWritable(path.join(directory, name))
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file)
    return true
  } catch (error) {
    if (fileErrorCode(error) === 'ENOENT') return false
    throw error
  }
}

export async function publishCopyTree(record: AgentWorkspaceCopyRow): Promise<void> {
  const paths = await assertCopyOwnership(record, 'staging')
  if ((await exists(paths.project)) || (await exists(paths.disposal)))
    throw new WorkspaceCopyError('path_collision', 'prepare')
  await rename(paths.staging, paths.project)
  await assertCopyOwnership(record, 'project')
}

/** DB authorization and drained writers are preconditions; this function never recursively removes the container. */
export async function cleanupCopyOwnership(record: AgentWorkspaceCopyRow): Promise<void> {
  if (!['failed', 'cancelled', 'deleting'].includes(record.state))
    throw new WorkspaceCopyError('state_conflict', 'cleanup')
  const paths = pathsForCopy(record)
  if (!(await exists(paths.root))) {
    if (!record.ownership || (await directoryIdentity(paths.parent)) !== record.ownership.parent)
      throw new WorkspaceCopyError('ownership_mismatch', 'cleanup')
    return
  }
  await assertCopyOwnership(record)
  const entries = await readdir(paths.root)
  const allowed = new Set(['manifest.json', 'copy-index.jsonl', 'project.partial', 'project', 'project.disposal'])
  if (entries.some((entry) => !allowed.has(entry))) throw new WorkspaceCopyError('unknown_entry', 'cleanup')
  const trees = (['staging', 'project', 'disposal'] as const).filter((key) =>
    entries.includes(path.basename(paths[key]))
  )
  if (trees.length > 1) throw new WorkspaceCopyError('ownership_mismatch', 'cleanup')
  const tree = trees[0]
  if (tree) {
    if (record.state === 'deleting' && tree === 'staging') throw new WorkspaceCopyError('ownership_mismatch', 'cleanup')
    await assertCopyOwnership(record, tree)
    if (tree !== 'disposal') {
      if (await exists(paths.disposal)) throw new WorkspaceCopyError('path_collision', 'cleanup')
      await rename(paths[tree], paths.disposal)
    }
    await assertCopyOwnership(record, 'disposal')
    try {
      await rm(paths.disposal, { recursive: true, maxRetries: 2, retryDelay: 100 })
    } catch (error) {
      if (process.platform === 'win32' || fileErrorCode(error) !== 'EACCES') throw error
      await assertCopyOwnership(record, 'disposal')
      await makeDirectoriesWritable(paths.disposal)
      await rm(paths.disposal, { recursive: true, maxRetries: 2, retryDelay: 100 })
    }
  }
  await assertCopyOwnership(record)
  const remaining = await readdir(paths.root)
  if (remaining.some((entry) => entry !== 'manifest.json' && entry !== 'copy-index.jsonl'))
    throw new WorkspaceCopyError('unknown_entry', 'cleanup')
  if (remaining.includes('copy-index.jsonl')) {
    const index = await lstat(paths.index, { bigint: true })
    if (!index.isFile() || index.isSymbolicLink() || `${index.dev}:${index.ino}` !== record.ownership?.index)
      throw new WorkspaceCopyError('ownership_mismatch', 'cleanup')
    await unlink(paths.index)
  }
  await unlink(paths.manifest)
  await rmdir(paths.root)
}
