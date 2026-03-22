/**
 * Determines whether the given error is a timeout error.
 *
 * @param error - The error to check.
 * @returns `true` if the error (or its cause) is a `DOMException` with the name `'TimeoutError'`, otherwise `false`.
 */
export const isTimeoutError = (error: unknown): boolean => {
  if (error instanceof DOMException) {
    if (error.name === 'TimeoutError') {
      return true
    } else if (error.cause instanceof DOMException && error.cause.name === 'TimeoutError') {
      return true
    }
  }

  return false
}
