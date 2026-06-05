import fs from 'node:fs'

import type { WorkspacePathStatus } from '@shared/file/types/ipc'

// `errorCode` / `errorDetail` are shared with the async, general-purpose
// `pathStatus.ts`; see `./errno` for how the two path-status utilities relate.
// This one stays sync (`statSync`) because it is called from sync workspace
// validation paths, so it cannot be folded into the async sibling.
import { errorCode, errorDetail } from './errno'

export function checkWorkspacePathStatus(workspacePath: string): WorkspacePathStatus {
  if (!workspacePath.trim()) {
    return { ok: false, reason: 'missing' }
  }

  try {
    const stats = fs.statSync(workspacePath)
    if (!stats.isDirectory()) {
      return { ok: false, reason: 'not-directory' }
    }
    return { ok: true }
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { ok: false, reason: 'missing', detail: errorDetail(error) }
    }
    return { ok: false, reason: 'inaccessible', detail: errorDetail(error) }
  }
}

export function formatWorkspacePathStatus(workspacePath: string, status: Exclude<WorkspacePathStatus, { ok: true }>) {
  const detail = status.detail ? `. ${status.detail}` : ''
  switch (status.reason) {
    case 'missing':
      return `Workspace path does not exist: ${workspacePath}${detail}`
    case 'not-directory':
      return `Workspace path is not a directory: ${workspacePath}`
    case 'inaccessible':
      return `Workspace path is not accessible: ${workspacePath}${detail}`
  }
}
