import { providerService } from '@data/services/ProviderService'
import type { OAuthAuthConfig } from '@shared/data/types/provider'

import type { OAuthTokenStore, OAuthTokenStoreData } from './types'

export class ProviderAuthConfigOAuthTokenStore implements OAuthTokenStore {
  async get(providerId: string): Promise<OAuthTokenStoreData | null> {
    const authConfig = await providerService.getAuthConfig(providerId)
    if (authConfig?.type !== 'oauth') return null

    return {
      accessToken: authConfig.accessToken,
      refreshToken: authConfig.refreshToken,
      expiresAt: authConfig.expiresAt,
      accountId: authConfig.accountId
    }
  }

  async set(providerId: string, data: OAuthTokenStoreData, clientId: string): Promise<void> {
    const current = await providerService.getAuthConfig(providerId)
    const currentOAuth = current?.type === 'oauth' ? current : null
    const authConfig: OAuthAuthConfig = {
      type: 'oauth',
      clientId: clientId || currentOAuth?.clientId || '',
      ...(data.accessToken ? { accessToken: data.accessToken } : {}),
      ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}),
      ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
      ...(data.accountId ? { accountId: data.accountId } : {})
    }

    await providerService.update(providerId, { authConfig })
  }

  async clear(providerId: string): Promise<void> {
    await providerService.update(providerId, { authConfig: { type: 'api-key' }, isEnabled: false })
  }
}
