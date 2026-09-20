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
  // Derive identity synchronously so hard-link aliases sharing one inode join the
  // same queue in call order instead of racing to register it from inside the path queue.
  const identityKey = toIdentityKey(probePath)
  const keys = identityKey ? [pathKey, identityKey] : [pathKey]
  return withCombinedMutationLocks(keys, async () => {
    if (ancestorWaits.length > 0) {
      await Promise.all(ancestorWaits.map((pending) => pending.catch(() => undefined)))
    }
    return fn()
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
  const identityKey = toIdentityKey(keys.probePath)
  const combinedKeys = identityKey ? [keys.pathKey, identityKey] : [keys.pathKey]
  return withCombinedMutationLocks(combinedKeys, async () => {
    await Promise.all([...descendantWaits, ...overlappingRoots].map((pending) => pending.catch(() => undefined)))
    try {
      return await fn()
    } finally {
      if (activeSubtreeRoots.get(keys.pathKey) === rootPending) {
        activeSubtreeRoots.delete(keys.pathKey)
      }
      releaseRoot()
    }
  })
}

// Registers every key synchronously at call time and runs fn once all
// predecessors complete, so call order decides queue order on each key.
function withCombinedMutationLocks<T>(lockKeys: string[], fn: () => Promise<T>): Promise<T> {
  const uniqueKeys = [...new Set(lockKeys)]
  const predecessors = uniqueKeys.map((key) => mutationChains.get(key) ?? Promise.resolve())
  const gate = Promise.all(predecessors.map((pending) => pending.catch(() => undefined)))
  const next = gate.then(fn, fn)
  const tracked = next.catch(() => undefined)

  for (const key of uniqueKeys) mutationChains.set(key, tracked)

  void tracked.finally(() => {
    for (const key of uniqueKeys) {
      if (mutationChains.get(key) === tracked) {
        mutationChains.delete(key)
      }
    }
  })

  return next
}
