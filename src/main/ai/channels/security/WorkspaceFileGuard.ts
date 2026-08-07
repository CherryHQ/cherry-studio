import { realpath } from 'node:fs/promises'
import path from 'node:path'

import type { FileAttachment } from '@main/utils/downloadAsBase64'

import { readCanonicalLocalFile } from './localFileResolver'

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

/**
 * Resolve an agent-supplied path into a `FileAttachment`, confined to the session
 * workspace. Accepts paths relative to the workspace and absolute paths that land
 * inside it. `realpath` defeats `../` and symlink escape; reading happens on a single
 * fd over the canonical path so the stat/size check and the read see the same inode.
 *
 * This is defense-in-depth against traversal mistakes and prompt injection picking a
 * wrong path — not a sandbox against an agent with code execution (which can already
 * read arbitrary files and exfiltrate them as message text). See #16566.
 */
export async function resolveWorkspaceFile(workspaceRoot: string, userPath: string): Promise<FileAttachment> {
  const requested = path.resolve(workspaceRoot, userPath)

  let realRoot: string
  try {
    realRoot = await realpath(workspaceRoot)
  } catch (error) {
    // The root is a caller invariant, but if the session workspace is gone a bare ENOENT
    // naming the root reads like "your file_path is wrong" — wrap it so the agent doesn't
    // waste retries on other paths.
    if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      throw new Error(`Session workspace is unavailable: ${workspaceRoot}`)
    }
    throw error
  }

  let realTarget: string
  try {
    realTarget = await realpath(requested)
  } catch (error) {
    if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      throw new Error(`File not found in workspace: ${userPath}`)
    }
    throw error
  }

  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    throw new Error(`Path is outside the workspace: ${userPath}`)
  }

  return readCanonicalLocalFile(requested, realTarget, userPath)
}
