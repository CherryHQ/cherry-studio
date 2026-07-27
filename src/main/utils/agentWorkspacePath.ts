import { DataApiErrorFactory } from '@shared/data/api/errors'
import path from 'path'

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

function formatLocalDate(timestampMs: number): string {
  const date = new Date(timestampMs)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function systemWorkspacePath(systemWorkspacesRoot: string, sessionId: string, createdAt: number): string {
  if (!sessionId || sessionId === '.' || sessionId === '..' || /[\\/]/.test(sessionId)) {
    throw new Error(`Invalid agent session id for system workspace: ${sessionId}`)
  }
  return path.join(systemWorkspacesRoot, formatLocalDate(createdAt), sessionId)
}
