import type { AbsoluteFilePath } from '@shared/types/file'
import { canonicalizeFilePath } from '@shared/utils/file'

export function normalizeAccessPath(path: AbsoluteFilePath): AbsoluteFilePath {
  // Network addresses are valid for filesystem access, but not persistent entry keys.
  if (path.startsWith('\\\\') || path.startsWith('//')) return path
  return canonicalizeFilePath(path)
}
