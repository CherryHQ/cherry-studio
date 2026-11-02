import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, rename, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'

import { create, extract, list } from 'tar'
import * as z from 'zod'

import { isPathInside, shouldSilenceFsyncDirError } from '@main/utils/file'

import { assertAgentStorageDirectory, assertAgentStoragePath } from './agentDataDirectory'

export const WORKSPACE_STORAGE_SUFFIXES = [
  '.tar.gz',
  '.tar.gz.tmp',
  '.archiving',
  '.restoring',
  '.storage.json',
  '.storage.json.tmp'
] as const

const directorySchema = z.strictObject({ dev: z.string(), ino: z.string(), birthtime: z.string() })
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const common = { version: z.literal(1), operationId: z.uuid(), sessionId: z.string().min(1) }
const storageRecordSchema = z.union([
  z
    .strictObject({
      ...common,
      operation: z.literal('archive'),
      phase: z.enum(['staging', 'packing', 'publishing']),
      directory: directorySchema,
      archiveHash: hashSchema.optional()
    })
    .refine((record) => record.phase !== 'publishing' || record.archiveHash !== undefined),
  z
    .strictObject({
      ...common,
      operation: z.literal('restore'),
      phase: z.enum(['preparing', 'prepared', 'published', 'committed']),
      source: z.enum(['archive', 'pending', 'directory']),
      directory: directorySchema.optional(),
      archiveHash: hashSchema.optional()
    })
    .refine(
      (record) =>
        (record.source !== 'archive' || record.archiveHash !== undefined) &&
        (record.source === 'archive' || record.directory !== undefined) &&
        (record.phase === 'preparing' || record.directory !== undefined)
    ),
  z.strictObject({ ...common, operation: z.literal('purge'), phase: z.literal('deleting') })
])

export type WorkspaceStorageRecord = z.infer<typeof storageRecordSchema>
export type WorkspaceDirectoryIdentity = z.infer<typeof directorySchema>

export async function workspaceStat(target: string) {
  try {
    return await lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function inspectWorkspaceStorage(root: string, workspace: string) {
  if (!isPathInside(path.resolve(workspace), path.resolve(root)))
    throw new Error(`Workspace is outside managed storage: ${workspace}`)
  if (!(await workspaceStat(root))) return undefined
  for (const suffix of ['', ...WORKSPACE_STORAGE_SUFFIXES]) {
    const target = `${workspace}${suffix}`
    await assertAgentStoragePath(root, target)
    const stat = await workspaceStat(target)
    const directory = suffix === '' || suffix === '.archiving' || suffix === '.restoring'
    if (stat && (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink > 1))
      throw new Error(`Workspace storage entry has an unexpected type: ${target}`)
  }
  const record = (await workspaceStat(`${workspace}.storage.json`))
    ? storageRecordSchema.parse(JSON.parse(await readFile(`${workspace}.storage.json`, 'utf8')))
    : undefined
  return {
    directory: Boolean(await workspaceStat(workspace)),
    archive: Boolean(await workspaceStat(`${workspace}.tar.gz`)),
    pending: Boolean(await workspaceStat(`${workspace}.archiving`)),
    record
  }
}

export async function writeWorkspaceStorageRecord(workspace: string, record: WorkspaceStorageRecord): Promise<void> {
  const temporary = `${workspace}.storage.json.tmp`
  const handle = await open(temporary, 'w', 0o600)
  try {
    await handle.writeFile(JSON.stringify(storageRecordSchema.parse(record)))
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, `${workspace}.storage.json`)
  await syncDirectory(path.dirname(workspace))
}

export async function clearWorkspaceStorageRecord(workspace: string): Promise<void> {
  await rm(`${workspace}.storage.json`, { force: true })
  await syncDirectory(path.dirname(workspace))
}

export async function workspaceDirectoryIdentity(root: string, directory: string): Promise<WorkspaceDirectoryIdentity> {
  await assertAgentStorageDirectory(root, directory)
  const stat = await lstat(directory, { bigint: true })
  if (stat.ino === 0n) throw new Error(`Workspace directory cannot be identified: ${directory}`)
  return { dev: String(stat.dev), ino: String(stat.ino), birthtime: String(stat.birthtimeNs) }
}

export async function assertWorkspaceDirectoryIdentity(
  root: string,
  directory: string,
  expected: WorkspaceDirectoryIdentity
): Promise<void> {
  const actual = await workspaceDirectoryIdentity(root, directory)
  if (actual.dev !== expected.dev || actual.ino !== expected.ino || actual.birthtime !== expected.birthtime)
    throw new Error(`Workspace directory changed: ${directory}`)
}

export async function validateWorkspaceContents(directory: string): Promise<void> {
  const stat = await lstat(directory)
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink > 1))
    throw new Error(`Cannot safely store linked or special workspace entry: ${directory}`)
  if (stat.isDirectory())
    for (const entry of await readdir(directory)) await validateWorkspaceContents(path.join(directory, entry))
}

