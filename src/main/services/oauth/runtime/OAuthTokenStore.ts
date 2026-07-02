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
    options?: { requireExistingSession?: boolean }
  ): Promise<void> {
    const current = providerService.getAuthConfig(providerId)
    const currentOAuth = current?.type === 'oauth' ? current : null
    // Refresh path: bail if the session is no longer OAuth. The read above and
    // the write below share one synchronous tick (no `await` between them), so
    // a concurrent logout — which arrives as a separate macrotask — cannot
    // interleave here; this check is atomic against it and stops a refresh that
    // resolved after logout from writing the stale token back.
    if (options?.requireExistingSession && !currentOAuth) return
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

  async clear(providerId: string, options?: { disableProvider?: boolean }): Promise<void> {
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
