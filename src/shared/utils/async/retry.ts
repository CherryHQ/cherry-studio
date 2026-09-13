import { delay } from './promises'

export interface RetryOptions {
  /** Total attempts, including the initial call. */
  maxAttempts: number
  /** Delay after the failed attempt, numbered from one. */
  delayMs: number | ((attempt: number) => number)
  shouldRetry: (error: unknown) => boolean
  signal?: AbortSignal
}

/** Retry a transient failure; the owner supplies policy. No wait follows the final attempt. */
export async function retry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    options.signal?.throwIfAborted()
    try {
      return await operation()
    } catch (error) {
      if (options.signal?.aborted || attempt >= options.maxAttempts || !options.shouldRetry(error)) throw error
      await delay(typeof options.delayMs === 'function' ? options.delayMs(attempt) : options.delayMs, options.signal)
    }
  }
}
