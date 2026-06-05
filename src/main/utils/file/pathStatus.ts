import { loggerService } from '@logger'
import type { FilePath } from '@shared/file/types'

import { stat } from './fs'

const logger = loggerService.withContext('utils/file/pathStatus')

/**
 * Path-status types. These are **main-internal**: `getPathStatus` is a single
 * `fs.stat` consumed inside main (e.g. `settingsBuilder`) and the typed status
 * never crosses the IPC boundary — error interpretation is a main-side
 * concern, so the renderer receives finished messages, not this union. See
 * `assertClaudeCodeWorkspaceDirectory` (settingsBuilder) for how an invalid
 * workspace surfaces at send time.
 */
export type PathStatusKind = 'file' | 'directory'

export type PathStatus =
  | { ok: true; kind: PathStatusKind }
  | { ok: false; reason: 'missing' | 'inaccessible'; detail?: string }
  | { ok: false; reason: 'not-file' | 'not-directory'; actualKind: PathStatusKind }

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined
}

function errorDetail(error: unknown): string | undefined {
  return error instanceof Error ? error.message : String(error)
}

function mismatchReason(expectedKind: PathStatusKind): 'not-file' | 'not-directory' {
  return expectedKind === 'file' ? 'not-file' : 'not-directory'
}

export async function getPathStatus(path: string, options?: { expectedKind?: PathStatusKind }): Promise<PathStatus> {
  if (!path.trim()) {
    return { ok: false, reason: 'missing' }
  }

  try {
    const stats = await stat(path as FilePath)
    const actualKind = stats.isDirectory ? 'directory' : 'file'
    if (options?.expectedKind && actualKind !== options.expectedKind) {
      return { ok: false, reason: mismatchReason(options.expectedKind), actualKind }
    }
    return { ok: true, kind: actualKind }
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      // `ENOTDIR` (a path component is a non-directory) is intentionally folded
      // into `missing` alongside `ENOENT`: for "does this path resolve?" both
      // answer "no". The distinction is not surfaced because no consumer
      // branches on it — error interpretation belongs on the main side (see
      // `assertClaudeCodeWorkspaceDirectory` in settingsBuilder).
      return { ok: false, reason: 'missing', detail: errorDetail(error) }
    }
    // Truly-unexpected errno (EIO / EMFILE / ELOOP / EACCES …). Map to
    // `inaccessible` but warn-log so the underlying cause leaves a breadcrumb,
    // matching the observability discipline in sibling `fs.ts`.
    logger.warn('getPathStatus: unexpected stat error, reporting as inaccessible', { path, code, error })
    return { ok: false, reason: 'inaccessible', detail: errorDetail(error) }
  }
}

export function formatPathStatusMessage(path: string, status: Exclude<PathStatus, { ok: true }>, label = 'Path') {
  switch (status.reason) {
    case 'missing':
      return `${label} does not exist: ${path}${status.detail ? `. ${status.detail}` : ''}`
    case 'not-file':
      return `${label} is not a file: ${path}`
    case 'not-directory':
      return `${label} is not a directory: ${path}`
    case 'inaccessible':
      return `${label} is not accessible: ${path}${status.detail ? `. ${status.detail}` : ''}`
  }
}
