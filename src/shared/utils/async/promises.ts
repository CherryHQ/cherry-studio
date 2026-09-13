import { delay as toolkitDelay } from 'es-toolkit'

import type { Disposable } from '@shared/types/disposable'

import { onAbort } from './cancellation'

export type Deferred<T> = PromiseWithResolvers<T>

/** Observe early rejection without replacing the original promise or its eventual outcome. */
export function createDeferred<T>(): Deferred<T> {
  const deferred = Promise.withResolvers<T>()
  void deferred.promise.catch(() => {})
  return deferred
}

/** Wait for a duration; cancellation rejects with the owner's original reason. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return toolkitDelay(ms, { signal }).catch((error) => {
    throw signal?.aborted ? signal.reason : error
  })
}

export interface TimeoutOptions {
  /** In Node, false lets the process exit while the deadline is pending. */
  ref?: boolean
}

/** A single deadline reusable across several waits. Dispose releases the timer without settling the promise. */
export function createTimeout<R>(
  ms: number,
  onTimeout: () => R | PromiseLike<R>,
  options?: TimeoutOptions
): Disposable & { promise: Promise<R> } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<R>((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        resolve(onTimeout())
      } catch (error) {
        reject(error)
      }
    }, ms)
    if (options?.ref === false && typeof timer !== 'number') {
      timer.unref()
    }
  })
  return { promise: timeout, dispose: () => clearTimeout(timer) }
}

/** Disposable deadline with a lazy owner reason; disposal leaves parent cancellation connected. */
export function createDisposableTimeoutSignal(
  timeoutMs: number,
  timeoutReason: () => unknown,
  parent?: AbortSignal
): Disposable & { signal: AbortSignal } {
  const controller = new AbortController()
  const timeout = createTimeout(timeoutMs, () => controller.abort(timeoutReason()))
  return {
    signal: parent ? AbortSignal.any([parent, controller.signal]) : controller.signal,
    dispose: timeout.dispose
  }
}

/** Stop waiting at the deadline. The owner decides the fallback; work is not cancelled. */
export async function raceTimeout<T, R>(
  promise: PromiseLike<T>,
  ms: number,
  onTimeout: () => R | PromiseLike<R>,
  options?: TimeoutOptions
): Promise<T | R> {
  const timeout = createTimeout(ms, onTimeout, options)
  try {
    return await Promise.race([promise, timeout.promise])
  } finally {
    timeout.dispose()
  }
}

/** Reject at the deadline with a caller-supplied error, without cancelling work. */
export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  error: () => unknown,
  options?: TimeoutOptions
): Promise<T> {
  return raceTimeout(
    promise,
    ms,
    () => {
      throw error()
    },
    options
  )
}

/** Cancel this wait only. Shared work and its lifetime remain with the owner. */
export function raceCancellation<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  reason: (signal: AbortSignal) => unknown = (signal) => signal.reason
): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    let detachAbort = () => {}
    promise.then(
      (value) => {
        detachAbort()
        resolve(value)
      },
      (error) => {
        detachAbort()
        reject(error)
      }
    )
    detachAbort = onAbort(signal, () => reject(reason(signal)))
  })
}
