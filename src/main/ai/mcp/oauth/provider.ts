import { randomUUID } from 'crypto'
import { AsyncLocalStorage } from 'node:async_hooks'

import type {
  OAuthClientInformationContext,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens
} from '@modelcontextprotocol/client'
import { UnauthorizedError } from '@modelcontextprotocol/client'
import open from 'open'
import { sanitizeUrl } from 'strict-url-sanitise'

import { application } from '@application'
import { loggerService } from '@logger'

import { JsonFileStorage } from './storage'
import type { OAuthProviderOptions } from './types'

const logger = loggerService.withContext('Mcp:OAuthClientProvider')

export class McpOAuthClientProvider implements OAuthClientProvider {
  private storage: JsonFileStorage
  private readonly authorizationFlow = new AsyncLocalStorage<{ discovery?: OAuthDiscoveryState; callback: boolean }>()
  public readonly config: Required<OAuthProviderOptions>
  public prepareAuthorization?: () => Promise<void>
  public beginAuthorization?: () => Promise<void>

  constructor(options: OAuthProviderOptions) {
    const configDir = application.getPath('feature.mcp.oauth')
    this.config = {
      serverUrlHash: options.serverUrlHash,
      callbackPort: options.callbackPort || 12346,
      callbackPath: options.callbackPath || '/oauth/callback',
      configDir: options.configDir || configDir,
      clientName: options.clientName || 'Cherry Studio',
      clientUri: options.clientUri || 'https://github.com/CherryHQ/cherry-studio'
    }
    this.storage = new JsonFileStorage(this.config.serverUrlHash, this.config.configDir)
  }

  get redirectUrl(): string {
    return `http://127.0.0.1:${this.config.callbackPort}${this.config.callbackPath}`
  }

  get clientMetadata() {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: 'none' as const,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: this.config.clientName,
      client_uri: this.config.clientUri
    }
  }

  async state(): Promise<string> {
    await this.beginAuthorization?.()
    const discovery = this.authorizationFlow.getStore()?.discovery
    if (discovery) await this.storage.saveDiscoveryState(discovery)
    const state = randomUUID()
    await this.storage.saveState(state)
    return state
  }

  reloadCredentials(): void {
    this.storage = new JsonFileStorage(this.config.serverUrlHash, this.config.configDir)
  }

  withAuthorizationFlow<T>(callback: () => Promise<T>): Promise<T> {
    return this.authorizationFlow.run({ callback: false }, callback)
  }

  async withAuthorizationCallback<T>(callback: () => Promise<T>): Promise<T> {
    const discovery = this.authorizationFlow.getStore()?.discovery ?? (await this.storage.getDiscoveryState())
    return this.authorizationFlow.run({ discovery, callback: true }, callback)
  }

  async validateCallbackState(params: URLSearchParams): Promise<void> {
    const expected = await this.storage.getState()
    const actual = params.get('state')
    await this.storage.saveState(undefined)
    if (!expected || !actual || expected !== actual) {
      throw new Error('OAuth callback state mismatch')
    }
  }

  async clientInformation(ctx?: OAuthClientInformationContext): Promise<StoredOAuthClientInformation | undefined> {
    return this.storage.getClientInformation(ctx)
  }

  async saveClientInformation(info: StoredOAuthClientInformation, ctx?: OAuthClientInformationContext): Promise<void> {
    await this.storage.saveClientInformation(info, ctx)
  }

  async tokens(ctx?: OAuthClientInformationContext): Promise<StoredOAuthTokens | undefined> {
    return this.storage.getTokens(ctx)
  }

  async saveTokens(tokens: StoredOAuthTokens, ctx?: OAuthClientInformationContext): Promise<void> {
    await this.storage.saveTokens(tokens, ctx)
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Only an active authorized request can consume the callback and finish authorization.
    const prepareAuthorization = this.prepareAuthorization
    if (!prepareAuthorization) throw new UnauthorizedError()
    await prepareAuthorization()
    if (this.prepareAuthorization !== prepareAuthorization) throw new UnauthorizedError()
    try {
      await open(sanitizeUrl(authorizationUrl.toString()))
      logger.debug('Browser opened automatically.')
    } catch (error) {
      logger.error('Could not open browser automatically.')
      throw error
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.storage.saveCodeVerifier(codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    return this.storage.getCodeVerifier()
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    const flow = this.authorizationFlow.getStore()
    // Persist the redirect binding only after state() acquires the authorization lease.
    if (flow) flow.discovery = state
    else await this.storage.saveDiscoveryState(state)
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const flow = this.authorizationFlow.getStore()
    // New challenges must rediscover endpoints; callbacks stay bound to the redirect's issuer.
    return flow?.callback ? flow.discovery : undefined
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    logger.debug(`Invalidating credentials with scope: ${scope}`)
    await this.storage.clear(scope)
    if (scope === 'tokens' && !(await this.storage.getDiscoveryState())?.authorizationServerUrl) {
      await this.storage.clear('client')
    }
  }
}
