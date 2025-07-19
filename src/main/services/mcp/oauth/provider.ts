import path from 'node:path'

import { loggerService } from '@logger'
import { getConfigDir } from '@main/utils/file'
import { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth'
import { OAuthClientInformation, OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth'
import open from 'open'
import { sanitizeUrl } from 'strict-url-sanitise'

import { JsonFileStorage } from './storage'
import { OAuthProviderOptions } from './types'

const logger = loggerService.withContext('MCP:OAuthClientProvider')

export class McpOAuthClientProvider implements OAuthClientProvider {
  private storage: JsonFileStorage
  public readonly config: Required<OAuthProviderOptions>

  constructor(options: OAuthProviderOptions) {
    const configDir = path.join(getConfigDir(), 'mcp', 'oauth')
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
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: this.config.clientName,
      client_uri: this.config.clientUri
    }
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return this.storage.getClientInformation()
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await this.storage.saveClientInformation(info)
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return this.storage.getTokens()
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.storage.saveTokens(tokens)
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    try {
      // Open the browser to the authorization URL
      await open(sanitizeUrl(authorizationUrl.toString()))
      logger.debug('Browser opened automatically.')
    } catch (error) {
      logger.error('Could not open browser automatically.')
      throw error // Let caller handle the error
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.storage.saveCodeVerifier(codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    return this.storage.getCodeVerifier()
  }
}
