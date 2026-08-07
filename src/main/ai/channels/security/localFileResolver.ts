import type { FileHandle } from 'node:fs/promises'
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'

import type { FileAttachment } from '@main/utils/downloadAsBase64'
import { MAX_FILE_SIZE_BYTES } from '@main/utils/downloadAsBase64'

import { FILE_EXTENSION_MIME_MAP } from '../utils'

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function mimeForFilename(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase()
  return FILE_EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream'
}

/**
 * Read an already-canonical path into a `FileAttachment`. Carries the file-safety
 * properties only — regular-file check, size cap, and a single fd so the stat and the
 * read see the same inode. It performs no authorization: callers that need a boundary
 * (e.g. workspace confinement) must canonicalize and check the path themselves, then
 * hand the canonical path here so the check and the read cannot diverge.
 *
 * `requestedPath` names the attachment (its basename and MIME); `displayPath` is echoed
 * back in errors as the caller's own path spelling.
 */
export async function readCanonicalLocalFile(
  requestedPath: string,
  canonicalPath: string,
  displayPath: string
): Promise<FileAttachment> {
  let fd: FileHandle
  try {
    fd = await open(canonicalPath, 'r')
  } catch (error) {
    if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      throw new Error(`File not found: ${displayPath}`)
    }
    throw error
  }

  try {
    const stats = await fd.stat()
    if (!stats.isFile()) {
      throw new Error(`Not a regular file: ${displayPath}`)
    }
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File exceeds the ${MAX_FILE_SIZE_BYTES} byte limit (${stats.size} bytes): ${displayPath}`)
    }

    const buffer = await fd.readFile()
    // Re-check against the actual read size: the file can grow between fstat and read.
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File exceeds the ${MAX_FILE_SIZE_BYTES} byte limit (${buffer.length} bytes): ${displayPath}`)
    }
    const filename = path.basename(requestedPath)
    return {
      filename,
      data: buffer.toString('base64'),
      media_type: mimeForFilename(filename),
      size: buffer.length
    }
  } finally {
    await fd.close().catch(() => {})
  }
}

/** Resolve and safely read a local file. Relative paths are resolved from `basePath`. */
export async function resolveLocalFile(basePath: string, userPath: string): Promise<FileAttachment> {
  const requestedPath = path.resolve(basePath, userPath)

  let canonicalPath: string
  try {
    canonicalPath = await realpath(requestedPath)
  } catch (error) {
    if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      throw new Error(`File not found: ${userPath}`)
    }
    throw error
  }

  return readCanonicalLocalFile(requestedPath, canonicalPath, userPath)
}
