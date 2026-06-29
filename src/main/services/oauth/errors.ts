export class OAuthServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly code?: string
  ) {
    super(message)
    this.name = 'OAuthServiceError'
  }
}

/**
 * Reduce an OAuth error (and its `cause` chain) to a log-safe shape: name,
 * message, and an HTTP `status` when present. Deliberately drops any raw token
 * endpoint response body — `OAuthHttpError.body` can carry provider error
 * payloads, and the logger serializes errors to disk verbatim. Pass the result
 * to `logger.error(msg, describeOAuthError(err))` instead of the raw error.
 */
export function describeOAuthError(error: unknown): { name: string; message: string; status?: number } {
  let current: unknown = error
  // Walk down to the most specific cause so an HTTP status is not hidden behind
  // an OAuthServiceError wrapper.
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const status = (current as { status?: unknown }).status
    if (typeof status === 'number') {
      return { name: current.name, message: current.message, status }
    }
    const cause = (current as { cause?: unknown }).cause
    if (!(cause instanceof Error)) break
    current = cause
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }
  return { name: 'UnknownError', message: String(error) }
}
