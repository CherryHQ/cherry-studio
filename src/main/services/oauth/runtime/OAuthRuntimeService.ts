import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { OAuthHttpError } from '@main/utils/oauth/PkceOAuthClient'
import type { WindowId } from '@shared/ipc/types'
import { shell } from 'electron'

import { describeOAuthError, OAuthServiceError } from '../errors'
import { DeepLinkCallbackTransport } from './DeepLinkCallbackTransport'
import { LoopbackCallbackTransport } from './LoopbackCallbackTransport'
import { ProviderAuthConfigOAuthTokenStore } from './OAuthTokenStore'
import { oauthProviderDefinitions } from './providerDefinitions'
import type {
  OAuthAccount,
  OAuthRuntimeProviderContext,
  OAuthRuntimeProviderDefinition,
  OAuthTokenCredentials,
  OAuthTokenStore
} from './types'

const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000

/**
 * Outcome of a refresh attempt. `terminal` means the refresh token itself is
 * rejected (4xx) — the session is unrecoverable and must be cleared. `retriable`
 * means a transient failure (network, 5xx, rate-limit) — the stored token is
 * kept so the next request can try again instead of logging the user out.
 */
type RefreshResult = { status: 'ok'; accessToken: string } | { status: 'terminal' } | { status: 'retriable' }

/**
 * A 4xx from the token endpoint means the refresh token is dead — except the
 * transient ones: 429 (rate limit), 408 (request timeout) and 425 (too early)
 * are retriable, so they must NOT clear the session and log the user out.
 */
const TRANSIENT_4XX = new Set([408, 425, 429])
function isTerminalRefreshError(error: unknown): boolean {
  return (
    error instanceof OAuthHttpError && error.status >= 400 && error.status < 500 && !TRANSIENT_4XX.has(error.status)
  )
}

@Injectable('OAuthRuntimeService')
@ServicePhase(Phase.WhenReady)
export class OAuthRuntimeService extends BaseService {
  private readonly logger = loggerService.withContext('OAuthRuntimeService')
  private readonly tokenStore: OAuthTokenStore = new ProviderAuthConfigOAuthTokenStore()
  private readonly definitions = oauthProviderDefinitions
  private readonly transports = new Map<string, LoopbackCallbackTransport>()
  private readonly deepLinkTransports = new Map<string, DeepLinkCallbackTransport>()
  private readonly refreshPromises = new Map<string, Promise<RefreshResult>>()

  protected onStop(): void {
    this.closeTransports()
    this.refreshPromises.clear()
  }

  protected onDestroy(): void {
    this.closeTransports()
  }

  private closeTransports(): void {
    for (const transport of this.transports.values()) {
      transport.close()
    }
    this.transports.clear()
    for (const transport of this.deepLinkTransports.values()) {
      transport.close()
    }
    this.deepLinkTransports.clear()
  }

  private getDefinition(providerId: string): OAuthRuntimeProviderDefinition {
    const definition = this.definitions[providerId as keyof typeof this.definitions]
    if (!definition) {
      throw new OAuthServiceError(`No OAuth provider registered for provider: ${providerId}`)
    }
    return definition
  }

  private getLoopbackTransport(definition: OAuthRuntimeProviderDefinition): LoopbackCallbackTransport {
    if (definition.transport.type !== 'loopback') {
      throw new OAuthServiceError(`OAuth provider does not support loopback sign-in: ${definition.providerId}`)
    }

    let transport = this.transports.get(definition.providerId)
    if (!transport) {
      transport = new LoopbackCallbackTransport(definition.transport.config)
      this.transports.set(definition.providerId, transport)
    }
    return transport
  }

  private getDeepLinkTransport(definition: OAuthRuntimeProviderDefinition): DeepLinkCallbackTransport {
    if (definition.transport.type !== 'deep-link') {
      throw new OAuthServiceError(`OAuth provider does not support deep-link sign-in: ${definition.providerId}`)
    }

    let transport = this.deepLinkTransports.get(definition.providerId)
    if (!transport) {
      transport = new DeepLinkCallbackTransport(definition.transport.config)
      this.deepLinkTransports.set(definition.providerId, transport)
    }
    return transport
  }

  private isExpired(expiresAt: number | undefined): boolean {
    return expiresAt !== undefined && Date.now() >= expiresAt - TOKEN_EXPIRY_BUFFER_MS
  }

