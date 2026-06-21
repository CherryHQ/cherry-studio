import type { FilePath } from '@shared/types/file'

import { stat } from './fs'

/**
 * Path-status facts for an arbitrary path. **Main-internal**: `getPathStatus`
 * is a single `fs.stat` consumed inside main (e.g. `settingsBuilder`) and never
 * crosses the IPC boundary. It reports facts only — does the path resolve, and
 * if so is it a file or a directory — leaving any policy (e.g. "a workspace
 * must be a directory") and message production to the consumer. See
 * `assertClaudeCodeWorkspaceDirectory` (settingsBuilder) for how an invalid
 * workspace surfaces at send time.
 */
export type PathStatusKind = 'file' | 'directory'

export type PathStatus = { ok: true; kind: PathStatusKind } | { ok: false; reason: 'missing' | 'inaccessible' }

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined
}

export async function getPathStatus(path: string): Promise<PathStatus> {
  if (!path.trim()) {
    return { ok: false, reason: 'missing' }
  }

  try {
    const stats = await stat(path as FilePath)
    return { ok: true, kind: stats.isDirectory ? 'directory' : 'file' }
  } catch (error) {
    // `ENOENT` (nothing there) and `ENOTDIR` (a path component is a
    // non-directory) both mean "does not resolve"; any other errno is reported
    // as inaccessible.
    const code = errorCode(error)
    return code === 'ENOENT' || code === 'ENOTDIR'
      ? { ok: false, reason: 'missing' }
      : { ok: false, reason: 'inaccessible' }
  }
}
