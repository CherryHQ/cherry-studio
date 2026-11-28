import { RetryError } from 'ai'

export function getTerminalModelError(error: unknown): unknown {
  for (let depth = 0; depth < 8 && RetryError.isInstance(error) && error.lastError !== undefined; depth++) {
    error = error.lastError
  }
  return error
}
