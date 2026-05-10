/**
 * File type detection and metadata utilities.
 *
 * Primary path: extension-based mapping.
 * Fallback: buffer detection (isBinaryFile + chardet) for unknown extensions —
 * deferred (no consumer yet); current detection is extension-only.
 */

import path from 'node:path'

import { FILE_TYPE, type FilePath, type FileType, getFileTypeByExt } from '@shared/file/types'
import mime from 'mime'

/** Detect file type from extension. Buffer-sniff fallback deferred (no consumer yet). */
export async function getFileType(target: FilePath): Promise<FileType> {
  const ext = path.extname(target)
  return getFileTypeByExt(ext)
}

/** Check if a file is a text file. Extension-based; buffer-sniff fallback deferred to 1b.2. */
export async function isTextFile(target: FilePath): Promise<boolean> {
  return (await getFileType(target)) === FILE_TYPE.TEXT
}

/** Map MIME type to file extension (without leading dot). Returns undefined if unknown. */
export function mimeToExt(mimeType: string): string | undefined {
  const ext = mime.getExtension(mimeType)
  return ext ?? undefined
}
