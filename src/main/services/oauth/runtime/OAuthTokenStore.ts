import * as z from 'zod'

import { providerService } from '@data/services/ProviderService'
import type { OAuthAuthConfig } from '@shared/data/types/provider'
import { VERTEX_AUTHORIZED_USER_TYPE } from '@shared/utils/vertexGoogleCredentials'

import { OAuthServiceError } from '../errors'
import type { OAuthTokenStore, OAuthTokenStoreData } from './types'

export class ProviderAuthConfigOAuthTokenStore implements OAuthTokenStore {
  async get(providerId: string): Promise<OAuthTokenStoreData | null> {
    const authConfig = providerService.getAuthConfig(providerId)
    if (authConfig?.type !== 'oauth') return null

    return {
      accessToken: authConfig.accessToken,
      refreshToken: authConfig.refreshToken,
      expiresAt: authConfig.expiresAt,
      accountId: authConfig.accountId
    }
  }

  async set(
    providerId: string,
    data: OAuthTokenStoreData,
    clientId: string,
    options?: { expectedRefreshToken?: string }
  ): Promise<void> {
    const current = providerService.getAuthConfig(providerId)
    const currentOAuth = current?.type === 'oauth' ? current : null
    // Refresh path: commit only if the stored session is the same one we
    // refreshed from — still OAuth and still holding that refresh token. This
    // rejects both a logout (→ api-key, no match) and a re-login (a different
    // session's refresh token) that landed during the network round-trip. The
    // read above and the write below share one synchronous tick (no `await`
    // between them), so a concurrent logout/login macrotask cannot interleave;
    // the check is atomic against it.
    if (
      options?.expectedRefreshToken !== undefined &&
      (!currentOAuth || currentOAuth.refreshToken !== options.expectedRefreshToken)
    ) {
      return
    }
    const authConfig: OAuthAuthConfig = {
      type: 'oauth',
      clientId: clientId || currentOAuth?.clientId || '',
      ...(data.accessToken ? { accessToken: data.accessToken } : {}),
      ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}),
      ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
      ...(data.accountId ? { accountId: data.accountId } : {})
    }

    providerService.update(providerId, { authConfig })
  }

  async clear(
    providerId: string,
    options?: { disableProvider?: boolean; expectedRefreshToken?: string }
  ): Promise<void> {
    // Conditional clear (terminal refresh failure): skip if this is no longer
    // the session that failed — a re-login during the failed refresh must
    // survive. Same synchronous read-then-write atomicity as `set`.
    if (options?.expectedRefreshToken !== undefined) {
      const current = providerService.getAuthConfig(providerId)
      if (current?.type !== 'oauth' || current.refreshToken !== options.expectedRefreshToken) return
    }
    // Reset auth back to api-key mode (drops the OAuth tokens). Only flip
    // `isEnabled` when the caller owns the provider's enablement — see the
    // interface doc: disabling a provider that also holds a manual API key would
    // silently kill that key too.
    providerService.update(providerId, {
      authConfig: { type: 'api-key' },
      ...(options?.disableProvider ? { isEnabled: false } : {})
    })
  }
}

/**
 * Vertex AI "Sign in with Google" credentials stored in the `iam-gcp` authConfig.
 * The OAuth client comes from the person's organisation; the session fields are
 * written only by this runtime and never reach the renderer.
 */
export const VertexAuthorizedUserCredentialsSchema = z.object({
  type: z.literal(VERTEX_AUTHORIZED_USER_TYPE),
  clientId: z.string(),
  clientSecret: z.string(),
  refreshToken: z.string().optional(),
  accessToken: z.string().optional(),
  expiresAt: z.number().optional(),
  /** Signed-in Google account email, for display only. */
  account: z.string().optional()
})

function readVertexGoogleSession(providerId: string) {
  const authConfig = providerService.getAuthConfig(providerId)
  if (authConfig?.type !== 'iam-gcp') return null
  const credentials = VertexAuthorizedUserCredentialsSchema.safeParse(authConfig.credentials).data
  return credentials ? { authConfig, credentials } : null
}

/**
 * Vertex AI "Sign in with Google" session, kept inside the provider's `iam-gcp`
 * authConfig so project, location and the OAuth client survive sign-in and
 * logout. Never changes `isEnabled`: the provider stays configured either way.
 */
export class VertexGoogleOAuthTokenStore implements OAuthTokenStore {
  async get(providerId: string): Promise<OAuthTokenStoreData | null> {
    const credentials = readVertexGoogleSession(providerId)?.credentials
    if (!credentials?.accessToken && !credentials?.refreshToken) return null
    return {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt: credentials.expiresAt,
      accountId: credentials.account
    }
  }

  async set(
    providerId: string,
    data: OAuthTokenStoreData,
    clientId: string,
    options?: { expectedRefreshToken?: string }
  ): Promise<void> {
    // Same synchronous read-then-write atomicity as ProviderAuthConfigOAuthTokenStore.
    const current = readVertexGoogleSession(providerId)
    if (
      options?.expectedRefreshToken !== undefined &&
      current?.credentials.refreshToken !== options.expectedRefreshToken
    ) {
      return
    }
    if (!current) {
      throw new OAuthServiceError(`Provider ${providerId} has no Google OAuth client configured`)
    }
    // Google binds a refresh token to the client that minted it; under another client it could never refresh.
    if (current.credentials.clientId.trim() !== clientId) {
      throw new OAuthServiceError('The Google OAuth client changed during sign-in. Sign in with Google again.')
    }
    const { authConfig, credentials } = current
    providerService.setAuthConfig(providerId, {
      ...authConfig,
      credentials: {
        type: VERTEX_AUTHORIZED_USER_TYPE,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        ...(data.accessToken ? { accessToken: data.accessToken } : {}),
        ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}),
        ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
        ...(data.accountId ? { account: data.accountId } : {})
      }
    })
  }

  /** `disableProvider` is ignored: project, location and the OAuth client remain usable. */
  async clear(
    providerId: string,
    options?: { disableProvider?: boolean; expectedRefreshToken?: string }
  ): Promise<void> {
    const current = readVertexGoogleSession(providerId)
    if (!current) return
    if (
      options?.expectedRefreshToken !== undefined &&
      current.credentials.refreshToken !== options.expectedRefreshToken
    ) {
      return
    }
    const { authConfig, credentials } = current
    providerService.setAuthConfig(providerId, {
      ...authConfig,
      credentials: {
        type: VERTEX_AUTHORIZED_USER_TYPE,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret
      }
    })
  }
}
