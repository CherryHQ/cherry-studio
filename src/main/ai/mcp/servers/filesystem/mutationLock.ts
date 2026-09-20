import { realpathSync, statSync } from 'node:fs'
import path from 'path'

import { isMac, isWin } from '@main/core/platform'

import { expandHome } from './types'

const mutationChains = new Map<string, Promise<unknown>>()

function toLockKey(filePath: string): string {
  const normalizedPath = path.normalize(path.resolve(filePath))
  return isMac || isWin ? normalizedPath.toLowerCase() : normalizedPath
}

// Locks by canonical path so alias spellings share one queue. Resolves through the
// nearest existing ancestor so aliases agree even when the target is yet to be created.
export function resolveMutationLockKey(requestedPath: string, baseDir?: string): string {
  const expandedPath = expandHome(requestedPath)
  const root = expandHome(baseDir ?? process.cwd())
  const absolute = path.isAbsolute(expandedPath) ? path.resolve(expandedPath) : path.resolve(root, expandedPath)
  try {
    return toLockKey(realpathSync(absolute))
  } catch {
    let parent = path.dirname(absolute)
    while (true) {
      try {
        return toLockKey(path.resolve(realpathSync(parent), path.relative(parent, absolute)))
      } catch {
        const nextParent = path.dirname(parent)
        if (nextParent === parent) return toLockKey(absolute)
        parent = nextParent
      }
    }
  }
}

// Lock existing targets by filesystem identity so hard-link names share one queue.
// Synchronous stat keeps call-order registration; missing targets use the path key.
function toIdentityKey(filePath: string): string | undefined {
  try {
    const stats = statSync(filePath)
    return `ino:${stats.dev}:${stats.ino}`
  } catch {
    return undefined
  }
}

export function withPathMutationLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  // Chain the path queue first, then the identity queue when the target exists. Both keys
  // are derived synchronously at call time and held for the whole operation: the path key is
  // stable across create/delete existence flips, the identity key unifies hard-link aliases.
  return withRawMutationLock(toLockKey(filePath), () => {
    const identityKey = toIdentityKey(filePath)
    return identityKey ? withRawMutationLock(identityKey, fn) : fn()
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
