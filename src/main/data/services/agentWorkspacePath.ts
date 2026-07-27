import path from 'node:path'

import { DataApiErrorFactory } from '@shared/data/api/errors'

export function normalizeWorkspacePath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) {
    throw DataApiErrorFactory.validation({ path: ['Workspace path is required'] })
  }
  if (!path.isAbsolute(trimmed)) {
    throw DataApiErrorFactory.validation({ path: ['Workspace path must be absolute'] })
  }
  const normalized = path.normalize(trimmed)
  const root = path.parse(normalized).root
  let end = normalized.length
  while (end > root.length && /[\\/]/.test(normalized[end - 1])) end -= 1
  return normalized.slice(0, end)
}

function formatUtcDate(timestampMs: number): string {
  const date = new Date(timestampMs)
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function systemWorkspacePath(systemWorkspacesRoot: string, sessionId: string, createdAt: number): string {
  if (!sessionId || sessionId === '.' || sessionId === '..' || /[\\/]/.test(sessionId)) {
    throw new Error(`Invalid agent session id for system workspace: ${sessionId}`)
  }
  return path.join(systemWorkspacesRoot, formatUtcDate(createdAt), sessionId)
}
