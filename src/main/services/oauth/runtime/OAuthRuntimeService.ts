import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { shell } from 'electron'

import { OAuthServiceError } from '../errors'
import { LoopbackCallbackTransport } from './LoopbackCallbackTransport'
import { ProviderAuthConfigOAuthTokenStore } from './OAuthTokenStore'
import { oauthProviderDefinitions } from './providerDefinitions'
import type { OAuthAccount, OAuthRuntimeProviderDefinition, OAuthTokenCredentials, OAuthTokenStore } from './types'

const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000

@Injectable('OAuthRuntimeService')
@ServicePhase(Phase.Background)
export class OAuthRuntimeService extends BaseService {
  private readonly logger = loggerService.withContext('OAuthRuntimeService')
  private readonly tokenStore: OAuthTokenStore = new ProviderAuthConfigOAuthTokenStore()
  private readonly definitions = oauthProviderDefinitions
  private readonly transports = new Map<string, LoopbackCallbackTransport>()
  private readonly refreshPromises = new Map<string, Promise<string | null>>()

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
    if (transport.isActive) {
      throw new OAuthServiceError(`A ${providerId} sign-in is already in progress`)
    }

    const timeout = AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)
    try {
      const client = await definition.createClient()
      const { authUrl, state, codeVerifier } = client.createAuthorizationRequest()

      const codePromise = transport.waitForAuthorizationCode(state, timeout)
      await shell.openExternal(authUrl)
      const code = await codePromise

      await this.persistTokens(definition, await client.exchangeCode(code, codeVerifier))
      await providerService.update(providerId, { isEnabled: true })
      this.logger.info(`${providerId} sign-in succeeded`)
      return this.getAccount(providerId)
    } catch (error) {
      this.logger.error(`${providerId} sign-in failed`, error as Error)
      throw error instanceof OAuthServiceError ? error : new OAuthServiceError(`${providerId} sign-in failed`, error)
    } finally {
      transport.close()
    }
  }

  public getAccount = async (providerId: string): Promise<OAuthAccount> => {
    this.getDefinition(providerId)
    const config = await this.tokenStore.get(providerId)
    return { accountId: config?.accountId ?? null }
  }

  public hasToken = async (providerId: string): Promise<boolean> => {
    this.getDefinition(providerId)
    const config = await this.tokenStore.get(providerId)
    if (!config?.accessToken) return false

    if (this.isExpired(config.expiresAt) && !config.refreshToken) {
      await this.tokenStore.clear(providerId)
      return false
    }
    return true
  }

  public logout = async (providerId: string): Promise<void> => {
    this.getDefinition(providerId)
    await this.tokenStore.clear(providerId)
    this.logger.info(`Cleared ${providerId} OAuth tokens`)
  }

  public getValidAccessToken = async (providerId: string): Promise<OAuthTokenCredentials | null> => {
    const definition = this.getDefinition(providerId)
    const config = await this.tokenStore.get(providerId)
    if (!config?.accessToken) return null

    if (!this.isExpired(config.expiresAt)) {
      return { accessToken: config.accessToken, accountId: config.accountId ?? null }
    }

    if (!config.refreshToken) {
      await this.tokenStore.clear(providerId)
      return null
    }

    const accessToken = await this.refreshAccessToken(definition, config.refreshToken)
    if (!accessToken) return null

    const refreshed = await this.tokenStore.get(providerId)
    return { accessToken, accountId: refreshed?.accountId ?? null }
  }

  private refreshAccessToken(definition: OAuthRuntimeProviderDefinition, refreshToken: string): Promise<string | null> {
    const providerId = definition.providerId
    let refreshPromise = this.refreshPromises.get(providerId)
    if (!refreshPromise) {
      refreshPromise = this.doRefresh(definition, refreshToken).finally(() => {
        this.refreshPromises.delete(providerId)
      })
      this.refreshPromises.set(providerId, refreshPromise)
    }
    return refreshPromise
  }

  private async doRefresh(definition: OAuthRuntimeProviderDefinition, refreshToken: string): Promise<string | null> {
    try {
      const client = await definition.createClient()
      const tokenData = await client.refresh(refreshToken)
      await this.persistTokens(definition, tokenData)
      return tokenData.access_token
    } catch (error) {
      this.logger.error(`Failed to refresh ${definition.providerId} token`, error as Error)
      return null
    }
  }
}
