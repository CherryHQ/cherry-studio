import { onAbort } from './cancellation'

/** Cancel this wait only. Shared work and its lifetime remain with the owner. */
export function raceCancellation<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  reason: (signal: AbortSignal) => unknown = (signal) => signal.reason
): Promise<T> {
  if (!signal) return promise
  let detachAbort = () => {}
  const result = new Promise<T>((resolve, reject) => {
    promise.then(resolve, reject)
    detachAbort = onAbort(signal, () => reject(reason(signal)))
  })
  return result.finally(() => detachAbort())
}
