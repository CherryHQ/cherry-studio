import path from 'node:path'
import { buffer as readStreamToBuffer } from 'node:stream/consumers'

import type { FileAttachment } from '@main/utils/downloadAsBase64'
import { MAX_FILE_SIZE_BYTES } from '@main/utils/downloadAsBase64'
import { lstat, openReadableFileSnapshot, realpath } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { FILE_EXTENSION_MIME_MAP } from '../utils'

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function mimeForFilename(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase()
  return FILE_EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream'
}

/**
 * Read an already-canonical path into a `FileAttachment`. Performs NO path
 * authorization — the caller owns containment (see `resolveWorkspaceFile`).
 */
export async function readCanonicalLocalFile(
  requestedPath: string,
  canonicalPath: string,
  displayPath: string
): Promise<FileAttachment> {
  const target = AbsoluteFilePathSchema.parse(canonicalPath)

  let stats: Awaited<ReturnType<typeof lstat>>
  try {
    stats = await lstat(target)
  } catch (error) {
    if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      throw new Error(`File not found: ${displayPath}`)
    }
    throw error
  }
  if (!stats.isFile) {
    throw new Error(`Not a regular file: ${displayPath}`)
  }

  // The snapshot pins the inode and fixes the read length at open time, so the size
  // check and the read see the same file even if the path is replaced meanwhile.
  const snapshot = await openReadableFileSnapshot(target)
  try {
    if (snapshot.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File exceeds the ${MAX_FILE_SIZE_BYTES} byte limit (${snapshot.size} bytes): ${displayPath}`)
    }

    const data = await readStreamToBuffer(snapshot.createReadStream())
    // Re-check against the actual read size: the file can grow between stat and read.
    if (data.length > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File exceeds the ${MAX_FILE_SIZE_BYTES} byte limit (${data.length} bytes): ${displayPath}`)
    }
    const filename = path.basename(requestedPath)
    return {
      filename,
      data: data.toString('base64'),
      media_type: mimeForFilename(filename),
      size: data.length
    }
  } finally {
    // Swallow close errors so they can't mask an in-flight resolution error.
    await snapshot.close().catch(() => {})
  }
}

/**
 * Resolve and read a local file. Relative paths are resolved from `basePath`.
 * NOTE: no containment check — an absolute `userPath` escapes `basePath`.
 */
export async function resolveLocalFile(basePath: string, userPath: string): Promise<FileAttachment> {
  const requestedPath = path.resolve(basePath, userPath)

  let canonicalPath: string
  try {
    canonicalPath = await realpath(AbsoluteFilePathSchema.parse(requestedPath))
  } catch (error) {
    if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      throw new Error(`File not found: ${userPath}`)
    }
    throw error
  }

  return readCanonicalLocalFile(requestedPath, canonicalPath, userPath)
}
