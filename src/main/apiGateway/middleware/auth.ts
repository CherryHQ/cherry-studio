import { application } from '@application'
import crypto from 'crypto'

const isValidToken = (token: string, apiKey: string): boolean => {
  if (token.length !== apiKey.length) {
    return false
  }
  const tokenBuf = Buffer.from(token)
  const keyBuf = Buffer.from(apiKey)
  return crypto.timingSafeEqual(tokenBuf, keyBuf)
}

/** Minimal slice of the Elysia context the auth guard needs. */
interface AuthContext {
  headers: Record<string, string | undefined>
  set: { status?: number | string }
}

/**
 * Authentication guard ported from the Express `authMiddleware`. Applied as an
 * `onBeforeHandle` hook to protected route groups only. Returning a value
 * short-circuits the request with that body; returning `undefined` lets the
 * request through.
 */
export const authGuard = async ({ headers, set }: AuthContext): Promise<{ error: string } | undefined> => {
  const auth = headers['authorization'] || ''
  const xApiKey = headers['x-api-key'] || ''

  // Fast rejection if neither credential header provided
  if (!auth && !xApiKey) {
    set.status = 401
    return { error: 'Unauthorized: missing credentials' }
  }

  const apiKey = application.get('PreferenceService').get('feature.csaas.api_key')

  if (!apiKey) {
    set.status = 403
    return { error: 'Forbidden' }
  }

  // Check API key first (priority)
  if (xApiKey) {
    const trimmedApiKey = xApiKey.trim()
    if (!trimmedApiKey) {
      set.status = 401
      return { error: 'Unauthorized: empty x-api-key' }
    }

    if (isValidToken(trimmedApiKey, apiKey)) {
      return undefined
    } else {
      set.status = 403
      return { error: 'Forbidden' }
    }
  }

  // Fallback to Bearer token
  if (auth) {
    const trimmed = auth.trim()
    const bearerPrefix = /^Bearer\s+/i

    if (!bearerPrefix.test(trimmed)) {
      set.status = 401
      return { error: 'Unauthorized: invalid authorization format' }
    }

    const token = trimmed.replace(bearerPrefix, '').trim()
    if (!token) {
      set.status = 401
      return { error: 'Unauthorized: empty bearer token' }
    }

    if (isValidToken(token, apiKey)) {
      return undefined
    } else {
      set.status = 403
      return { error: 'Forbidden' }
    }
  }

  set.status = 401
  return { error: 'Unauthorized: invalid credentials format' }
}
