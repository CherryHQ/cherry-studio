import { atomicWriteIfUnchanged, hashBytes, read as fsRead, stat as fsStat } from '@main/utils/file'
import type { FilePath, FileVersion, ReadResult } from '@shared/types/file'
import mime from 'mime'

export type TextReadOptions = { encoding?: 'text'; detectEncoding?: boolean }
export type Base64ReadOptions = { encoding: 'base64' }
export type BinaryReadOptions = { encoding: 'binary' }

export interface FileContentSnapshot {
  content: Uint8Array
  contentHash: string
  version: FileVersion
}

export interface FileSnapshotVersion {
  contentHash: string
  version: FileVersion
}

const SNAPSHOT_READ_MAX_ATTEMPTS = 2

function isSameVersion(a: FileVersion, b: FileVersion): boolean {
  return a.mtime === b.mtime && a.size === b.size
}

/** Read file content directly by path without FileEntry state coordination. */
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
  const s = await fsStat(target)
  const version: FileVersion = { mtime: s.modifiedAt, size: s.size }
  const encoding = options?.encoding ?? 'text'
  if (encoding === 'text') {
    const content = await fsRead(target, { encoding: 'text' })
    return { content, mime: mime.getType(target) ?? 'text/plain', version }
  }
  if (encoding === 'base64') {
    const out = await fsRead(target, { encoding: 'base64' })
    return { content: out.data, mime: out.mime, version }
  }
  const out = await fsRead(target, { encoding: 'binary' })
  return { content: out.data, mime: out.mime, version }
}

/**
 * Read a byte snapshot whose version and hash describe the returned content.
 * A concurrent change during the read retries once instead of returning a
 * version captured from different bytes.
 */
export async function readSnapshotByPath(target: FilePath): Promise<FileContentSnapshot> {
  for (let attempt = 0; attempt < SNAPSHOT_READ_MAX_ATTEMPTS; attempt += 1) {
    const beforeStat = await fsStat(target)
    const before: FileVersion = { mtime: beforeStat.modifiedAt, size: beforeStat.size }
    const { data } = await fsRead(target, { encoding: 'binary' })
    const afterStat = await fsStat(target)
    const after: FileVersion = { mtime: afterStat.modifiedAt, size: afterStat.size }

    if (isSameVersion(before, after) && after.size === data.byteLength) {
      return { content: data, contentHash: await hashBytes(data), version: after }
    }
  }

  throw new Error(`File changed while reading snapshot: ${target}`)
}

/** Atomically write snapshot bytes when the version and any coarse-mtime fallback hash still match. */
export async function writeSnapshotIfUnchangedByPath(
  target: FilePath,
  data: Uint8Array,
  expected: FileVersion,
  expectedContentHash: string
): Promise<FileSnapshotVersion> {
  const contentHash = await hashBytes(data)
  const version = await atomicWriteIfUnchanged(target, data, expected, expectedContentHash)
  return { contentHash, version }
}
