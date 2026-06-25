import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { BaseService } from '@main/core/lifecycle'
import type { PkceOAuthClient } from '@main/utils/oauth/PkceOAuthClient'
import { type OAuthTokenResponse } from '@main/utils/oauth/PkceOAuthClient'
import type { OAuthAuthConfig } from '@shared/data/types/provider'
import { shell } from 'electron'

/** Account a provider associates with the session (e.g. Codex's ChatGPT id), or null. */
export interface OAuthAccount {
  accountId: string | null
}

export interface LoopbackConfig {
  /** Loopback hosts to bind, in priority order (e.g. ['127.0.0.1', '::1']). */
  hosts: readonly string[]
  port: number
  /** Callback path the provider redirects to (e.g. '/auth/callback'). */
  path: string
  /** Full redirect URI registered with the provider's OAuth client. */
  redirectUri: string
}

export class OAuthServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly code?: string
  ) {
    super(message)
    this.name = 'OAuthServiceError'
  }
}

// How long to wait for the user to complete the browser flow before giving up.
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000
// Refresh slightly before the real expiry so an in-flight request never races
// the boundary.
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000

/**
 * Abstract base for login-based providers whose OAuth the app drives through a
 * loopback HTTP callback — the authorization `code` comes back to a localhost
 * server the app starts. Owns the loopback transport, the PKCE token lifecycle
 * (persist / refresh-with-dedup / expiry-aware read), and the sign-in template.
 *
 * Subclasses supply the provider id, client id, loopback binding, and the PKCE
 * client (static for a fixed endpoint, or built per call from OIDC discovery).
 * The shared `signIn`/`hasToken`/`logout` methods are exposed to the renderer by
 * the IpcApi `oauth` domain (`src/main/ipc/handlers/oauth.ts`), which calls them
 * on the registered service; a subclass with a richer sign-in return shape (e.g.
 * Codex's account) overrides `signIn` and adds its own routes.
 *
 * Deep-link providers (custom-protocol callback) deliberately do NOT extend this
 * — their transport and post-auth side effects differ enough that sharing the
 * loopback machinery would leak.
 */
export abstract class LoopbackOAuthService extends BaseService {
  protected abstract readonly providerId: string
  protected abstract readonly clientId: string
  protected abstract readonly loopback: LoopbackConfig

  /**
   * Resolve the PKCE client. Called once per sign-in and once per refresh, so a
   * subclass doing OIDC discovery can build it fresh (and grok-style providers
   * can fold a per-flow `nonce` into the authorize URL here).
   */
  protected abstract getClient(): PkceOAuthClient | Promise<PkceOAuthClient>

  protected readonly logger = loggerService.withContext(this.constructor.name)

  // Track every bound loopback server so a single in-flight flow (and its
  // IPv4/IPv6 pair) tear down together; non-empty means a flow is active.
  private activeServers: Server[] = []
  private refreshPromise: Promise<string | null> | null = null

  protected onStop(): void {
    this.closeActiveServer()
    this.refreshPromise = null
  }

  protected onDestroy(): void {
    this.closeActiveServer()
  }

  // ── Auth config ──

  protected getOAuthAuthConfig = async (): Promise<OAuthAuthConfig | null> => {
    const authConfig = await providerService.getAuthConfig(this.providerId)
    return authConfig?.type === 'oauth' ? authConfig : null
  }

  /**
   * Extra authConfig fields derived from a freshly issued access token (e.g.
   * Codex's `chatgpt_account_id`). Defaults to none; the params are part of the
   * override contract (see Codex), so the default `void`s them rather than dropping them.
   */
  protected extraAuthFields(accessToken: string, current: OAuthAuthConfig | null): Record<string, unknown> {
    void accessToken
    void current
    return {}
  }

