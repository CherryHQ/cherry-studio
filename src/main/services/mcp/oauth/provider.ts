import path from 'node:path'

import { loggerService } from '@logger'
import { getConfigDir } from '@main/utils/file'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth'
import type {
  OAuthClientInformation,
  OAuthClientInformationMixed,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth'
import open from 'open'
import { sanitizeUrl } from 'strict-url-sanitise'

import { JsonFileStorage } from './storage'
import type { OAuthProviderOptions } from './types'

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

  async saveClientInformation(info: OAuthClientInformationMixed | undefined): Promise<void> {
    await this.storage.saveClientInformation(info)
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return this.storage.getTokens()
  }

  async saveTokens(tokens: OAuthTokens | undefined): Promise<void> {
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

  /**
   * Invalidates stored credentials when the SDK detects they are no longer valid.
   * This method is called by the MCP SDK when it encounters authentication errors
   * like InvalidGrantError (expired refresh token) or InvalidClientError.
   *
   * @param scope - The scope of credentials to invalidate:
   *   - 'all': Clear all authentication data (client info, tokens, verifier)
   *   - 'tokens': Clear only access and refresh tokens
   *   - 'client': Clear only client registration information
   *   - 'verifier': Clear only the PKCE code verifier
   */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void> {
    logger.debug(`Invalidating credentials with scope: ${scope}`)

    switch (scope) {
      case 'all':
        // Clear all authentication information
        await this.storage.clear()
        logger.info('Cleared all OAuth credentials')
        break

      case 'tokens':
        // Clear only tokens, preserve client information for re-authentication
        await this.storage.saveTokens(undefined)
        logger.info('Cleared OAuth tokens (access and refresh tokens)')
        break

      case 'client':
        // Clear client registration information
        // Note: This requires re-registration with the authorization server
        await this.storage.saveClientInformation(undefined)
        logger.info('Cleared OAuth client information')
        break

      case 'verifier':
        // Clear PKCE code verifier
        await this.storage.saveCodeVerifier('')
        logger.info('Cleared OAuth code verifier')
        break

      default:
        logger.warn(`Unknown invalidation scope: ${scope}`)
    }
  }
}
