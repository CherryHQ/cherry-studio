import { application } from '@application'
import crypto from 'crypto'

const isValidToken = (token: string, apiKey: string): boolean => {
  const tokenBuf = Buffer.from(token, 'utf8')
  const keyBuf = Buffer.from(apiKey, 'utf8')
  if (tokenBuf.length !== keyBuf.length) {
    return false
  }
  return crypto.timingSafeEqual(tokenBuf, keyBuf)
}

export type AuthFailure = { status: 401 | 403; error: string }

/**
 * Validate the credentials presented to the protected API routes. Three dialects
 * are accepted: the Anthropic `x-api-key` header (takes priority), the OpenAI
 * `Authorization: Bearer <token>` (extracted by the `@elysia/bearer` plugin in
 * `app.ts` and passed here as `bearerToken`), and the Gemini `x-goog-api-key`
 * header / `?key=` query param (passed here as `googleApiKey`). All are compared
 * against `feature.api_gateway.api_key` with a timing-safe comparison.
 *
 * Returns an `AuthFailure` to short-circuit the request, or `undefined` to allow it.
 */
export const authorizeApiRequest = (
  xApiKey: string | undefined,
  bearerToken: string | undefined,
  googleApiKey?: string
): AuthFailure | undefined => {
  const token = xApiKey?.trim() || bearerToken?.trim() || googleApiKey?.trim()

  if (!token) {
    return { status: 401, error: 'Unauthorized: missing credentials' }
  }

  const apiKey = application.get('PreferenceService').get('feature.api_gateway.api_key')
  if (!apiKey) {
    return { status: 403, error: 'Forbidden' }
  }

  if (isValidToken(token, apiKey)) {
    return undefined
  }

  return { status: 403, error: 'Forbidden' }
}
