import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { type OAuthTokenResponse, PkceOAuthClient } from '@main/utils/oauth/PkceOAuthClient'
import { GROK_CLI_PROVIDER_ID } from '@shared/data/presets/grokCli'
import type { AuthConfig } from '@shared/data/types/provider'
import { IpcChannel } from '@shared/IpcChannel'
import { net, shell } from 'electron'
import * as z from 'zod'

const logger = loggerService.withContext('GrokCliOauthService')

// xAI OAuth configuration. The client_id is fixed by xAI's registered OAuth
// client (the same one the official Grok CLI uses). Endpoints are resolved at
// runtime via OIDC discovery rather than hardcoded, so they track xAI changes.
const GROK_CONFIG = {
  CLIENT_ID: 'b1a00492-073a-47ea-816f-4c329264a828',
  ISSUER: 'https://auth.x.ai',
  DISCOVERY_URL: 'https://auth.x.ai/.well-known/openid-configuration',
  REDIRECT_URI: 'http://127.0.0.1:56121/callback',
  CALLBACK_HOST: '127.0.0.1',
  CALLBACK_PORT: 56121,
  CALLBACK_PATH: '/callback',
  SCOPE: 'openid profile email offline_access grok-cli:access api:access'
} as const

const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000
const TOKEN_EXPIRY_BUFFER_MS = 2 * 60 * 1000

const DiscoverySchema = z.object({
  authorization_endpoint: z.string(),
  token_endpoint: z.string()
})

type Discovery = z.infer<typeof DiscoverySchema>

class GrokCliOauthServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'GrokCliOauthServiceError'
  }
}

@Injectable('GrokCliOauthService')
@ServicePhase(Phase.Background)
export class GrokCliOauthService extends BaseService {
  // Guards against two concurrent sign-in flows fighting over the loopback port.
  private activeServer: Server | null = null
  private refreshPromise: Promise<string | null> | null = null
  private discoveryCache: Discovery | null = null

  protected onInit(): void {
    this.ipcHandle(IpcChannel.GrokCli_SignIn, this.signIn)
    this.ipcHandle(IpcChannel.GrokCli_HasToken, this.hasToken)
    this.ipcHandle(IpcChannel.GrokCli_Logout, this.logout)
  }

  protected onStop(): void {
    this.closeActiveServer()
    this.refreshPromise = null
  }

  protected onDestroy(): void {
    this.closeActiveServer()
  }

  /**
   * Build a PKCE client bound to the discovered endpoints. A fresh `nonce`
   * (OIDC) is passed through to the authorize URL on sign-in; refresh/exchange
   * ignore it.
   */
  private buildOAuthClient(discovery: Discovery, nonce?: string): PkceOAuthClient {
    return new PkceOAuthClient({
      clientId: GROK_CONFIG.CLIENT_ID,
      authorizeUrl: discovery.authorization_endpoint,
      tokenUrl: discovery.token_endpoint,
      redirectUri: GROK_CONFIG.REDIRECT_URI,
      scope: GROK_CONFIG.SCOPE,
      ...(nonce ? { extraAuthParams: { nonce } } : {})
    })
  }

  // ── OIDC discovery ──

  /**
   * Reject any discovered endpoint that is not served from `x.ai`, so a
   * compromised/spoofed discovery document cannot redirect the auth or token
   * exchange to an attacker-controlled host.
   */
  private assertXaiEndpoint(url: string): string {
    const host = new URL(url).hostname.toLowerCase()
    if (new URL(url).protocol !== 'https:' || (host !== 'x.ai' && !host.endsWith('.x.ai'))) {
      throw new GrokCliOauthServiceError(`xAI OAuth discovery returned an unexpected endpoint: ${url}`)
    }
    return url
  }

  private async discover(): Promise<Discovery> {
    if (this.discoveryCache) return this.discoveryCache
    const response = await net.fetch(GROK_CONFIG.DISCOVERY_URL, { headers: { Accept: 'application/json' } })
    if (!response.ok) {
      throw new GrokCliOauthServiceError(`xAI OAuth discovery failed: ${response.status}`)
    }
    const data = DiscoverySchema.parse(await response.json())
    this.discoveryCache = {
      authorization_endpoint: this.assertXaiEndpoint(data.authorization_endpoint),
      token_endpoint: this.assertXaiEndpoint(data.token_endpoint)
    }
    return this.discoveryCache
  }

  // ── Auth config access ──

  private getOAuthAuthConfig = async (): Promise<Extract<AuthConfig, { type: 'oauth' }> | null> => {
    const authConfig = await providerService.getAuthConfig(GROK_CLI_PROVIDER_ID)
    return authConfig?.type === 'oauth' ? authConfig : null
  }

  // ── Loopback callback server ──

  private closeActiveServer(): void {
    if (this.activeServer) {
      this.activeServer.close()
      this.activeServer = null
    }
  }

