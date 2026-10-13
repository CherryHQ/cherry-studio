import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, rename, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'

import { create, extract, list } from 'tar'
import * as z from 'zod'

import { isPathInside } from '@main/utils/file'

import {
  assertAgentStorageDirectory,
  assertAgentStoragePath,
  removeAgentStorageSubdirectory
} from './agentDataDirectory'

export const WORKSPACE_ARCHIVE_SUFFIXES = [
  '.tar.gz',
  '.tar.gz.tmp',
  '.archiving',
  '.restoring',
  '.restore.json',
  '.restore.json.tmp'
] as const

const restoreRecordSchema = z
  .object({
    version: z.literal(1),
    operationId: z.uuid(),
    source: z.enum(['archive', 'pending']),
    archiveHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    directory: z.object({ dev: z.string(), ino: z.string(), birthtime: z.string() }).strict()
  })
  .strict()
  .refine((record) => record.source !== 'archive' || record.archiveHash !== undefined)

export type WorkspaceRestoreResult = { kind: 'unmaterialized' | 'original' | 'published' }

export function hasWorkspaceRestore(workspace: string): boolean {
  return existsSync(`${workspace}.restore.json`)
}

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
    const target = `${workspace}${suffix}`
    await assertAgentStoragePath(root, target)
    const stat = await statIfExists(target)
    const directory = suffix === '' || suffix === '.archiving' || suffix === '.restoring'
    if (stat && (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink > 1)) {
      throw new Error(`Workspace storage entry has an unexpected type: ${target}`)
    }
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
  if (await statIfExists(workspace)) {
    await assertAgentStorageDirectory(root, workspace)
    const record = await readRestoreRecord(workspace)
    if (record) {
      if (!(await matchesDirectory(workspace, record)))
        throw new Error(`Workspace restore destination changed: ${workspace}`)
    }
  }
  if (await statIfExists(archive)) {
    if (await statIfExists(workspace)) {
      await validateContents(workspace)
      await removeAgentStorageSubdirectory(root, pending)
      // Invalidate the stale snapshot before staging newer files for crash recovery.
      await rm(archive)
    } else {
      if (await statIfExists(pending)) {
        await validateArchive(archive)
        await removeAgentStorageSubdirectory(root, pending)
      }
      return
    }
  }
  if (await statIfExists(workspace)) {
    if (await statIfExists(pending)) throw new Error(`Workspace archive is already pending: ${workspace}`)
    await validateContents(workspace)
    await rm(`${workspace}.restore.json`, { force: true })
    await rename(workspace, pending)
  }
  if (!(await statIfExists(pending))) return
  await assertAgentStorageDirectory(root, pending)
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

