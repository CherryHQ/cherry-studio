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
  /**
   * Drop the stored OAuth tokens. `disableProvider` also flips the provider to
   * disabled — correct for providers whose only credential is the OAuth session
   * (Codex, Grok), but wrong for one that can also hold a manual API key
   * (CherryIN), where disabling would take the manual key down with it.
   */
  clear(providerId: string, options?: { disableProvider?: boolean }): Promise<void>
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
  forceRefresh?: boolean
}

export interface OAuthTokenExchangeSideEffectResult {
  apiKeys?: string
}

export interface OAuthRuntimeProviderDefinition {
  providerId: string
  clientId: string
  /**
   * Whether clearing the OAuth session (logout / unrecoverable token loss) also
   * disables the provider. `true` for OAuth-only providers (Codex, Grok) where
   * no credential remains; `false`/omitted for providers that can fall back to a
   * manual API key (CherryIN), so logout never strips that key's enablement.
   */
  clearDisablesProvider?: boolean
  transport:
    | { type: 'loopback'; config: LoopbackCallbackConfig }
    | { type: 'deep-link'; config: DeepLinkCallbackConfig }
  createClient(context?: OAuthRuntimeProviderContext): PkceOAuthClient | Promise<PkceOAuthClient>
  extractAccountId?(accessToken: string): string | null
  /**
   * Post-exchange side effect, run *after* the tokens are persisted so a failure
   * here never discards a valid token (CherryIN fetches the user's API keys).
   * Its result is forwarded to the deep-link initiator window.
   */
  afterPersistTokens?(
    tokenData: { access_token: string; refresh_token?: string; expires_in?: number },
    context: OAuthRuntimeProviderContext
  ): Promise<OAuthTokenExchangeSideEffectResult | void>
}
