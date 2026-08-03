import { application } from '@application'
import { loggerService } from '@logger'
import type {
  OAuthClientInformationContext,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens
} from '@modelcontextprotocol/client'
import { randomUUID } from 'crypto'
import open from 'open'
import { sanitizeUrl } from 'strict-url-sanitise'

import { JsonFileStorage } from './storage'
import type { OAuthProviderOptions } from './types'

const logger = loggerService.withContext('Mcp:OAuthClientProvider')

export class McpOAuthClientProvider implements OAuthClientProvider {
  private storage: JsonFileStorage
  public readonly config: Required<OAuthProviderOptions>

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
    const state = randomUUID()
    await this.storage.saveState(state)
    return state
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
    await this.storage.saveDiscoveryState(state)
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return this.storage.getDiscoveryState()
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    logger.debug(`Invalidating credentials with scope: ${scope}`)
    await this.storage.clear(scope)
  }
}
