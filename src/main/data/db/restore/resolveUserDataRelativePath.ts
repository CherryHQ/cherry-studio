import path from 'node:path'

import { application } from '@application'

/**
 * Resolve a journal-relative path against the canonical userData root with
 * containment checks. Shared by restore promotion and terminal artifact cleanup
 * so both enforce the same rule:
 * - reject absolute inputs
 * - resolve against `application.getPath('app.userdata')`
 * - `path.relative()` must not be `''` (root), `..` / `..`-prefixed, or an
 *   absolute relative result (cross-volume)
 */
export function resolveUserDataRelativePath(relativePath: string): string {
  if (!relativePath || relativePath.trim().length === 0) {
    throw new Error('userData-relative path must be non-empty')
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error(`userData-relative path must not be absolute: ${relativePath}`)
  }
  const userData = application.getPath('app.userdata')
  const resolved = path.resolve(userData, relativePath)
  const relative = path.relative(userData, resolved)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`userData-relative path escapes userData: ${relativePath}`)
  }
  return resolved
}
