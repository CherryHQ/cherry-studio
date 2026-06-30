import type { FileHandle } from 'node:fs/promises'
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'

import type { FileAttachment } from '@main/utils/downloadAsBase64'
import { MAX_FILE_SIZE_BYTES } from '@main/utils/downloadAsBase64'

import { FILE_EXTENSION_MIME_MAP } from '../utils'

export type WorkspaceFileErrorReason = 'outside-workspace' | 'not-found' | 'too-large' | 'not-a-file'

/** Raised when an outbound file can't be safely resolved from the session workspace. */
export class WorkspaceFileError extends Error {
  constructor(
    readonly reason: WorkspaceFileErrorReason,
    message: string
  ) {
    super(message)
    this.name = 'WorkspaceFileError'
  }
}

export function isWorkspaceFileError(error: unknown): error is WorkspaceFileError {
  return error instanceof WorkspaceFileError
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function mimeForFilename(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase()
  return FILE_EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream'
}

/**
 * Resolve an agent-supplied path into a `FileAttachment`, confined to the session
 * workspace. Accepts paths relative to the workspace and absolute paths that land
 * inside it. `realpath` defeats `../` and symlink escape; reading happens on a single
 * fd over the canonical path so the stat/size check and the read see the same inode.
 *
 * This is defense-in-depth against traversal mistakes and prompt injection picking a
 * wrong path — not a sandbox against an agent with code execution (which can already
 * read arbitrary files and exfiltrate them as message text). See the #16566 plan, D2.
 */
export async function resolveWorkspaceFile(workspaceRoot: string, userPath: string): Promise<FileAttachment> {
  const requested = path.resolve(workspaceRoot, userPath)

  const realRoot = await realpath(workspaceRoot)

  let realTarget: string
  try {
    realTarget = await realpath(requested)
  } catch (error) {
    if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      throw new WorkspaceFileError('not-found', `File not found in workspace: ${userPath}`)
    }
    throw error
  }

  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    throw new WorkspaceFileError('outside-workspace', `Path is outside the workspace: ${userPath}`)
  }

  let fd: FileHandle
  try {
    fd = await open(realTarget, 'r')
  } catch (error) {
    if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      throw new WorkspaceFileError('not-found', `File not found in workspace: ${userPath}`)
    }
    throw error
  }

  try {
    const stats = await fd.stat()
    if (!stats.isFile()) {
      throw new WorkspaceFileError('not-a-file', `Not a regular file: ${userPath}`)
    }
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      throw new WorkspaceFileError(
        'too-large',
        `File exceeds the ${MAX_FILE_SIZE_BYTES} byte limit (${stats.size} bytes): ${userPath}`
      )
    }

    const buffer = await fd.readFile()
    const filename = path.basename(requested)
    return {
      filename,
      data: buffer.toString('base64'),
      media_type: mimeForFilename(filename),
      size: buffer.length
    }
  } finally {
    await fd.close()
  }
}
