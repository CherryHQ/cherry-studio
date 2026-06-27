import type { PkceOAuthClient } from '@main/utils/oauth/PkceOAuthClient'

export interface OAuthAccount {
  /** Provider account id associated with the OAuth session, when available. */
  accountId: string | null
}

export interface OAuthTokenCredentials {
  accessToken: string
  accountId?: string | null
}

export interface OAuthTokenStoreData {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  accountId?: string
}

export interface OAuthTokenStore {
  get(providerId: string): Promise<OAuthTokenStoreData | null>
  set(providerId: string, data: OAuthTokenStoreData, clientId: string): Promise<void>
  clear(providerId: string): Promise<void>
}

export interface LoopbackCallbackConfig {
  /** Loopback hosts to bind, in priority order (e.g. ['127.0.0.1', '::1']). */
  hosts: readonly string[]
  port: number
  /** Callback path the provider redirects to (e.g. '/auth/callback'). */
  path: string
  /** Full redirect URI registered with the provider's OAuth client. */
  redirectUri: string
}

export interface DeepLinkCallbackConfig {
  redirectUri: string
}

export interface OAuthRuntimeProviderContext {
  oauthServer?: string
  apiHost?: string
}

export interface OAuthTokenExchangeSideEffectResult {
  apiKeys?: string
}

export interface OAuthRuntimeProviderDefinition {
  providerId: string
  clientId: string
  transport: { type: 'loopback'; config: LoopbackCallbackConfig } | { type: 'deep-link'; config: DeepLinkCallbackConfig }
  createClient(context?: OAuthRuntimeProviderContext): PkceOAuthClient | Promise<PkceOAuthClient>
  extractAccountId?(accessToken: string): string | null
  beforePersistTokens?(
    tokenData: { access_token: string; refresh_token?: string; expires_in?: number },
    context: OAuthRuntimeProviderContext
  ): Promise<OAuthTokenExchangeSideEffectResult | void>
}