  protected async persistTokens(tokenData: OAuthTokenResponse): Promise<void> {
    const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = tokenData
    const current = await this.getOAuthAuthConfig()
    const refresh = refreshToken || current?.refreshToken
    const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined

    await providerService.update(this.providerId, {
      authConfig: {
        type: 'oauth',
        clientId: this.clientId,
        accessToken,
        ...(refresh ? { refreshToken: refresh } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        ...this.extraAuthFields(accessToken, current)
      }
    })
  }

  /** Reset to api-key mode and disable the login-only provider. */
  protected clearStoredAuth = async (): Promise<void> => {
    await providerService.update(this.providerId, { authConfig: { type: 'api-key' }, isEnabled: false })
  }

  // ── Token read / refresh ──

  /** Expired, or within the refresh buffer of expiry, relative to now. */
  private isExpired(config: OAuthAuthConfig): boolean {
    return config.expiresAt !== undefined && Date.now() >= config.expiresAt - TOKEN_EXPIRY_BUFFER_MS
  }

  /**
   * Return a valid access token, refreshing if expired. Returns `null` when not
   * signed in or the refresh failed; a dead session (expired, no refresh token)
   * is cleared so the UI stops reporting "logged in".
   */
  protected getValidToken = async (): Promise<string | null> => {
    const config = await this.getOAuthAuthConfig()
    if (!config?.accessToken) return null

    if (!this.isExpired(config)) return config.accessToken

    if (!config.refreshToken) {
      await this.clearStoredAuth()
      return null
    }
    return this.refreshAccessToken(config.refreshToken)
  }

  private refreshAccessToken(refreshToken: string): Promise<string | null> {
    // De-duplicate concurrent refreshes (several in-flight requests at once).
    this.refreshPromise ??= this.doRefresh(refreshToken).finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  private async doRefresh(refreshToken: string): Promise<string | null> {
    try {
      const client = await this.getClient()
      const tokenData = await client.refresh(refreshToken)
      await this.persistTokens(tokenData)
      return tokenData.access_token
    } catch (error) {
      this.logger.error(`Failed to refresh ${this.providerId} token`, error as Error)
      return null
    }
  }

  // ── Public IPC surface shared by every loopback provider ──

  /**
   * Default sign-in: runs the loopback flow and reports no account. Providers
   * with an account concept (Codex) override to return the real id.
   */
  public signIn = async (): Promise<OAuthAccount> => {
    await this.runSignIn()
    return { accountId: null }
  }

  /** Account for the current session. Defaults to none; Codex overrides. */
  public getAccount = async (): Promise<OAuthAccount> => ({ accountId: null })

  public hasToken = async (): Promise<boolean> => {
    const config = await this.getOAuthAuthConfig()
    if (!config?.accessToken) return false

    if (this.isExpired(config) && !config.refreshToken) {
      await this.clearStoredAuth()
      return false
    }
    return true
  }

  public logout = async (): Promise<void> => {
    await this.clearStoredAuth()
    this.logger.info(`Cleared ${this.providerId} OAuth tokens`)
  }

  // ── Loopback transport ──

  private closeActiveServer(): void {
    for (const server of this.activeServers) {
      server.close()
    }
    this.activeServers = []
  }

  /**
   * Start loopback HTTP server(s) and resolve with the authorization `code` once
   * the provider redirects the browser back to the callback. Binds every host in
   * `loopback.hosts` (so both IPv4 and IPv6 localhost resolution work); an
   * unavailable `::1` is tolerated. `state` is validated as CSRF/replay defense.
   */
  private waitForAuthorizationCode(expectedState: string, signal: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '', this.loopback.redirectUri)
        if (url.pathname !== this.loopback.path) {
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
          reject(new OAuthServiceError(`OAuth provider returned error: ${error}`))
          return
        }
        if (!state || state !== expectedState) {
          respond('Sign-in failed')
          reject(new OAuthServiceError('OAuth callback state mismatch'))
          return
        }
        if (!code) {
          respond('Sign-in failed')
          reject(new OAuthServiceError('No authorization code received'))
          return
        }

        respond('Signed in successfully')
        resolve(code)
      }

      const listen = (host: string) =>
        new Promise<void>((resolveListen, rejectListen) => {
          const server = createServer(handleRequest)
          this.activeServers.push(server)

          server.once('listening', resolveListen)
          server.once('error', (err: NodeJS.ErrnoException) => {
            this.activeServers = this.activeServers.filter((activeServer) => activeServer !== server)
            server.close()
            if (host === '::1' && err.code === 'EADDRNOTAVAIL') {
              resolveListen()
              return
            }
            rejectListen(
              new OAuthServiceError(
                `Failed to start OAuth callback server on ${host}:${this.loopback.port}: ${err.message}`,
                err
              )
            )
          })

          server.listen(this.loopback.port, host)
        })

      void Promise.all(this.loopback.hosts.map(listen)).catch(reject)
      signal.addEventListener('abort', () => reject(new OAuthServiceError('Sign-in timed out')), { once: true })
    })
  }

  /**
   * Run the full loopback sign-in: open the browser to the authorize URL, await
   * the callback `code`, exchange it, persist tokens, and enable the provider.
   * Subclasses wrap this to shape their own sign-in return value.
   */
  protected async runSignIn(): Promise<void> {
    if (this.activeServers.length > 0) {
      throw new OAuthServiceError(`A ${this.providerId} sign-in is already in progress`)
    }

    const timeout = AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)
    try {
      const client = await this.getClient()
      const { authUrl, state, codeVerifier } = client.createAuthorizationRequest()

      const codePromise = this.waitForAuthorizationCode(state, timeout)
      await shell.openExternal(authUrl)
      const code = await codePromise

      await this.persistTokens(await client.exchangeCode(code, codeVerifier))
      // Enable the provider on first successful sign-in (disabled by default).
      await providerService.update(this.providerId, { isEnabled: true })
      this.logger.info(`${this.providerId} sign-in succeeded`)
    } catch (error) {
      this.logger.error(`${this.providerId} sign-in failed`, error as Error)
      throw error instanceof OAuthServiceError
        ? error
        : new OAuthServiceError(`${this.providerId} sign-in failed`, error)
    } finally {
      this.closeActiveServer()
    }
  }
}
