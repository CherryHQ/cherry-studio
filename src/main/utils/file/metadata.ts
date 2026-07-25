/**
 * File type detection and metadata utilities.
 *
 * Primary path: extension-based mapping.
 * Fallback: encoding-aware buffer detection for files without a useful
 * extension.
 */

import path from 'node:path'

import { FILE_TYPE, type FilePath, type FileType } from '@shared/types/file'
import { MB } from '@shared/utils/constants'
import { getFileTypeByExt } from '@shared/utils/file'
import chardet from 'chardet'
import iconv from 'iconv-lite'
import { isBinaryFileSync } from 'isbinaryfile'
import mime from 'mime'

const MIN_LEGACY_ENCODING_CONFIDENCE = 80
const RELIABLE_LEGACY_ENCODINGS = new Set(['BIG5', 'EUC-JP', 'EUC-KR', 'GB18030', 'SHIFT_JIS', 'UTF-16BE', 'UTF-16LE'])

function hasSuspiciousDecodedCharacters(text: string): boolean {
  let controlCharacters = 0
  let characters = 0

  for (const character of text) {
    characters++
    const codePoint = character.codePointAt(0)!
    if (codePoint === 0 || codePoint === 0xfffd) return true
    if (
      (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      controlCharacters++
    }
  }

  return controlCharacters / Math.max(characters, 1) > 0.01
}

function decodeWithoutSuspiciousCharacters(data: Buffer, encoding: string): string | null {
  try {
    const text = iconv.decode(data, encoding)
    return hasSuspiciousDecodedCharacters(text) ? null : text
  } catch {
    return null
  }
}

/**
 * Decode text bytes while preserving support for high-confidence legacy
 * encodings that UTF-8-oriented binary sniffers reject. Returns `null` when
 * the bytes are binary or their encoding is too ambiguous to decode safely.
 */
export function decodeTextBufferIfText(data: Buffer): string | null {
  const sample = data.length > MB ? data.subarray(0, MB) : data
  const isBinary = isBinaryFileSync(sample, sample.byteLength)

  if (!isBinary) {
    const utf8Text = decodeWithoutSuspiciousCharacters(data, 'UTF-8')
    if (utf8Text !== null) return utf8Text
  }

  const match = chardet.analyse(sample)[0]
  if (
    !match ||
    match.confidence < MIN_LEGACY_ENCODING_CONFIDENCE ||
    !RELIABLE_LEGACY_ENCODINGS.has(match.name.toUpperCase())
  ) {
    return null
  }

  return decodeWithoutSuspiciousCharacters(data, match.name)
}

/** Detect file type from extension. */
export async function getFileType(target: FilePath): Promise<FileType> {
  const ext = path.extname(target)
  return getFileTypeByExt(ext)
}

/** Check if a file is a text file by extension. */
export async function isTextFile(target: FilePath): Promise<boolean> {
  return (await getFileType(target)) === FILE_TYPE.TEXT
}

/** Map MIME type to file extension (without leading dot). Returns undefined if unknown. */
export function mimeToExt(mimeType: string): string | undefined {
  const ext = mime.getExtension(mimeType)
  return ext ?? undefined
}