async function archiveHash(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function directoryIdentity(directory: string) {
  const stat = await lstat(directory, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n) {
    throw new Error(`Workspace restore requires an identifiable real directory: ${directory}`)
  }
  return { dev: String(stat.dev), ino: String(stat.ino), birthtime: String(stat.birthtimeNs) }
}

async function readRestoreRecord(workspace: string) {
  if (!(await statIfExists(`${workspace}.restore.json`))) return undefined
  return restoreRecordSchema.parse(JSON.parse(await readFile(`${workspace}.restore.json`, 'utf8')))
}

async function writeRestoreRecord(workspace: string, record: z.infer<typeof restoreRecordSchema>) {
  const temporary = `${workspace}.restore.json.tmp`
  const handle = await open(temporary, 'w', 0o600)
  try {
    await handle.writeFile(JSON.stringify(record))
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, `${workspace}.restore.json`)
}

async function matchesDirectory(directory: string, record: z.infer<typeof restoreRecordSchema>): Promise<boolean> {
  const identity = await directoryIdentity(directory)
  return (
    identity.dev === record.directory.dev &&
    identity.ino === record.directory.ino &&
    identity.birthtime === record.directory.birthtime
  )
}

async function validateRecordArchive(workspace: string, record: z.infer<typeof restoreRecordSchema>) {
  const archive = `${workspace}.tar.gz`
  if (await statIfExists(archive)) {
    if (record.source !== 'archive' || (await archiveHash(archive)) !== record.archiveHash) {
      throw new Error(`Workspace archive changed during restore: ${workspace}`)
    }
  }
}

/** Prepare and publish files; retain recovery evidence until the owning DB transaction commits. */
export async function restoreSystemWorkspace(root: string, workspace: string): Promise<WorkspaceRestoreResult> {
  if (!(await validatePaths(root, workspace))) return { kind: 'unmaterialized' }
  const archive = `${workspace}.tar.gz`
  const pending = `${workspace}.archiving`
  let record = await readRestoreRecord(workspace)
  if (await statIfExists(workspace)) {
    await assertAgentStorageDirectory(root, workspace)
    if (record) {
      if (!(await matchesDirectory(workspace, record)))
        throw new Error(`Workspace restore destination changed: ${workspace}`)
      await validateRecordArchive(workspace, record)
      return { kind: 'published' }
    }
    if ((await statIfExists(archive)) || (await statIfExists(pending))) {
      throw new Error(`Workspace restore destination is occupied: ${workspace}`)
    }
    return { kind: 'original' }
  }
  if (record) {
    const staged = path.join(`${workspace}.restoring`, record.operationId)
    if (record.source === 'pending' && (await statIfExists(pending))) {
      await assertAgentStorageDirectory(root, pending)
      if (!(await matchesDirectory(pending, record))) throw new Error(`Workspace restore staging changed: ${workspace}`)
      if (await statIfExists(staged)) await rmdir(staged)
      await rename(pending, staged)
    }
    await assertAgentStorageDirectory(root, staged)
    if (!(await matchesDirectory(staged, record))) throw new Error(`Workspace restore staging changed: ${workspace}`)
    await validateRecordArchive(workspace, record)
    await validateContents(staged)
    await rename(staged, workspace)
    return { kind: 'published' }
  }
  const source = (await statIfExists(archive)) ? 'archive' : (await statIfExists(pending)) ? 'pending' : undefined
  if (!source) return { kind: 'unmaterialized' }
  const operationId = randomUUID()
  const restoring = `${workspace}.restoring`
  if (await statIfExists(restoring)) await assertAgentStorageDirectory(root, restoring)
  else await mkdir(restoring)
  const staged = path.join(restoring, operationId)
  await mkdir(staged)
  let durable = false
  try {
    if (source === 'archive') {
      const before = await archiveHash(archive)
      await validateArchive(archive)
      await extract({ cwd: staged, file: archive, strict: true, preservePaths: false })
      if ((await archiveHash(archive)) !== before)
        throw new Error(`Workspace archive changed during restore: ${workspace}`)
      record = { version: 1, operationId, source, directory: await directoryIdentity(staged), archiveHash: before }
    } else {
      await assertAgentStorageDirectory(root, pending)
      await validateContents(pending)
      record = { version: 1, operationId, source, directory: await directoryIdentity(pending) }
      await writeRestoreRecord(workspace, record)
      durable = true
      await rm(staged, { recursive: true })
      await rename(pending, staged)
    }
    await validateContents(staged)
    if (!durable) {
      await writeRestoreRecord(workspace, record)
      durable = true
    }
    if (await statIfExists(workspace)) throw new Error(`Workspace restore destination is occupied: ${workspace}`)
    await rename(staged, workspace)
    return { kind: 'published' }
  } catch (error) {
    if (!durable) {
      if (source === 'pending' && (await statIfExists(staged))) await rename(staged, pending)
      else await rm(staged, { recursive: true, force: true })
    }
    throw error
  }
}

export async function finalizeSystemWorkspaceRestore(root: string, workspace: string): Promise<void> {
  if (!(await validatePaths(root, workspace))) return
  const record = await readRestoreRecord(workspace)
  if (!record) return
  await assertAgentStorageDirectory(root, workspace)
  if (!(await matchesDirectory(workspace, record)))
    throw new Error(`Workspace restore destination changed: ${workspace}`)
  await validateRecordArchive(workspace, record)
  await rm(`${workspace}.tar.gz`, { force: true })
  await rm(`${workspace}.restore.json`)
  await rm(`${workspace}.restore.json.tmp`, { force: true })
  try {
    await rmdir(`${workspace}.restoring`)
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  }
}

export async function purgeSystemWorkspace(root: string, workspace: string): Promise<void> {
  if (!(await validatePaths(root, workspace))) return
  for (const suffix of ['', '.archiving', '.restoring']) {
    await removeAgentStorageSubdirectory(root, `${workspace}${suffix}`)
  }
  await rm(`${workspace}.tar.gz`, { force: true })
  await rm(`${workspace}.tar.gz.tmp`, { force: true })
  await rm(`${workspace}.restore.json`, { force: true })
  await rm(`${workspace}.restore.json.tmp`, { force: true })
}
