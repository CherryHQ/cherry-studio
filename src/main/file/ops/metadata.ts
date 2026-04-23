/* oxlint-disable no-unused-vars -- TODO(phase-1b): Phase 1a stub exports; parameters shape the public signature but are unused until implementations land. */

/**
 * File type detection and metadata utilities.
 *
 * Primary path: extension-based mapping.
 * Fallback: buffer detection (isBinaryFile + chardet) for unknown extensions.
 */

import type { FilePath, FileType } from '@shared/file/types'

const notImplemented = (op: string): never => {
  throw new Error(`ops.metadata.${op}: not implemented (Phase 1a stub, implementation lands in Phase 1b)`)
}

/** Detect file type from extension, with fallback to buffer inspection. */
export async function getFileType(_path: FilePath): Promise<FileType> {
  return notImplemented('getFileType')
}

/** Check if a file is a text file (chardet + isBinaryFile). */
export async function isTextFile(_path: FilePath): Promise<boolean> {
  return notImplemented('isTextFile')
}

/** Map MIME type to file extension (without leading dot). */
export function mimeToExt(_mime: string): string | undefined {
  return notImplemented('mimeToExt')
}
