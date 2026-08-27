import { lstat, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface PermissionRoots {
  workspace: string
  agentData: string
}

/** Unicode spaces pi normalizes before resolving a tool path. */
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g

function resolveRequestedPath(raw: string, workspace: string): string | undefined {
  let value = raw.replace(UNICODE_SPACES, ' ')
  if (value.startsWith('@')) value = value.slice(1)
  if (value === '~') value = os.homedir()
  else if (value.startsWith('~/') || (process.platform === 'win32' && value.startsWith('~\\'))) {
    value = path.join(os.homedir(), value.slice(2))
  } else if (value.startsWith('file://')) {
    // URL parsing would make this a second path-resolution contract. Keep ambiguous URLs outside.
    return undefined
  }
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspace, value)
}

async function canonicalizeExistingPath(target: string): Promise<string | undefined> {
  try {
    return path.normalize(await realpath(target))
  } catch {
    return undefined
  }
}

/**
 * Canonicalize an existing path, or a not-yet-existing target when allowed.
 * The nearest existing ancestor is canonicalized so a symlink cannot hide an outside destination.
 * Dangling symlinks and every non-ENOENT failure are ambiguous and fail closed.
 */
export async function canonicalizeTarget(target: string, allowMissingTarget = false): Promise<string | undefined> {
  try {
    return path.normalize(await realpath(target))
  } catch (error) {
    if (!allowMissingTarget || (error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
    try {
      await lstat(target)
      // The target exists but realpath failed, which includes dangling symlinks.
      return undefined
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
    }
  }

  let parent = path.dirname(target)
  while (true) {
    try {
      const canonicalParent = await realpath(parent)
      return path.normalize(path.resolve(canonicalParent, path.relative(parent, target)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
      try {
        await lstat(parent)
        return undefined
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
      }
      const next = path.dirname(parent)
      if (next === parent) return undefined
      parent = next
    }
  }
}

function isWithinRoot(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

/**
 * Resolve and compare one structured tool path against the two trusted roots.
 * Root canonicalization failures are not ignored. A missing root must never turn into an allow.
 */
export async function isPathWithinRoots(
  roots: PermissionRoots,
  requestedPath: string,
  allowMissingTarget = false
): Promise<boolean> {
  if (typeof requestedPath !== 'string') return false
  const resolved = resolveRequestedPath(requestedPath, roots.workspace)
  if (!resolved) return false

  const [workspace, agentData, target] = await Promise.all([
    canonicalizeExistingPath(path.resolve(roots.workspace)),
    canonicalizeExistingPath(path.resolve(roots.agentData)),
    canonicalizeTarget(resolved, allowMissingTarget)
  ])
  if (!workspace || !agentData || !target) return false
  return isWithinRoot(target, workspace) || isWithinRoot(target, agentData)
}
