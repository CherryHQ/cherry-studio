import { realpathSync, statSync } from 'node:fs'
import path from 'path'

import { isMac, isWin } from '@main/core/platform'

import { expandHome } from './types'

const mutationChains = new Map<string, Promise<unknown>>()
const activeSubtreeRoots = new Map<string, Promise<unknown>>()

function toLockKey(canonicalAbsolute: string): string {
  const normalizedPath = path.normalize(path.resolve(canonicalAbsolute))
  return isMac || isWin ? normalizedPath.toLowerCase() : normalizedPath
}

// Canonical absolute path without case folding. Returned as the stat probe so
// filesystem identity is derived from the real entry even when the path key is
// folded for case-insensitive comparison.
function toCanonicalAbsolute(requestedPath: string, baseDir?: string): string {
  const expandedPath = expandHome(requestedPath)
  const root = expandHome(baseDir ?? process.cwd())
  const absolute = path.isAbsolute(expandedPath) ? path.resolve(expandedPath) : path.resolve(root, expandedPath)
  try {
    return path.normalize(realpathSync(absolute))
  } catch {
    let parent = path.dirname(absolute)
    while (true) {
      try {
        return path.normalize(path.resolve(realpathSync(parent), path.relative(parent, absolute)))
      } catch {
        const nextParent = path.dirname(parent)
        if (nextParent === parent) return path.normalize(absolute)
        parent = nextParent
      }
    }
  }
}

export interface MutationLockKeys {
  pathKey: string
  probePath: string
}

// Locks by canonical path so alias spellings share one queue. Resolves through the
// nearest existing ancestor so aliases agree even when the target is yet to be created.
export function resolveMutationLockKeys(requestedPath: string, baseDir?: string): MutationLockKeys {
  const probePath = toCanonicalAbsolute(requestedPath, baseDir)
  return { pathKey: toLockKey(probePath), probePath }
}

export function resolveMutationLockKey(requestedPath: string, baseDir?: string): string {
  return resolveMutationLockKeys(requestedPath, baseDir).pathKey
}

// Lock existing targets by filesystem identity so hard-link names share one queue.
// Takes the unfolded probe path: on case-folding platforms the folded key may not
// name a real entry on a case-sensitive volume. Missing targets use the path key.
function toIdentityKey(probePath: string): string | undefined {
  try {
    const stats = statSync(probePath)
    return `ino:${stats.dev}:${stats.ino}`
  } catch {
    return undefined
  }
}

function isDescendantOrSelf(childKey: string, ancestorKey: string): boolean {
  return childKey === ancestorKey || childKey.startsWith(ancestorKey + path.sep)
}

export function withPathMutationLock<T>(lockKeys: string | MutationLockKeys, fn: () => Promise<T>): Promise<T> {
  const pathKey = typeof lockKeys === 'string' ? toLockKey(lockKeys) : lockKeys.pathKey
  const probePath = typeof lockKeys === 'string' ? lockKeys : lockKeys.probePath
  const ancestorWaits = [...activeSubtreeRoots]
    .filter(([dirKey]) => isDescendantOrSelf(pathKey, dirKey))
    .map(([, pending]) => pending)
  return withRawMutationLock(pathKey, async () => {
    if (ancestorWaits.length > 0) {
      await Promise.all(ancestorWaits.map((pending) => pending.catch(() => undefined)))
    }
    const identityKey = toIdentityKey(probePath)
    return identityKey ? withRawMutationLock(identityKey, fn) : fn()
  })
}

export function withMutationLockForRequest<T>(
  requestedPath: string,
  baseDir: string | undefined,
  fn: () => Promise<T>,
  opts?: { subtreeRoot?: boolean }
): Promise<T> {
  const keys = resolveMutationLockKeys(requestedPath, baseDir)
  if (!opts?.subtreeRoot) {
    return withPathMutationLock(keys, fn)
  }
  const descendantWaits = [...mutationChains]
    .filter(([key]) => isDescendantOrSelf(key, keys.pathKey))
    .map(([, pending]) => pending)
  const overlappingRoots = [...activeSubtreeRoots]
    .filter(([dirKey]) => isDescendantOrSelf(keys.pathKey, dirKey) || isDescendantOrSelf(dirKey, keys.pathKey))
    .map(([, pending]) => pending)
  let releaseRoot!: () => void
  const rootPending = new Promise<void>((resolve) => {
    releaseRoot = resolve
  })
  activeSubtreeRoots.set(keys.pathKey, rootPending)
  return withRawMutationLock(keys.pathKey, async () => {
    await Promise.all([...descendantWaits, ...overlappingRoots].map((pending) => pending.catch(() => undefined)))
    try {
      const identityKey = toIdentityKey(keys.probePath)
      return identityKey ? await withRawMutationLock(identityKey, fn) : await fn()
    } finally {
      if (activeSubtreeRoots.get(keys.pathKey) === rootPending) {
        activeSubtreeRoots.delete(keys.pathKey)
      }
      releaseRoot()
    }
  })
}

function withRawMutationLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
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
