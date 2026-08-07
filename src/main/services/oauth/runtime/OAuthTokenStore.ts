import { providerService } from '@data/services/ProviderService'
import type { OAuthAuthConfig } from '@shared/data/types/provider'

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
