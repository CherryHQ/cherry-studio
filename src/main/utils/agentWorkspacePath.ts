import { DataApiErrorFactory } from '@shared/data/api'
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
