import { atomicWriteIfUnchanged, read as fsRead, stat as fsStat } from '@main/utils/file'
import type { FilePath, FileVersion, ReadResult } from '@shared/types/file'
import mime from 'mime'

export type TextReadOptions = { encoding?: 'text'; detectEncoding?: boolean }
export type Base64ReadOptions = { encoding: 'base64' }
export type BinaryReadOptions = { encoding: 'binary' }

const CONSISTENT_READ_MAX_ATTEMPTS = 2

function isSameVersion(a: FileVersion, b: FileVersion): boolean {
  return a.mtime === b.mtime && a.size === b.size
}

/**
 * Read file content directly by path without FileEntry state coordination.
 * The stat-read-stat guard retries when the observable file version changes
 * during the read, so returned content is paired with its post-read version.
 */
export async function readByPath(target: FilePath, options?: TextReadOptions): Promise<ReadResult<string>>
export async function readByPath(target: FilePath, options: Base64ReadOptions): Promise<ReadResult<string>>
export async function readByPath(target: FilePath, options: BinaryReadOptions): Promise<ReadResult<Uint8Array>>
export async function readByPath(
  target: FilePath,
  options?: TextReadOptions | Base64ReadOptions | BinaryReadOptions
): Promise<ReadResult<string | Uint8Array>>
export async function readByPath(
  target: FilePath,
  options?: TextReadOptions | Base64ReadOptions | BinaryReadOptions
): Promise<ReadResult<string | Uint8Array>> {
  for (let attempt = 0; attempt < CONSISTENT_READ_MAX_ATTEMPTS; attempt += 1) {
    const beforeStat = await fsStat(target)
    const before: FileVersion = { mtime: beforeStat.modifiedAt, size: beforeStat.size }
    const encoding = options?.encoding ?? 'text'
    let content: string | Uint8Array
    let contentMime: string
    let readByteLength: number | undefined
    if (encoding === 'text') {
      content = await fsRead(target, { encoding: 'text' })
      contentMime = mime.getType(target) ?? 'text/plain'
    } else if (encoding === 'base64') {
      const out = await fsRead(target, { encoding: 'base64' })
      content = out.data
      contentMime = out.mime
    } else {
      const out = await fsRead(target, { encoding: 'binary' })
      content = out.data
      contentMime = out.mime
      readByteLength = out.data.byteLength
    }
    const afterStat = await fsStat(target)
    const after: FileVersion = { mtime: afterStat.modifiedAt, size: afterStat.size }

    if (isSameVersion(before, after) && (readByteLength === undefined || after.size === readByteLength)) {
      return { content, mime: contentMime, version: after }
    }
  }

  throw new Error(`File changed while reading: ${target}`)
}

/** Atomically write bytes only when the current on-disk version still matches. */
export async function writeIfUnchangedByPath(
  target: FilePath,
  data: Uint8Array,
  expected: FileVersion
): Promise<FileVersion> {
  return atomicWriteIfUnchanged(target, data, expected)
}
