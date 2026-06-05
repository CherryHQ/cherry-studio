import { loggerService } from '@logger'
import type { FilePath } from '@shared/file/types'
import type { PathStatus, PathStatusKind } from '@shared/file/types/ipc'

// `errorCode` / `errorDetail` are shared with the sync, workspace-scoped
// `workspacePathStatus.ts`; see `./errno` for how the two path-status utilities
// relate (this one is async/general, that one is sync/workspace-scoped).
import { errorCode, errorDetail } from './errno'
import { stat } from './fs'

const logger = loggerService.withContext('utils/file/pathStatus')

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