  private async persistTokens(
    definition: OAuthRuntimeProviderDefinition,
    tokenData: { access_token: string; refresh_token?: string; expires_in?: number }
  ): Promise<void> {
    const current = await this.tokenStore.get(definition.providerId)
    const accountId = definition.extractAccountId?.(tokenData.access_token) ?? current?.accountId
    await this.tokenStore.set(
      definition.providerId,
      {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? current?.refreshToken,
        expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
        ...(accountId ? { accountId } : {})
      },
      definition.clientId
    )
  }

  public signIn = async (providerId: string): Promise<OAuthAccount> => {
    const definition = this.getDefinition(providerId)
    const transport = this.getLoopbackTransport(definition)
    // Reserve synchronously before the first await — a check-then-await guard
    // lets a double-click start a second flow that kills the first (see
    // LoopbackCallbackTransport.tryAcquire).
    if (!transport.tryAcquire()) {
      throw new OAuthServiceError(`A ${providerId} sign-in is already in progress`)
    }

    const timeout = AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)
    try {
      const client = await definition.createClient()
      const { authUrl, state, codeVerifier } = client.createAuthorizationRequest()

      const codePromise = transport.waitForAuthorizationCode(state, timeout)
      await shell.openExternal(authUrl)
      const code = await codePromise

      const tokenData = await client.exchangeCode(code, codeVerifier)
      // Persist the freshly minted tokens before any side effect: the auth code
      // is now spent, so a failing post-persist hook must not discard a valid
      // token and force a full re-auth.
      await this.persistTokens(definition, tokenData)
      await definition.afterPersistTokens?.(tokenData, {})
      await providerService.update(providerId, { isEnabled: true })
      this.logger.info(`${providerId} sign-in succeeded`)
      return this.getAccount(providerId)
    } catch (error) {
      this.logger.error(`${providerId} sign-in failed`, describeOAuthError(error))
      throw error instanceof OAuthServiceError ? error : new OAuthServiceError(`${providerId} sign-in failed`, error)
    } finally {
      transport.close()
    }
  }

  public startDeepLinkFlow = async (
    initiatorWindowId: WindowId | null,
    providerId: string,
    context: OAuthRuntimeProviderContext = {}
  ): Promise<{ authUrl: string; state: string }> => {
    if (!initiatorWindowId) {
      throw new OAuthServiceError('OAuth flow initiator is not a managed window')
    }
    const definition = this.getDefinition(providerId)
    const transport = this.getDeepLinkTransport(definition)
    const client = await definition.createClient(context)
    const { authUrl, state, codeVerifier } = client.createAuthorizationRequest()
    return transport.registerAuthorizationRequest(authUrl, state, codeVerifier, initiatorWindowId, context)
  }

  public handleDeepLinkCallback = async (url: URL): Promise<void> => {
    for (const [providerId, transport] of this.deepLinkTransports.entries()) {
      const definition = this.getDefinition(providerId)
      if (definition.transport.type !== 'deep-link') continue

      const state = url.searchParams.get('state')
      const initiatorWindowId = state ? transport.getInitiatorWindowId(state) : null

      try {
        const callback = transport.consumeCallback(url)
        if (!callback) continue

        const client = await definition.createClient(callback.context)
        const tokenData = await client.exchangeCode(callback.code, callback.codeVerifier)
        // Persist before the side-effect fetch (CherryIN's API-key pull): the
        // auth code is spent, so a transient key-fetch failure must not throw
        // away a valid token and force the user through the whole flow again.
        await this.persistTokens(definition, tokenData)
        const sideEffectResult = await definition.afterPersistTokens?.(tokenData, callback.context)
        await providerService.update(providerId, { isEnabled: true })
        transport.sendConsumedResult(callback.state, callback.initiatorWindowId, { apiKeys: sideEffectResult?.apiKeys })
        this.logger.info(`${providerId} deep-link sign-in succeeded`)
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.error(`${providerId} deep-link callback failed`, describeOAuthError(error))
        if (state && initiatorWindowId) {
          transport.sendConsumedResult(state, initiatorWindowId, { error: message })
          return
        }
        throw error instanceof OAuthServiceError ? error : new OAuthServiceError(message, error)
      }
    }
  }

  public saveTokens = async (
    providerId: string,
    data: { accessToken: string; refreshToken?: string; expiresAt?: number; accountId?: string },
    clientId?: string
  ): Promise<void> => {
    const definition = this.getDefinition(providerId)
    const current = await this.tokenStore.get(providerId)
    await this.tokenStore.set(
      providerId,
      {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? current?.refreshToken,
        expiresAt: data.expiresAt,
        accountId: data.accountId ?? current?.accountId
      },
      clientId ?? definition.clientId
    )
  }

  public getAccount = async (providerId: string): Promise<OAuthAccount> => {
    this.getDefinition(providerId)
    const config = await this.tokenStore.get(providerId)
    return { accountId: config?.accountId ?? null }
  }

  public hasToken = async (providerId: string): Promise<boolean> => {
    const definition = this.getDefinition(providerId)
    const config = await this.tokenStore.get(providerId)
    if (!config?.accessToken) return false

    if (this.isExpired(config.expiresAt) && !config.refreshToken) {
      await this.clearSession(definition)
      return false
    }
    return true
  }

  public logout = async (providerId: string): Promise<void> => {
    const definition = this.getDefinition(providerId)
    await this.clearSession(definition)
    this.logger.info(`Cleared ${providerId} OAuth tokens`)
  }

  public getValidAccessToken = async (
    providerId: string,
    context: OAuthRuntimeProviderContext = {}
  ): Promise<OAuthTokenCredentials | null> => {
    const definition = this.getDefinition(providerId)
    const config = await this.tokenStore.get(providerId)
    if (!config?.accessToken) return null

    if (!context.forceRefresh && !this.isExpired(config.expiresAt)) {
      return { accessToken: config.accessToken, accountId: config.accountId ?? null }
    }

    if (!config.refreshToken) {
      await this.clearSession(definition)
      return null
    }

    const result = await this.refreshAccessToken(definition, config.refreshToken, context)
    // Only clear on a terminal failure (refresh token rejected). A transient
    // failure keeps the stored token so the next request retries instead of
    // logging the user out over a flaky network or a 5xx.
    if (result.status === 'terminal') {
      await this.clearSession(definition)
      return null
    }
    if (result.status !== 'ok') {
      return null
    }

    const refreshed = await this.tokenStore.get(providerId)
    return { accessToken: result.accessToken, accountId: refreshed?.accountId ?? null }
  }

  /**
   * Run a request authenticated with the provider's OAuth token, refreshing once
   * on a 401 (a server-revoked token can 401 before its local expiry). The
   * caller supplies `buildRequest` so the retry re-shapes headers/body with the
   * fresh token; this owns token fetch, the not-signed-in guard, and the retry —
   * keeping that logic in one place instead of per-provider fetch wrappers.
   */
  public authenticatedFetch = async (
    providerId: string,
    buildRequest: (creds: OAuthTokenCredentials) => { input: RequestInfo | URL; init: RequestInit },
    doFetch: (input: RequestInfo | URL, init: RequestInit) => Promise<Response>,
    notSignedInMessage?: string
  ): Promise<Response> => {
    this.getDefinition(providerId)
    const creds = await this.getValidAccessToken(providerId)
    if (!creds?.accessToken) {
      throw new OAuthServiceError(notSignedInMessage ?? `Not signed in to ${providerId}`)
    }

    const first = buildRequest(creds)
    const response = await doFetch(first.input, first.init)
    if (response.status !== 401) return response

    // Drain the discarded 401 body before retrying so the underlying (undici)
    // connection is released instead of leaking one per forced refresh.
    void response.body?.cancel?.()

    const refreshed = await this.getValidAccessToken(providerId, { forceRefresh: true })
    if (!refreshed?.accessToken) return response
    const retry = buildRequest(refreshed)
    return doFetch(retry.input, retry.init)
  }

  private clearSession(definition: OAuthRuntimeProviderDefinition): Promise<void> {
    return this.tokenStore.clear(definition.providerId, { disableProvider: definition.clearDisablesProvider })
  }

  private refreshAccessToken(
    definition: OAuthRuntimeProviderDefinition,
    refreshToken: string,
    context: OAuthRuntimeProviderContext
  ): Promise<RefreshResult> {
    const providerId = definition.providerId
    let refreshPromise = this.refreshPromises.get(providerId)
    if (!refreshPromise) {
      refreshPromise = this.doRefresh(definition, refreshToken, context).finally(() => {
        this.refreshPromises.delete(providerId)
      })
      this.refreshPromises.set(providerId, refreshPromise)
    }
    return refreshPromise
  }

  private async doRefresh(
    definition: OAuthRuntimeProviderDefinition,
    refreshToken: string,
    context: OAuthRuntimeProviderContext
  ): Promise<RefreshResult> {
    try {
      const client = await definition.createClient(context)
      const tokenData = await client.refresh(refreshToken)
      await this.persistTokens(definition, tokenData)
      return { status: 'ok', accessToken: tokenData.access_token }
    } catch (error) {
      this.logger.error(`Failed to refresh ${definition.providerId} token`, describeOAuthError(error))
      return { status: isTerminalRefreshError(error) ? 'terminal' : 'retriable' }
    }
  }
}