export async function validateWorkspaceArchive(file: string): Promise<void> {
  let invalid: string | undefined
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
        invalid = entry.path
    }
  })
  if (invalid !== undefined) throw new Error(`Unsafe workspace archive entry: ${invalid}`)
}

export async function workspaceArchiveHash(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function assertWorkspaceArchiveHash(file: string, expected: string): Promise<void> {
  if ((await workspaceArchiveHash(file)) !== expected) throw new Error(`Workspace archive changed: ${file}`)
}

export async function packWorkspaceDirectory(directory: string, file: string): Promise<string> {
  await validateWorkspaceContents(directory)
  await create({ cwd: directory, file, gzip: true, strict: true, portable: true }, ['.'])
  await validateWorkspaceArchive(file)
  const handle = await open(file, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  return workspaceArchiveHash(file)
}

export async function unpackWorkspaceArchive(file: string, directory: string): Promise<void> {
  await validateWorkspaceArchive(file)
  await extract({ cwd: directory, file, strict: true, preservePaths: false })
  await validateWorkspaceContents(directory)
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (!shouldSilenceFsyncDirError((error as NodeJS.ErrnoException).code)) throw error
  }
}

export async function moveWorkspacePath(root: string, from: string, to: string): Promise<void> {
  await assertAgentStoragePath(root, from)
  await assertAgentStoragePath(root, to)
  if (await workspaceStat(to)) throw new Error(`Workspace destination is occupied: ${to}`)
  await rename(from, to)
  await syncDirectory(path.dirname(from))
  if (path.dirname(from) !== path.dirname(to)) await syncDirectory(path.dirname(to))
}

export async function publishWorkspaceArchive(root: string, temporary: string, archive: string): Promise<void> {
  await assertAgentStoragePath(root, temporary)
  await assertAgentStoragePath(root, archive)
  await rename(temporary, archive)
  await syncDirectory(path.dirname(archive))
}

export async function ensureWorkspaceStage(root: string, directory: string): Promise<void> {
  await assertAgentStoragePath(root, directory)
  await mkdir(directory, { recursive: true })
  await assertAgentStorageDirectory(root, directory)
}

export async function clearWorkspaceStage(root: string, directory: string): Promise<void> {
  await assertAgentStorageDirectory(root, directory)
  for (const name of await readdir(directory)) await rm(path.join(directory, name), { recursive: true, force: true })
}

export async function removeWorkspaceArtifact(
  root: string,
  target: string,
  identity?: WorkspaceDirectoryIdentity
): Promise<void> {
  await assertAgentStoragePath(root, target)
  if (!(await workspaceStat(target))) return
  if (identity) await assertWorkspaceDirectoryIdentity(root, target, identity)
  await rm(target, { recursive: true, force: true })
}

export async function removeEmptyWorkspaceStage(directory: string): Promise<void> {
  try {
    await rmdir(directory)
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  }
}
