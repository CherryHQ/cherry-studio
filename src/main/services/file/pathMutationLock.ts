import { Mutex } from 'async-mutex'

const pathMutationLock = new Mutex()

export function runPathMutationExclusive<T>(operation: () => T | Promise<T>): Promise<T> {
  return pathMutationLock.runExclusive(operation)
}
