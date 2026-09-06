/**
 * Workspace path containment for Claude Code file tools.
 *
 * Resolves a tool-requested path against the session workspace and answers whether it stays inside
 * the allowed roots (workspace + agent data directory). Symlinks are canonicalized so an outside
 * target cannot look lexically inside; for not-yet-existing targets the nearest existing ancestor is
 * canonicalized and the missing suffix re-appended. Ambiguity (`~`, resolution failure) counts as
 * outside so the caller requires approval.
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
    resolveRealOrNearestExistingPath(absoluteTarget)
  ])
  return (
    resolvedTarget === resolvedWorkspace ||
    isPathInside(resolvedTarget, resolvedWorkspace) ||
    resolvedTarget === resolvedAgentDataPath ||
    isPathInside(resolvedTarget, resolvedAgentDataPath)
  )
}
