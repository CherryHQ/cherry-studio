import { shell } from 'electron'

import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { WindowId } from '@shared/ipc/types'

import { describeOAuthError, OAuthServiceError, OAuthSignInCancelledError, OAuthTransientError } from '../errors'
import { LoopbackCallbackTransport } from './LoopbackCallbackTransport'
import { ProviderAuthConfigOAuthTokenStore } from './OAuthTokenStore'
import { OAuthHttpError } from './PkceOAuthClient'
import { oauthProviderDefinitions } from './providerDefinitions'
import type {
  OAuthAccount,
  OAuthRuntimeProviderContext,
  OAuthRuntimeProviderDefinition,
  OAuthSignInResult,
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

type ActiveSignIn = {
  operation: {
    initiatorWindowId: WindowId
    controller: AbortController
    phase: 'discovery' | 'callback' | 'exchange' | 'persist'
    requestIdsByWindow: Map<WindowId, Set<string>>
    context?: OAuthRuntimeProviderContext
  }
  promise: Promise<OAuthSignInResult>
}

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
  private readonly refreshPromises = new Map<string, Promise<RefreshResult>>()
  private readonly activeSignIns = new Map<string, ActiveSignIn>()
  private stopping = false
  private teardownPromise: Promise<void> | null = null

  protected onInit(): void {
    this.stopping = false
    this.teardownPromise = null
  }

  protected onStop(): Promise<void> {
    return this.teardown()
  }

  protected onDestroy(): Promise<void> {
    return this.teardown()
  }

  private teardown(): Promise<void> {
    if (this.teardownPromise) return this.teardownPromise

    this.stopping = true
    const activePromises = [...this.activeSignIns.values()].map(({ operation, promise }) => {
      if (this.isSignInCancellable(operation.phase)) operation.controller.abort()
      return promise
    })

    for (const transport of this.transports.values()) {
      transport.close()
    }
    this.transports.clear()

    this.teardownPromise = Promise.allSettled(activePromises).then(() => {
      this.refreshPromises.clear()
    })
    return this.teardownPromise
  }

  private isSignInCancellable(phase: ActiveSignIn['operation']['phase']): boolean {
    return phase === 'discovery' || phase === 'callback'
  }

  private getDefinition(providerId: string): OAuthRuntimeProviderDefinition {
    const definition = this.definitions[providerId as keyof typeof this.definitions]
    if (!definition) {
      throw new OAuthServiceError(`No OAuth provider registered for provider: ${providerId}`)
    }
    return definition
  }

  private getLoopbackTransport(definition: OAuthRuntimeProviderDefinition): LoopbackCallbackTransport {
    let transport = this.transports.get(definition.providerId)
    if (!transport) {
      transport = new LoopbackCallbackTransport(definition.transport)
      this.transports.set(definition.providerId, transport)
    }
    return transport
  }

  private isExpired(expiresAt: number | undefined): boolean {
    return expiresAt !== undefined && Date.now() >= expiresAt - TOKEN_EXPIRY_BUFFER_MS
  }

  private async persistTokens(
    definition: OAuthRuntimeProviderDefinition,
    tokenData: { access_token: string; refresh_token?: string; expires_in?: number },
    options?: { expectedRefreshToken?: string }
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
      definition.clientId,
      options
    )
  }

  private runSignIn = async (
    definition: OAuthRuntimeProviderDefinition,
    transport: LoopbackCallbackTransport,
    operation: ActiveSignIn['operation']
  ): Promise<OAuthSignInResult> => {
    const context = operation.context ?? {}
    const signal = AbortSignal.any([operation.controller.signal, AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)])
    try {
      const client = await definition.createClient({ ...context, signal })
      if (operation.controller.signal.aborted) {
        throw new OAuthSignInCancelledError(definition.providerId)
      }
      const { authUrl, state, codeVerifier } = client.createAuthorizationRequest()

      operation.phase = 'callback'
      const codePromise = transport.waitForAuthorizationCode(state, signal)
      void codePromise.catch(() => undefined)
      await transport.ready
      if (signal.aborted) throw new OAuthSignInCancelledError(definition.providerId)
      await shell.openExternal(authUrl)
      const code = await codePromise

      operation.phase = 'exchange'
      const tokenData = await client.exchangeCode(code, codeVerifier)
      if (this.stopping) {
        throw new OAuthServiceError(`${definition.providerId} sign-in stopped before tokens were persisted`)
      }
      // Persist the freshly minted tokens before any side effect: the auth code
      // is now spent, so a failing post-persist hook must not discard a valid
      // token and force a full re-auth.
      operation.phase = 'persist'
      await this.persistTokens(definition, tokenData)
      const result = await definition.afterPersistTokens?.(tokenData, context)
      providerService.update(definition.providerId, { isEnabled: true })
      this.logger.info(`${definition.providerId} sign-in succeeded`)
      return {
        ...(await this.getAccount(definition.providerId)),
        ...(result?.apiKeys ? { apiKeys: result.apiKeys } : {})
      }
    } catch (error) {
      if (this.isSignInCancellable(operation.phase) && operation.controller.signal.aborted) {
        this.logger.info(`${definition.providerId} sign-in cancelled`)
        throw new OAuthSignInCancelledError(definition.providerId)
      }
      this.logger.error(`${definition.providerId} sign-in failed`, describeOAuthError(error))
      throw error instanceof OAuthServiceError
        ? error
        : new OAuthServiceError(`${definition.providerId} sign-in failed`, error)
    }
  }

  public signIn = (
    initiatorWindowId: WindowId | null,
    providerId: string,
    requestId: string,
    context: OAuthRuntimeProviderContext = {}
  ): Promise<OAuthSignInResult> => {
    if (!initiatorWindowId) {
      return Promise.reject(new OAuthServiceError('OAuth flow initiator is not a managed window'))
    }
    if (this.stopping) {
      return Promise.reject(new OAuthServiceError('OAuth runtime is stopping'))
    }

    const existing = this.activeSignIns.get(providerId)
    if (existing) {
      if (existing.operation.initiatorWindowId !== initiatorWindowId) {
        return Promise.reject(new OAuthServiceError('A sign-in from another window is already in progress'))
      }
      if (
        existing.operation.context?.oauthServer !== context.oauthServer ||
        existing.operation.context?.apiHost !== context.apiHost
      ) {
        return Promise.reject(new OAuthServiceError('A sign-in for another server is already in progress'))
      }
      existing.operation.requestIdsByWindow.get(initiatorWindowId)?.add(requestId)
      return existing.promise
    }

    try {
      const definition = this.getDefinition(providerId)
      const transport = this.getLoopbackTransport(definition)
      // Reserve synchronously before the first await — a check-then-await guard
      // lets a double-click start a second flow that kills the first.
      if (!transport.tryAcquire()) {
        throw new OAuthServiceError(`A ${providerId} sign-in is already in progress`)
      }

      const operation: ActiveSignIn['operation'] = {
        initiatorWindowId,
        controller: new AbortController(),
        phase: 'discovery',
        requestIdsByWindow: new Map([[initiatorWindowId, new Set([requestId])]]),
        context
      }
      const activeSignIn: ActiveSignIn = {
        operation,
        promise: this.runSignIn(definition, transport, operation).finally(() => {
          operation.controller.abort()
          if (this.activeSignIns.get(providerId) !== activeSignIn) return
          this.activeSignIns.delete(providerId)
          transport.close()
        })
      }
      this.activeSignIns.set(providerId, activeSignIn)
      return activeSignIn.promise
    } catch (error) {
      return Promise.reject(error)
    }
  }

  public joinActiveSignIn = async (
    senderId: WindowId | null,
    providerId: string,
    requestId: string
  ): Promise<{ status: 'not-found' } | { status: 'completed'; account: OAuthAccount }> => {
    if (!senderId) throw new OAuthServiceError('OAuth flow observer is not a managed window')
    this.getDefinition(providerId)
    const activeSignIn = this.activeSignIns.get(providerId)
    if (!activeSignIn) return { status: 'not-found' }
    const requestIds = activeSignIn.operation.requestIdsByWindow.get(senderId) ?? new Set<string>()
    requestIds.add(requestId)
    activeSignIn.operation.requestIdsByWindow.set(senderId, requestIds)
    const { accountId } = await activeSignIn.promise
    return { status: 'completed', account: { accountId } }
  }

  public cancelSignIn = async (senderId: WindowId | null, providerId: string, requestId: string): Promise<void> => {
    if (!senderId) throw new OAuthServiceError('OAuth flow caller is not a managed window')
    this.getDefinition(providerId)
    const activeSignIn = this.activeSignIns.get(providerId)
    if (
      !activeSignIn ||
      !activeSignIn.operation.requestIdsByWindow.get(senderId)?.has(requestId) ||
      !this.isSignInCancellable(activeSignIn.operation.phase)
    ) {
      return
    }

    activeSignIn.operation.controller.abort()
    try {
      await activeSignIn.promise
    } catch (error) {
      if (!(error instanceof OAuthSignInCancelledError)) throw error
    }
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
      // Pass the refresh token we started from so a re-login that replaced the
      // session mid-refresh is not cleared by this stale terminal result.
      await this.clearSession(definition, config.refreshToken)
      return null
    }
    if (result.status !== 'ok') {
      // Retriable: the session is intact. Signal a retry rather than returning
      // null, which authenticatedFetch would otherwise report as "not signed
      // in — sign in again", forcing an unnecessary browser OAuth round.
      throw new OAuthTransientError(`Temporary failure refreshing ${providerId} token, please retry`)
    }

    // Confirm our refreshed token actually landed. If the session was replaced
    // (logout → api-key, or a re-login with a different refresh token) while we
    // were refreshing, persistTokens skipped the write and the store now holds a
    // different session's token — which we must NOT hand to this in-flight
    // request (that would silently switch accounts). Fail closed; the caller
    // retries against the current session.
    const refreshed = await this.tokenStore.get(providerId)
    if (refreshed?.accessToken !== result.accessToken) return null
    return { accessToken: result.accessToken, accountId: refreshed?.accountId ?? null }
  }

  /**
   * Run a request authenticated with the provider's OAuth token, refreshing once
   * on a 401 (a server-revoked token can 401 before its local expiry). The
   * caller supplies `buildRequest` so the retry re-shapes headers/body with the
   * fresh token; this owns token fetch, the not-signed-in guard, and the retry —
   * keeping that logic in one place instead of per-provider fetch wrappers.
   *
   * `options.context` is threaded into token fetch/refresh (CherryIN needs its
   * `apiHost`); `options.onUnauthorized` runs when the request is still 401 after
   * the retry, for the caller's diagnostic logging.
   */
  public authenticatedFetch = async (
    providerId: string,
    buildRequest: (creds: OAuthTokenCredentials) => { input: RequestInfo | URL; init: RequestInit },
    doFetch: (input: RequestInfo | URL, init: RequestInit) => Promise<Response>,
    options: {
      context?: OAuthRuntimeProviderContext
      notSignedInMessage?: string
      onUnauthorized?: (response: Response) => void | Promise<void>
    } = {}
  ): Promise<Response> => {
    this.getDefinition(providerId)
    const { context, notSignedInMessage, onUnauthorized } = options
    const creds = await this.getValidAccessToken(providerId, context)
    if (!creds?.accessToken) {
      throw new OAuthServiceError(notSignedInMessage ?? `Not signed in to ${providerId}`)
    }

    const first = buildRequest(creds)
    let response = await doFetch(first.input, first.init)
    if (response.status === 401) {
      let refreshed: OAuthTokenCredentials | null
      try {
        refreshed = await this.getValidAccessToken(providerId, { ...context, forceRefresh: true })
      } catch (error) {
        // A transient refresh failure propagates as a retry signal — but drain
        // the discarded 401 body first, or the underlying (undici) connection
        // leaks just as it would on the retry path below.
        void response.body?.cancel?.()
        throw error
      }
      if (refreshed?.accessToken) {
        // Drain the discarded 401 body before retrying so the underlying (undici)
        // connection is released instead of leaking one per forced refresh.
        void response.body?.cancel?.()
        const retry = buildRequest(refreshed)
        response = await doFetch(retry.input, retry.init)
      }
    }

    if (response.status === 401) {
      await onUnauthorized?.(response)
    }
    return response
  }

  private clearSession(definition: OAuthRuntimeProviderDefinition, expectedRefreshToken?: string): Promise<void> {
    return this.tokenStore.clear(definition.providerId, {
      disableProvider: definition.clearDisablesProvider,
      ...(expectedRefreshToken !== undefined ? { expectedRefreshToken } : {})
    })
  }

  private refreshAccessToken(
    definition: OAuthRuntimeProviderDefinition,
    refreshToken: string,
    context: OAuthRuntimeProviderContext
  ): Promise<RefreshResult> {
    // Key by refresh token, not just providerId: a re-login mid-refresh installs
    // a new session with a different refresh token, and its requests must run
    // their OWN refresh — never reuse (and act on the terminal result of) the
    // superseded session's in-flight refresh, which would clear the new session.
    const key = `${definition.providerId}:${refreshToken}`
    let refreshPromise = this.refreshPromises.get(key)
    if (!refreshPromise) {
      refreshPromise = this.doRefresh(definition, refreshToken, context).finally(() => {
        this.refreshPromises.delete(key)
      })
      this.refreshPromises.set(key, refreshPromise)
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
      await this.persistTokens(definition, tokenData, { expectedRefreshToken: refreshToken })
      return { status: 'ok', accessToken: tokenData.access_token }
    } catch (error) {
      this.logger.error(`Failed to refresh ${definition.providerId} token`, describeOAuthError(error))
      return { status: isTerminalRefreshError(error) ? 'terminal' : 'retriable' }
    }
  }
}
