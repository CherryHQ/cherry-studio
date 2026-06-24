import { createHash, randomBytes } from 'node:crypto'

import { net } from 'electron'
import * as z from 'zod'

// Token endpoint response. Superset of what every provider returns — extra
// fields each provider cares about (id_token, expires_in) are optional so the
// same schema validates Codex, CherryIN, and future providers alike.
export const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().optional()
})
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>

export interface PkceOAuthClientConfig {
  clientId: string
  /** Full authorization endpoint URL (e.g. https://auth.openai.com/oauth/authorize). */
  authorizeUrl: string
  /** Full token endpoint URL (used for both code exchange and refresh). */
  tokenUrl: string
  redirectUri: string
  scope: string
  /** Provider-specific flags appended to the authorization URL query. */
  extraAuthParams?: Record<string, string>
}

export interface AuthorizationRequest {
  authUrl: string
  state: string
  codeVerifier: string
}

/**
 * Thrown when the token endpoint returns a non-2xx response. Carries the raw
 * status and body so callers can redact/log them however they need.
 */
export class OAuthHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message)
    this.name = 'OAuthHttpError'
  }
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Authorization-Code + PKCE OAuth client. Owns PKCE generation, authorize-URL
 * construction, and the token endpoint (code exchange + refresh).
 *
 * Deliberately transport-agnostic: how the authorization `code` travels back
 * from the browser — a custom-protocol deep link, a loopback HTTP server, … —
 * is the caller's concern. The client only turns a `code` into tokens. Token
 * persistence and any post-auth side effects (account extraction, key fetch,
 * enabling the provider) also stay with the caller.
 */
export class PkceOAuthClient {
  constructor(private readonly config: PkceOAuthClientConfig) {}

  /**
   * Build a fresh authorization request: PKCE verifier/challenge, a CSRF `state`,
   * and the full authorize URL to open in the browser. The caller must retain
   * `codeVerifier` (keyed by `state`) until the callback delivers the `code`.
   */
  createAuthorizationRequest(): AuthorizationRequest {
    // 32 random bytes → 43-char base64url verifier (within RFC 7636's 43-128).
    const codeVerifier = base64UrlEncode(randomBytes(32))
    const codeChallenge = base64UrlEncode(createHash('sha256').update(codeVerifier).digest())
    const state = randomBytes(16).toString('hex')

    const url = new URL(this.config.authorizeUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('redirect_uri', this.config.redirectUri)
    url.searchParams.set('scope', this.config.scope)
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', state)
    for (const [key, value] of Object.entries(this.config.extraAuthParams ?? {})) {
      url.searchParams.set(key, value)
    }

    return { authUrl: url.toString(), state, codeVerifier }
  }

  /** Exchange an authorization `code` (+ its PKCE verifier) for tokens. */
  exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokenResponse> {
    return this.postToken(
      {
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        code,
        code_verifier: codeVerifier,
        redirect_uri: this.config.redirectUri
      },
      'Failed to exchange code for token'
    )
  }

  /** Exchange a refresh token for a fresh access token. */
  refresh(refreshToken: string): Promise<OAuthTokenResponse> {
    return this.postToken(
      {
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        refresh_token: refreshToken
      },
      'Failed to refresh access token'
    )
  }

  private async postToken(params: Record<string, string>, errorPrefix: string): Promise<OAuthTokenResponse> {
    const response = await net.fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString()
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new OAuthHttpError(`${errorPrefix}: ${response.status}`, response.status, body)
    }

    return OAuthTokenResponseSchema.parse(await response.json())
  }
}
