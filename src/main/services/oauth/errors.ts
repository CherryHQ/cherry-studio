import { getErrorMessage } from '@main/utils/error'

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
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- OAuth can reject arbitrary values; expose only verified names/messages/statuses and never raw token-response bodies.
export function describeOAuthError(error: unknown) {
  try {
    let current: unknown = error
    // Walk down to the most specific cause so an HTTP status is not hidden behind
    // an OAuthServiceError wrapper.
    for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
      const status = 'status' in current ? current.status : undefined
      if (typeof status === 'number' && Number.isFinite(status)) {
        return {
          name: typeof current.name === 'string' ? current.name : 'Error',
          message: getErrorMessage(current, 'OAuth request failed'),
          status
        }
      }
      const cause = current.cause
      if (!(cause instanceof Error)) break
      current = cause
    }
    if (error instanceof Error) {
      return {
        name: typeof error.name === 'string' ? error.name : 'Error',
        message: getErrorMessage(error, 'OAuth request failed')
      }
    }
    return { name: 'UnknownError', message: getErrorMessage(error, 'OAuth request failed') }
  } catch {
    return { name: 'UnknownError', message: 'OAuth request failed' }
  }
}
