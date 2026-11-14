import { net } from 'electron'

import { providerService } from '@data/services/ProviderService'

import { OAuthServiceError } from '../../errors'
import { VertexAuthorizedUserCredentialsSchema, VertexGoogleOAuthTokenStore } from '../OAuthTokenStore'
import { PkceOAuthClient } from '../PkceOAuthClient'
import type { OAuthRuntimeProviderDefinition } from '../types'

// Google Desktop OAuth clients accept any loopback port and path, so nothing needs registering.
const VERTEX_GOOGLE_CONFIG = {
  AUTHORIZE_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  TOKEN_URL: 'https://oauth2.googleapis.com/token',
  REVOKE_URL: 'https://oauth2.googleapis.com/revoke',
  REDIRECT_URI: 'http://127.0.0.1:29875/vertex/oauth/callback',
  CALLBACK_HOST: '127.0.0.1',
  CALLBACK_PORT: 29875,
  CALLBACK_PATH: '/vertex/oauth/callback',
  SCOPE: 'openid email https://www.googleapis.com/auth/cloud-platform'
} as const

const REVOKE_HTTP_TIMEOUT_MS = 15_000

const tokenStore = new VertexGoogleOAuthTokenStore()

/** The `email` claim of an id_token received directly from Google's token endpoint (display only). */
function readEmailClaim(idToken: string | undefined): string | null {
  const payload = idToken?.split('.')[1]
  if (!payload) return null
  try {
    const { email } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { email?: unknown }
    return typeof email === 'string' && email.length > 0 ? email : null
  } catch {
    return null
  }
}

/**
 * "Sign in with Google" for a Vertex AI provider. The OAuth client is the
 * Desktop client the person's organisation registers, read from the provider's
 * saved `iam-gcp` credentials.
 */
export function createVertexGoogleOAuthProvider(providerId: string): OAuthRuntimeProviderDefinition {
  return {
    providerId,
    // Project, location and the OAuth client stay configured after logout.
    clearDisablesProvider: false,
    tokenStore,
    transport: {
      hosts: [VERTEX_GOOGLE_CONFIG.CALLBACK_HOST],
      port: VERTEX_GOOGLE_CONFIG.CALLBACK_PORT,
      path: VERTEX_GOOGLE_CONFIG.CALLBACK_PATH,
      redirectUri: VERTEX_GOOGLE_CONFIG.REDIRECT_URI
    },
    createClient: () => {
      const authConfig = providerService.getAuthConfig(providerId)
      const credentials =
        authConfig?.type === 'iam-gcp'
          ? VertexAuthorizedUserCredentialsSchema.safeParse(authConfig.credentials).data
          : undefined
      const clientId = credentials?.clientId.trim()
      const clientSecret = credentials?.clientSecret.trim()
      if (!clientId || !clientSecret) {
        throw new OAuthServiceError('Save a Google OAuth client ID and client secret in Vertex AI settings first')
      }
      return new PkceOAuthClient({
        clientId,
        clientSecret,
        authorizeUrl: VERTEX_GOOGLE_CONFIG.AUTHORIZE_URL,
        tokenUrl: VERTEX_GOOGLE_CONFIG.TOKEN_URL,
        redirectUri: VERTEX_GOOGLE_CONFIG.REDIRECT_URI,
        scope: VERTEX_GOOGLE_CONFIG.SCOPE,
        // Makes Google return a refresh token on every sign-in.
        extraAuthParams: { access_type: 'offline', prompt: 'consent' }
      })
    },
    extractAccountId: (_accessToken, tokenData) => readEmailClaim(tokenData.id_token),
    revokeToken: async (refreshToken) => {
      const response = await net.fetch(VERTEX_GOOGLE_CONFIG.REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }).toString(),
        signal: AbortSignal.timeout(REVOKE_HTTP_TIMEOUT_MS)
      })
      if (!response.ok) {
        throw new Error(`Google token revocation was rejected with HTTP ${response.status}`)
      }
    }
  }
}
