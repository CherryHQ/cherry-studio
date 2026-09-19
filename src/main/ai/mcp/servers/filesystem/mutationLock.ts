import path from 'path'

import { expandHome } from './types'

const mutationChains = new Map<string, Promise<unknown>>()

function toLockKey(filePath: string): string {
  const normalizedPath = path.normalize(path.resolve(filePath))
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath
}

// Synchronously derives a lock key from the requested path. Mirrors the
// synchronous preamble of validatePath so handlers can acquire the lock
// before any await and preserve call order. Canonicalization (symlinks)
// still happens inside via validatePath.
export function resolveMutationLockKey(requestedPath: string, baseDir?: string): string {
  const expandedPath = expandHome(requestedPath)
  const root = expandHome(baseDir ?? process.cwd())
  const absolute = path.isAbsolute(expandedPath) ? path.resolve(expandedPath) : path.resolve(root, expandedPath)
  return toLockKey(absolute)
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
