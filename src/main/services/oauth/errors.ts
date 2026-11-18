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

export class OAuthSignInCancelledError extends OAuthServiceError {
  constructor(providerId: string) {
    super(`${providerId} sign-in was cancelled`)
    this.name = 'OAuthSignInCancelledError'
  }
}

/**
 * A token refresh failed transiently (network, 5xx, 408/425/429) — the stored
 * session is still valid and the caller should retry, not re-authenticate.
 * Kept distinct from a plain null / `OAuthServiceError` so the chat path can
 * surface "please retry" instead of sending the user through a full browser
 * OAuth round for what is really a momentary blip.
 */
export class OAuthTransientError extends OAuthServiceError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'OAuthTransientError'
  }
}

/**
 * Reduce an OAuth error (and its `cause` chain) to a log-safe shape: name,
 * message, and an HTTP `status` when present. Deliberately drops any raw token
 * endpoint response body — `OAuthHttpError.body` can carry provider error
 * payloads, and the logger serializes errors to disk verbatim. Pass the result
 * to `logger.error(msg, describeOAuthError(err))` instead of the raw error.
 */
export function describeOAuthError(cause: unknown): { name: string; message: string; status?: number } {
  let current: unknown = cause
  // Walk down to the most specific cause so an HTTP status is not hidden behind
  // an OAuthServiceError wrapper.
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const status = (current as { status?: unknown }).status
    if (typeof status === 'number') {
      return { name: current.name, message: current.message, status }
    }
    const nestedCause = (current as { cause?: unknown }).cause
    if (!(nestedCause instanceof Error)) break
    current = nestedCause
  }
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message }
  }
  return { name: 'UnknownError', message: String(cause) }
}
