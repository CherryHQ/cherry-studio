import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

export const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
export type FileState = {
  exists: boolean
  size: string | null
  sha256: string | null
  mode: number | null
  dev: string | null
  ino: string | null
}
export type Attempt = {
  id: string
  callId: string
  runtime: string
  toolName: string
  origin?: 'subagent'
  startedAt: string
  afterHash: string | null
  afterSize: string | null
  beforeState?: FileState
  beforeParent?: SnapshotFile['parent']
  preconditionConflict?: boolean
  classification: 'none' | 'empty' | 'large-deletion' | 'undecidable'
  status: 'pending' | 'written' | 'failed' | 'cancelled' | 'unknown' | 'unverifiable'
}
export type SnapshotFile = {
  path: string
  identity?: string
  existedBefore: boolean
  sizeBefore: string | null
  sha256Before: string | null
  modeBefore: number | null
  parent: { dev: string; ino: string; resolvedPath: string; anchorPath?: string }
  parentMigratedAt?: string
  afterHash: string | null
  afterSize: string | null
  afterMode?: number | null
  restoredAt: string | null
  blob: string | null
  attempts: Attempt[]
}

export type Manifest = {
  formatVersion: 1
  sessionId: string
  replyId: string
  inputMessageIds: string[]
  revision: string
  savedAt: string
  startedAt?: string
  finishedAt?: string
  files: SnapshotFile[]
}

export function safeSegment(value: string): string {
  if (!value || value === '.' || value === '..' || /[\\/\0]/.test(value)) throw new Error('Invalid snapshot identifier')
  return value
}

export async function inspectFile(
  filePath: string,
  maxFileBytes = MAX_SNAPSHOT_BYTES
): Promise<{ state: FileState; bytes: Buffer | null }> {
  let handle: fs.FileHandle
  try {
    handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { state: { exists: false, size: null, sha256: null, mode: null, dev: null, ino: null }, bytes: null }
    throw error
  }
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.nlink !== 1n)
      throw new Error('Snapshot target must be a regular file without hard links')
    if (before.size > BigInt(maxFileBytes)) throw new Error('Snapshot target exceeds size limit')
    const bytes = await handle.readFile()
    const after = await handle.stat({ bigint: true })
    const entry = await fs.lstat(filePath, { bigint: true })
    if (
      BigInt(bytes.length) !== before.size ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      before.dev !== entry.dev ||
      before.ino !== entry.ino ||
      !entry.isFile() ||
      entry.nlink !== 1n
    )
      throw new Error('Snapshot target changed while reading')
    return {
      state: {
        exists: true,
        size: String(before.size),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        mode: Number(before.mode & 0o7777n),
        dev: String(before.dev),
        ino: String(before.ino)
      },
      bytes
    }
  } finally {
    await handle.close()
  }
}

export async function resolveExistingPath(target: string): Promise<string> {
  try {
    return await fs.realpath(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(target)
    if (parent === target) throw error
    return path.join(await resolveExistingPath(parent), path.basename(target))
  }
}

export async function parentIdentity(target: string, anchorPath?: string) {
  const dir = path.dirname(target)
  const resolvedPath = path.join(await resolveExistingPath(dir), path.basename(target))
  let anchor = anchorPath ?? dir
  if (!anchorPath) {
    while (true) {
      try {
        anchor = await fs.realpath(anchor)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        anchor = path.dirname(anchor)
      }
    }
  }
  const stats = await fs.stat(anchor, { bigint: true })
  return {
    dev: String(stats.dev),
    ino: String(stats.ino),
    resolvedPath,
    ...(anchorPath || anchor !== path.dirname(resolvedPath) ? { anchorPath: anchor } : {})
  }
}

export async function atomicWrite(target: string, bytes: Buffer | string, mode?: number): Promise<void> {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: mode ?? 0o600 })
    if (mode !== undefined && process.platform !== 'win32') await fs.chmod(temporary, mode)
    await fs.rename(temporary, target)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}
