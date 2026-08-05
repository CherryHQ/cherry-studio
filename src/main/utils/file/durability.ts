import fs from 'node:fs'
import { open, rename } from 'node:fs/promises'
import path from 'node:path'

/**
 * Errnos that mean the current platform/filesystem does not expose directory
 * fsync semantics. Real I/O and permission failures are deliberately excluded.
 */
export function shouldSilenceFsyncDirError(code: string | undefined): boolean {
  return code === 'EINVAL' || code === 'EISDIR' || code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'ENOSYS'
}

/** Flush one regular file's bytes and metadata to stable storage. */
export async function fsyncFile(target: string): Promise<void> {
  const handle = await open(target, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Synchronous counterpart of {@link fsyncFile}. */
export function fsyncFileSync(target: string): void {
  const fd = fs.openSync(target, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Flush one directory entry set. Windows is a documented no-op because Node
 * cannot open directory handles for fsync there. Filesystems that explicitly
 * reject directory fsync are treated the same way; all other errors propagate.
 */
export async function fsyncDirectory(target: string): Promise<void> {
  if (process.platform === 'win32') return
  try {
    const handle = await open(target, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (shouldSilenceFsyncDirError((error as NodeJS.ErrnoException).code)) return
    throw error
  }
}

/** Synchronous counterpart of {@link fsyncDirectory}. */
export function fsyncDirectorySync(target: string): void {
  if (process.platform === 'win32') return
  try {
    const fd = fs.openSync(target, 'r')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  } catch (error) {
    if (shouldSilenceFsyncDirError((error as NodeJS.ErrnoException).code)) return
    throw error
  }
}

/** Rename only. In particular, `EXDEV` always propagates; there is no copy fallback. */
export function renameOnly(source: string, target: string): Promise<void> {
  return rename(source, target)
}

/** Synchronous counterpart of {@link renameOnly}. */
export function renameOnlySync(source: string, target: string): void {
  fs.renameSync(source, target)
}

/** Narrow fault-injection seam for short-write tests in this utility module. */
export const durableFileIo = {
  writeSync(fd: number, bytes: Uint8Array, offset: number, length: number, position: number | null): number {
    return fs.writeSync(fd, bytes, offset, length, position)
  }
}

export interface WriteFileFullySyncOptions {
  readonly mode?: number
}

/**
 * Write and fsync every byte, handling legal short writes. The caller chooses
 * the path (normally a transaction-private temporary sibling) and owns cleanup
 * if the operation fails.
 */
export function writeFileFullySync(target: string, bytes: Uint8Array, options: WriteFileFullySyncOptions = {}): void {
  const fd = fs.openSync(target, 'w', options.mode)
  try {
    let offset = 0
    while (offset < bytes.length) {
      const written = durableFileIo.writeSync(fd, bytes, offset, bytes.length - offset, null)
      if (written <= 0) {
        throw new Error(`filesystem write made no progress at ${offset}/${bytes.length} bytes`)
      }
      offset += written
    }
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Remove one file and durably flush the parent entry change.
 *
 * Returns `false` when the file was already absent; every other failure is
 * propagated. Directory fsync follows the platform contract above.
 */
export function unlinkAndFsyncParentSync(target: string): boolean {
  try {
    fs.unlinkSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  fsyncDirectorySync(path.dirname(target))
  return true
}
