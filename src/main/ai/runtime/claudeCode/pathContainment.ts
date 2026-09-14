/**
 * Workspace path containment for Claude Code file tools.
 *
 * Resolves a tool-requested path against the session workspace and answers whether it stays inside
 * the allowed roots (workspace + agent data directory). Symlinks are canonicalized so an outside
 * target cannot look lexically inside; for not-yet-existing targets the nearest existing ancestor is
 * canonicalized and the missing suffix re-appended. Ambiguity (`~`, dangling symlinks, resolution
 * failure) counts as outside so the caller requires approval.
 */

import * as fs from 'node:fs'
import path from 'node:path'

import { isPathInside } from '@main/utils/file'

async function resolveRealOrNearestExistingPath(targetPath: string): Promise<string> {
  try {
    return path.normalize(await fs.promises.realpath(targetPath))
  } catch {
    let currentPath = path.dirname(targetPath)

    while (true) {
      try {
        const realCurrentPath = await fs.promises.realpath(currentPath)
        const relativeSuffix = path.relative(currentPath, targetPath)
        return path.normalize(path.join(realCurrentPath, relativeSuffix))
      } catch {
        const parentPath = path.dirname(currentPath)
        if (parentPath === currentPath) {
          return path.normalize(targetPath)
        }
        currentPath = parentPath
      }
    }
  }
}

async function canonicalizeToolTarget(target: string): Promise<string | undefined> {
  try {
    return path.normalize(await fs.promises.realpath(target))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
    // A dangling symlink exists but cannot be canonicalized; treat it as ambiguous, not as a new file.
    try {
      await fs.promises.lstat(target)
      return undefined
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
    }
  }

  let parent = path.dirname(target)
  while (true) {
    try {
      const canonicalParent = await fs.promises.realpath(parent)
      return path.resolve(canonicalParent, path.relative(parent, target))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
      try {
        await fs.promises.lstat(parent)
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

export async function isPathWithinAllowedRoots(
  cwd: string,
  agentDataPath: string,
  requestedPath: string
): Promise<boolean> {
  if (requestedPath === '~' || requestedPath.startsWith('~/') || requestedPath.startsWith('~\\')) {
    return false
  }

  const absoluteTarget = path.isAbsolute(requestedPath) ? path.resolve(requestedPath) : path.resolve(cwd, requestedPath)
  const [resolvedWorkspace, resolvedAgentDataPath, resolvedTarget] = await Promise.all([
    resolveRealOrNearestExistingPath(path.resolve(cwd)),
    resolveRealOrNearestExistingPath(path.resolve(agentDataPath)),
    canonicalizeToolTarget(absoluteTarget)
  ])
  if (!resolvedTarget) return false
  return (
    resolvedTarget === resolvedWorkspace ||
    isPathInside(resolvedTarget, resolvedWorkspace) ||
    resolvedTarget === resolvedAgentDataPath ||
    isPathInside(resolvedTarget, resolvedAgentDataPath)
  )
}
