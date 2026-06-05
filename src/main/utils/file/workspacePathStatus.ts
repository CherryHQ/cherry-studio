import fs from 'node:fs'

import type { WorkspacePathStatus } from '@shared/file/types/ipc'

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined
}

function errorDetail(error: unknown): string | undefined {
  return error instanceof Error ? error.message : String(error)
}

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