  /**
   * Start the loopback HTTP server and resolve with the authorization `code`
   * once xAI redirects the browser back to the callback. The `state` is
   * validated here as CSRF/replay defense.
   */
  private waitForAuthorizationCode(expectedState: string, signal: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '', `http://${GROK_CONFIG.CALLBACK_HOST}:${GROK_CONFIG.CALLBACK_PORT}`)
        if (url.pathname !== GROK_CONFIG.CALLBACK_PATH) {
          res.writeHead(404).end()
          return
        }

        const error = url.searchParams.get('error')
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')

        const respond = (message: string) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(
            `<!doctype html><html><body style="font-family:system-ui;text-align:center;padding-top:64px">` +
              `<h2>${message}</h2><p>You can close this window and return to Cherry Studio.</p></body></html>`
          )
        }

        if (error) {
          respond('Sign-in failed')
          reject(new GrokCliOauthServiceError(`OAuth provider returned error: ${error}`))
          return
        }
        if (!state || state !== expectedState) {
          respond('Sign-in failed')
          reject(new GrokCliOauthServiceError('OAuth callback state mismatch'))
          return
        }
        if (!code) {
          respond('Sign-in failed')
          reject(new GrokCliOauthServiceError('No authorization code received'))
          return
        }

        respond('Signed in successfully')
        resolve(code)
      })

      this.activeServer = server

      server.on('error', (err) => {
        reject(
          new GrokCliOauthServiceError(
            `Failed to start OAuth callback server on port ${GROK_CONFIG.CALLBACK_PORT}: ${err.message}`,
            err
          )
        )
      })

      signal.addEventListener('abort', () => reject(new GrokCliOauthServiceError('Sign-in timed out')), { once: true })

      server.listen(GROK_CONFIG.CALLBACK_PORT, GROK_CONFIG.CALLBACK_HOST)
    })
  }

  // ── Token persistence ──

  private async persistTokens(tokenData: OAuthTokenResponse): Promise<void> {
    const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = tokenData
    const current = await this.getOAuthAuthConfig()
    const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined

    await providerService.update(GROK_CLI_PROVIDER_ID, {
      authConfig: {
        type: 'oauth',
        clientId: GROK_CONFIG.CLIENT_ID,
        accessToken,
        ...(refreshToken || current?.refreshToken ? { refreshToken: refreshToken || current?.refreshToken } : {}),
        ...(expiresAt ? { expiresAt } : {})
      }
    })
  }

  private async doRefresh(refreshToken: string): Promise<string | null> {
    try {
      const tokenData = await this.buildOAuthClient(await this.discover()).refresh(refreshToken)
      await this.persistTokens(tokenData)
      return tokenData.access_token
    } catch (error) {
      logger.error('Failed to refresh Grok CLI token', error as Error)
      return null
    }
  }

  private refreshAccessToken(refreshToken: string): Promise<string | null> {
    // De-duplicate concurrent refreshes (several in-flight requests at once).
    this.refreshPromise ??= this.doRefresh(refreshToken).finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  // ── Public surface (runtime + IPC) ──

  /**
   * Return a valid access token (refreshing if expired) for the runtime config
   * builder. Returns `null` when the user is not signed in or the refresh
   * failed — the caller surfaces the missing-credential error.
   */
  public getValidAccessToken = async (): Promise<string | null> => {
    const config = await this.getOAuthAuthConfig()
    if (!config?.accessToken) return null

    const expired = config.expiresAt !== undefined && Date.now() >= config.expiresAt - TOKEN_EXPIRY_BUFFER_MS
    if (!expired || !config.refreshToken) return config.accessToken

    return this.refreshAccessToken(config.refreshToken)
  }

  public signIn = async (): Promise<void> => {
    if (this.activeServer) {
      throw new GrokCliOauthServiceError('A Grok CLI sign-in is already in progress')
    }

    const timeout = AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)
    try {
      const nonce = randomBytes(16).toString('hex')
      const oauthClient = this.buildOAuthClient(await this.discover(), nonce)
      const { authUrl, state, codeVerifier } = oauthClient.createAuthorizationRequest()

      const codePromise = this.waitForAuthorizationCode(state, timeout)
      await shell.openExternal(authUrl)
      const code = await codePromise

      await this.persistTokens(await oauthClient.exchangeCode(code, codeVerifier))
      // Enable the provider on first successful sign-in (disabled by default).
      await providerService.update(GROK_CLI_PROVIDER_ID, { isEnabled: true })
      logger.info('Grok CLI sign-in succeeded')
    } catch (error) {
      logger.error('Grok CLI sign-in failed', error as Error)
      throw error instanceof GrokCliOauthServiceError
        ? error
        : new GrokCliOauthServiceError('Grok CLI sign-in failed', error)
    } finally {
      this.closeActiveServer()
    }
  }

  public hasToken = async (): Promise<boolean> => {
    const config = await this.getOAuthAuthConfig()
    return !!config?.accessToken
  }

  /** Clear stored tokens. Resets the provider to api-key auth so `hasToken()` is false. */
  public logout = async (): Promise<void> => {
    await providerService.update(GROK_CLI_PROVIDER_ID, { authConfig: { type: 'api-key' } })
    logger.info('Cleared Grok CLI OAuth tokens')
  }
}
