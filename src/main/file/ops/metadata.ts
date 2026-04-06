/**
 * File type detection and metadata utilities.
 *
 * Primary path: extension-based mapping.
 * Fallback: buffer detection (isBinaryFile + chardet) for unknown extensions.
 */

import type { FileType } from '@shared/file/types'
import type { FilePath } from '@shared/file/types'

/** Detect file type from extension, with fallback to buffer inspection. */
export async function getFileType(_path: FilePath): Promise<FileType> {
  throw new Error('Not implemented')
}

/** Check if a file is a text file (chardet + isBinaryFile). */
export async function isTextFile(_path: FilePath): Promise<boolean> {
  throw new Error('Not implemented')
}

/** Map MIME type to file extension (without leading dot). */
export function mimeToExt(_mime: string): string | undefined {
  throw new Error('Not implemented')
}
