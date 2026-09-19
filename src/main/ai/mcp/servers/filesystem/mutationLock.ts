import path from 'path'

const mutationChains = new Map<string, Promise<unknown>>()

function toLockKey(filePath: string): string {
  const normalizedPath = path.normalize(path.resolve(filePath))
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath
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
