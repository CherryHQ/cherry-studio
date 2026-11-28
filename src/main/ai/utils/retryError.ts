import { RetryError } from 'ai'

export function unwrapRetryError(error: unknown): unknown {
  for (let depth = 0; depth < 8 && RetryError.isInstance(error); depth++) {
    error = error.lastError
  }
  return error
}
