import { atomicWriteIfUnchanged, getPathKind, hashData, read as fsRead, stat as fsStat } from '@main/utils/file'
import { type FilePath, TEXT_FILE_EDIT_MAX_BYTES } from '@shared/types/file'

import type { FileVersion } from '../FileManager'

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf])
const SNAPSHOT_READ_ATTEMPTS = 3

export type TextFileLineEnding = 'lf' | 'crlf'
export type TextEditUnsupportedReason = 'encoding' | 'mixed-line-endings' | 'not-file' | 'symbolic-link' | 'too-large'

export interface TextEditSnapshot {
  content: string
  version: FileVersion
  contentHash: string
  lineEnding: TextFileLineEnding
  hasBom: boolean
}

export class TextEditUnsupportedError extends Error {
  constructor(
    public readonly target: FilePath,
    public readonly reason: TextEditUnsupportedReason
  ) {
    super(`Text editing is not supported for ${target} (${reason})`)
    this.name = 'TextEditUnsupportedError'
  }
}

export class TextEditSnapshotChangedError extends Error {
  constructor(public readonly target: FilePath) {
    super(`File changed repeatedly while reading an editable snapshot: ${target}`)
    this.name = 'TextEditSnapshotChangedError'
  }
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= UTF8_BOM.length && UTF8_BOM.every((value, index) => bytes[index] === value)
}

function decodeTextSnapshot(target: FilePath, bytes: Uint8Array, version: FileVersion): TextEditSnapshot {
  const hasBom = hasUtf8Bom(bytes)
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.slice(UTF8_BOM.length) : bytes)
  } catch {
    throw new TextEditUnsupportedError(target, 'encoding')
  }

  // NUL is a strong binary signal even when the byte sequence itself is valid UTF-8.
  if (content.includes('\0')) throw new TextEditUnsupportedError(target, 'encoding')

  const withoutCrlf = content.replace(/\r\n/g, '')
  const hasCrlf = content.includes('\r\n')
  if (withoutCrlf.includes('\r') || (hasCrlf && withoutCrlf.includes('\n'))) {
    throw new TextEditUnsupportedError(target, 'mixed-line-endings')
  }

  const lineEnding: TextFileLineEnding = hasCrlf ? 'crlf' : 'lf'
  const normalizedContent = hasCrlf ? content.replace(/\r\n/g, '\n') : content

  return {
    content: normalizedContent,
    version,
    contentHash: '',
    lineEnding,
    hasBom
  }
}

export function encodeTextEditContent(content: string, lineEnding: TextFileLineEnding, hasBom: boolean): Uint8Array {
  const normalized = content.replace(/\r\n?/g, '\n')
  const encoded = new TextEncoder().encode(lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized)
  if (!hasBom) return encoded

  const withBom = new Uint8Array(UTF8_BOM.length + encoded.length)
  withBom.set(UTF8_BOM)
  withBom.set(encoded, UTF8_BOM.length)
  return withBom
}

/** Read a UTF-8 snapshot whose content, version, and hash describe the same bytes. */
export async function readTextEditSnapshotByPath(target: FilePath): Promise<TextEditSnapshot> {
  const kind = await getPathKind(target)
  if (kind === 'symbolic-link') throw new TextEditUnsupportedError(target, 'symbolic-link')
  if (kind !== 'file') throw new TextEditUnsupportedError(target, 'not-file')

  for (let attempt = 0; attempt < SNAPSHOT_READ_ATTEMPTS; attempt += 1) {
    const before = await fsStat(target)
    if (before.size > TEXT_FILE_EDIT_MAX_BYTES) throw new TextEditUnsupportedError(target, 'too-large')

    const { data } = await fsRead(target, { encoding: 'binary' })
    const after = await fsStat(target)
    if (before.modifiedAt !== after.modifiedAt || before.size !== after.size || data.byteLength !== after.size) continue

    const version = { mtime: after.modifiedAt, size: after.size }
    return { ...decodeTextSnapshot(target, data, version), contentHash: await hashData(data) }
  }

  throw new TextEditSnapshotChangedError(target)
}

export async function writeTextEditIfUnchangedByPath(
  target: FilePath,
  content: string,
  lineEnding: TextFileLineEnding,
  hasBom: boolean,
  expectedVersion: FileVersion,
  expectedContentHash: string
): Promise<{ version: FileVersion; contentHash: string }> {
  const data = encodeTextEditContent(content, lineEnding, hasBom)
  if (data.byteLength > TEXT_FILE_EDIT_MAX_BYTES) throw new TextEditUnsupportedError(target, 'too-large')

  const version = await atomicWriteIfUnchanged(target, data, expectedVersion, expectedContentHash)
  return { version, contentHash: await hashData(data) }
}
