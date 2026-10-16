import crypto from 'crypto'

import { application } from '@application'

/** Timing-safe string comparison. */
export const isValidToken = (token: string, apiKey: string): boolean => {
  const tokenBuf = Buffer.from(token, 'utf8')
  const keyBuf = Buffer.from(apiKey, 'utf8')
  if (tokenBuf.length !== keyBuf.length) {
    return false
  }
  return crypto.timingSafeEqual(tokenBuf, keyBuf)
}

export type AuthFailure = { status: 401 | 403; error: string }

/** Which listener served the request: the user-facing gateway or the loopback one for Cherry consumers. */
export type GatewaySurface = 'public' | 'internal'

/**
 * Validate the credentials presented to the protected API routes. Three dialects
 * are accepted: the Anthropic `x-api-key` header (takes priority), the OpenAI
 * `Authorization: Bearer <token>` (extracted by the `@elysia/bearer` plugin in
 * `app.ts` and passed here as `bearerToken`), and the Gemini `x-goog-api-key`
 * header / `?key=` query param (passed here as `googleApiKey`). All are compared
 * timing-safely against `feature.api_gateway.api_key` on the public surface. The internal surface
 * accepts only an in-memory internal key from the request headers, the source admission reads.
 *
 * Returns an `AuthFailure` to short-circuit the request, or `undefined` to allow it.
 */
export const authorizeApiRequest = (
  xApiKey: string | undefined,
  bearerToken: string | undefined,
  googleApiKey?: string,
  requestHeaders: Headers = new Headers(),
  surface: GatewaySurface = 'public'
): AuthFailure | undefined => {
  const token = xApiKey?.trim() || bearerToken?.trim() || googleApiKey?.trim()

  if (!token) {
    return { status: 401, error: 'Unauthorized: missing credentials' }
  }

  if (surface === 'internal') {
    return application.get('ApiGatewayService').isInternalRequest(requestHeaders)
      ? undefined
      : { status: 403, error: 'Forbidden' }
  }
  const apiKey = application.get('PreferenceService').get('feature.api_gateway.api_key')
  return apiKey && isValidToken(token, apiKey) ? undefined : { status: 403, error: 'Forbidden' }
}

/** A scoped internal credential may only call its own path with its own model. */
export const authorizeCredentialScope = (
  request: Request,
  body: unknown,
  surface: GatewaySurface
): AuthFailure | undefined => {
  if (surface !== 'internal') return undefined
  const scope = application.get('ApiGatewayService').getCredentialScope(request.headers)
  if (!scope) return undefined
  const model = body && typeof body === 'object' && 'model' in body ? body.model : undefined
  const allowed = request.method === 'POST' && new URL(request.url).pathname === scope.path && model === scope.model
  return allowed ? undefined : { status: 403, error: 'Forbidden' }
}
