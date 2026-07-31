import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth'
import type {
  OAuthClientInformation,
  OAuthClientInformationMixed,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth'
import open from 'open'
import { sanitizeUrl } from 'strict-url-sanitise'

import { application } from '@application'
import { loggerService } from '@logger'

import { JsonFileStorage } from './storage'
import type { OAuthProviderOptions } from './types'

const logger = loggerService.withContext('Mcp:OAuthClientProvider')

export class McpOAuthClientProvider implements OAuthClientProvider {
  private storage: JsonFileStorage
  private lastDiscoveredAuthServerUrl?: string
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
    if (!info) {
      await this.storage.saveClientInformation(undefined)
      // Drop the recorded auth server together with the client it was registered against
      await this.storage.saveAuthServerUrl(undefined)
      return
    }
    await this.storage.saveClientInformation(info)
    // Record which authorization server this client was registered against so we can
    // detect future auth-server migrations and drop the stale registration.
    if (this.lastDiscoveredAuthServerUrl) {
      await this.storage.saveAuthServerUrl(this.lastDiscoveredAuthServerUrl)
    }
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.lastDiscoveredAuthServerUrl = state.authorizationServerUrl
    // Sequential reads: both call readStorage(), which lazily creates the file on
    // first access — concurrent calls would race on the atomic write.
    const clientInfo = await this.storage.getClientInformation()
    const storedAuthServerUrl = await this.storage.getAuthServerUrl()
    // The authorization server has changed since this client was registered (e.g. the
    // provider migrated auth infrastructure, as alphaXiv did from Clerk to a custom
    // OAuth server). The stored client_id is now stale: refreshes fail and many servers
    // (including alphaXiv) reject unknown client_ids with an opaque error that the SDK
    // treats as tokens-only invalidation, so the stale client would otherwise be reused
    // on every retry. Clear it so the SDK re-registers against the current server.
    if (clientInfo && storedAuthServerUrl && storedAuthServerUrl !== state.authorizationServerUrl) {
      logger.warn('OAuth authorization server changed, clearing stale client registration', {
        oldAuthServerUrl: storedAuthServerUrl,
        newAuthServerUrl: state.authorizationServerUrl
      })
      await this.storage.saveClientInformation(undefined)
      await this.storage.saveTokens(undefined)
      await this.storage.saveAuthServerUrl(state.authorizationServerUrl)
    }
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
   *   - 'discovery': Clear cached discovery state (re-discovery will happen on next attempt)
   */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    logger.debug(`Invalidating credentials with scope: ${scope}`)

    switch (scope) {
      case 'all':
        // Clear all authentication information
        await this.storage.clear()
        logger.info('Cleared all OAuth credentials')
        break

      case 'tokens': {
        // Clear only tokens. A legacy client registered before we recorded the auth
        // server URL cannot be verified against the current authorization server
        // (e.g. after an auth-server migration), so clear it as well to force a
        // fresh dynamic registration — otherwise a stale client_id gets reused and
        // the refresh fails repeatedly.
        await this.storage.saveTokens(undefined)
        const authServerUrl = await this.storage.getAuthServerUrl()
        if (!authServerUrl) {
          await this.storage.saveClientInformation(undefined)
        }
        logger.info('Cleared OAuth tokens (access and refresh tokens)')
        break
      }

      case 'client':
        // Clear client registration information
        // Note: This requires re-registration with the authorization server
        await this.storage.saveClientInformation(undefined)
        await this.storage.saveAuthServerUrl(undefined)
        logger.info('Cleared OAuth client information')
        break

      case 'verifier':
        // Clear PKCE code verifier
        await this.storage.saveCodeVerifier('')
        logger.info('Cleared OAuth code verifier')
        break

      case 'discovery':
        // We cache no discovery state outside what the SDK holds; the SDK clears its
        // own cache so re-discovery happens naturally on the next attempt.
        logger.info('Cleared OAuth discovery state')
        break

      default:
        logger.warn(`Unknown invalidation scope: ${scope}`)
    }
  }
}
