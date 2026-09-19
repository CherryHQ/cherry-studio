import { realpathSync } from 'node:fs'
import path from 'path'

import { isMac, isWin } from '@main/core/platform'

import { expandHome } from './types'

const mutationChains = new Map<string, Promise<unknown>>()

function toLockKey(filePath: string): string {
  const normalizedPath = path.normalize(path.resolve(filePath))
  return isMac || isWin ? normalizedPath.toLowerCase() : normalizedPath
}

// Locks by canonical path when the target exists so alias spellings share one queue; falls back otherwise.
export function resolveMutationLockKey(requestedPath: string, baseDir?: string): string {
  const expandedPath = expandHome(requestedPath)
  const root = expandHome(baseDir ?? process.cwd())
  const absolute = path.isAbsolute(expandedPath) ? path.resolve(expandedPath) : path.resolve(root, expandedPath)
  try {
    return toLockKey(realpathSync(absolute))
  } catch {
    return toLockKey(absolute)
  }
}

export function withPathMutationLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = toLockKey(filePath)
  const previous = mutationChains.get(lockKey) ?? Promise.resolve()
  const next = previous.then(fn, fn)
  const tracked = next.catch(() => undefined)

  mutationChains.set(lockKey, tracked)

  void tracked.finally(() => {
    if (mutationChains.get(lockKey) === tracked) {
      mutationChains.delete(lockKey)
    }
  })

  return next
}
