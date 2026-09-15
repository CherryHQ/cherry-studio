/** Subscribe once, immediately for an aborted signal; detach only releases this subscription. */
export function onAbort(signal: AbortSignal | undefined, callback: (reason: unknown) => void): () => void {
  if (!signal) return () => {}
  if (signal.aborted) {
    callback(signal.reason)
    return () => {}
  }
  const listener = () => callback(signal.reason)
  signal.addEventListener('abort', listener, { once: true })
  return () => signal.removeEventListener('abort', listener)
}

/** Match the exact structural AbortError name without requiring an Error instance. */
export function isAbortError(error: unknown): boolean {
  return !!(error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError')
}

/** Create an ordinary Error with the AbortError name and the caller's exact message. */
export function createAbortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}
