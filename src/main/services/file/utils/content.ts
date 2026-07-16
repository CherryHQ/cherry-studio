import { atomicWriteFile, atomicWriteIfUnchanged, read as fsRead, stat as fsStat } from '@main/utils/file'
import type { FilePath, FileVersion, ReadResult } from '@shared/types/file'
import mime from 'mime'

export type TextReadOptions = { encoding?: 'text'; detectEncoding?: boolean }
export type Base64ReadOptions = { encoding: 'base64' }
export type BinaryReadOptions = { encoding: 'binary' }

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

/** Atomically write file content directly by path. */
export async function writeByPath(target: FilePath, data: string | Uint8Array): Promise<FileVersion> {
  await atomicWriteFile(target, data)
  const s = await fsStat(target)
  return { mtime: s.modifiedAt, size: s.size }
}

/** Atomically write by path only when the current version still matches. */
export async function writeIfUnchangedByPath(
  target: FilePath,
  data: string | Uint8Array,
  expected: FileVersion,
  expectedContentHash?: string
): Promise<FileVersion> {
  return atomicWriteIfUnchanged(target, data, expected, expectedContentHash)
}
