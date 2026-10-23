// Browser `@main/utils/file`: the path helpers and the async file helpers the agent host and the file
// preview use, on ZenFS. The rest (atomic writes, streams, downloads) needs Node streams; tool-output
// file storage stays unsupported.
import {
  lstat as fsLstat,
  mkdir as fsMkdir,
  open as fsOpen,
  readFile,
  realpath as fsRealpath,
  rm,
  stat as fsStat
} from 'node:fs/promises'
import path from 'node:path'

import mime from 'mime'

import { type AbsoluteFilePath, AbsoluteFilePathSchema, FILE_TYPE, type FileType } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'

export { atomicWriteIfUnchanged, hashContent, PathStaleVersionError } from '../disabled/files'
export {
  canonicalizePathForContainment,
  isNotEmptyDir,
  isOutsidePath,
  isPathInside,
  isSameOrInside,
  resolvePath
} from '@main/utils/file/path'
export { getPathStatus, type PathStatus, type PathStatusKind } from '@main/utils/file/pathStatus'

export async function stat(path: AbsoluteFilePath) {
  const s = await fsStat(path)
  return {
    size: s.size,
    createdAt: Math.floor(s.birthtimeMs),
    modifiedAt: Math.floor(s.mtimeMs),
    isDirectory: s.isDirectory()
  }
}

export async function lstat(target: AbsoluteFilePath) {
  const s = await fsLstat(target)
  return {
    size: s.size,
    createdAt: Math.floor(s.birthtimeMs),
    modifiedAt: Math.floor(s.mtimeMs),
    isDirectory: s.isDirectory(),
    isFile: s.isFile(),
    isSymbolicLink: s.isSymbolicLink()
  }
}

export async function realpath(target: AbsoluteFilePath): Promise<AbsoluteFilePath> {
  return AbsoluteFilePathSchema.parse(await fsRealpath(target))
}

export async function mkdir(target: AbsoluteFilePath): Promise<void> {
  await fsMkdir(target)
}

export async function ensureDir(target: AbsoluteFilePath): Promise<void> {
  await fsMkdir(target, { recursive: true })
}

export async function removeDir(target: AbsoluteFilePath): Promise<void> {
  await rm(target, { recursive: true, force: true })
}

/** The desktop `read`: text, or bytes with the MIME type the extension implies. */
export async function read(
  path: AbsoluteFilePath,
  options?: { encoding?: 'text'; detectEncoding?: boolean }
): Promise<string>
export async function read(
  path: AbsoluteFilePath,
  options: { encoding: 'base64' }
): Promise<{ data: string; mime: string }>
export async function read(
  path: AbsoluteFilePath,
  options: { encoding: 'binary' }
): Promise<{ data: Uint8Array; mime: string }>
export async function read(
  path: AbsoluteFilePath,
  options?: { encoding?: 'text' | 'base64' | 'binary'; detectEncoding?: boolean }
): Promise<unknown> {
  const encoding = options?.encoding ?? 'text'
  if (encoding === 'text') return readFile(path, 'utf-8')
  const buffer = await readFile(path)
  const inferredMime = mime.getType(path) ?? 'application/octet-stream'
  if (encoding === 'base64') return { data: buffer.toString('base64'), mime: inferredMime }
  return { data: new Uint8Array(buffer), mime: inferredMime }
}

/** Reads at most `length` bytes starting at `offset`. */
export async function readChunk(
  path: AbsoluteFilePath,
  offset: number,
  length: number
): Promise<Uint8Array<ArrayBuffer>> {
  const fileHandle = await fsOpen(path, 'r')
  try {
    const buffer = new Uint8Array(length)
    let totalBytesRead = 0
    while (totalBytesRead < length) {
      const { bytesRead } = await fileHandle.read(
        buffer,
        totalBytesRead,
        length - totalBytesRead,
        offset + totalBytesRead
      )
      if (bytesRead === 0) break
      totalBytesRead += bytesRead
    }
    return totalBytesRead === buffer.byteLength ? buffer : buffer.slice(0, totalBytesRead)
  } finally {
    await fileHandle.close()
  }
}

/**
 * The desktop `getFileType`: by extension; a file with an unknown extension is text when its first
 * 8 KB are UTF-8 without NUL bytes (the desktop also recognises other encodings).
 */
export async function getFileType(target: AbsoluteFilePath): Promise<FileType> {
  const fileType = getFileTypeByExt(path.extname(target))
  if (fileType !== FILE_TYPE.OTHER) return fileType
  const head = await readChunk(target, 0, 8 * 1024).catch(() => undefined)
  return head && isUtf8Text(head) ? FILE_TYPE.TEXT : fileType
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false
  try {
    // `stream` accepts a character cut off at the end of the sample.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true })
    return true
  } catch {
    return false
  }
}
