import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { type OAuthTokenResponse, PkceOAuthClient } from '@main/utils/oauth/PkceOAuthClient'
import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import type { AuthConfig } from '@shared/data/types/provider'
import { IpcChannel } from '@shared/IpcChannel'
import { shell } from 'electron'

const logger = loggerService.withContext('CodexOauthService')

// OpenAI Codex OAuth configuration. The client_id and the loopback redirect URI
// are fixed by OpenAI's registered OAuth client (the same one the Codex CLI
// uses) — they cannot be changed app-side.
const CODEX_CONFIG = {
  CLIENT_ID: 'app_EMoamEEZ73f0CkXaXp7hrann',
  AUTHORIZE_URL: 'https://auth.openai.com/oauth/authorize',
  TOKEN_URL: 'https://auth.openai.com/oauth/token',
  REDIRECT_URI: 'http://localhost:1455/auth/callback',
  CALLBACK_HOSTS: ['127.0.0.1', '::1'],
  CALLBACK_PORT: 1455,
  CALLBACK_PATH: '/auth/callback',
  SCOPE: 'openid profile email offline_access',
  // ChatGPT account id lives under this namespaced claim in the access token.
  JWT_CLAIM_PATH: 'https://api.openai.com/auth'
} as const

// How long to wait for the user to complete the browser flow before giving up.
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000
// Refresh the access token slightly before it actually expires so an in-flight
// request never races the expiry boundary.
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000

export interface CodexAccount {
  accountId: string | null
}

export interface CodexSignInResult {
  accountId: string | null
}

class CodexOauthServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly code?: string
  ) {
    super(message)
    this.name = 'CodexOauthServiceError'
  }
}

@Injectable('CodexOauthService')
@ServicePhase(Phase.Background)
export class CodexOauthService extends BaseService {
  // Guards against two concurrent sign-in flows fighting over port 1455.
  private activeServers: Server[] = []
  private refreshPromise: Promise<string | null> | null = null

  protected onInit(): void {
    this.ipcHandle(IpcChannel.Codex_SignIn, this.signIn)
    this.ipcHandle(IpcChannel.Codex_HasToken, this.hasToken)
    this.ipcHandle(IpcChannel.Codex_GetAccount, this.getAccount)
    this.ipcHandle(IpcChannel.Codex_Logout, this.logout)
  }

  protected onStop(): void {
    this.closeActiveServer()
    this.refreshPromise = null
  }

  protected onDestroy(): void {
    this.closeActiveServer()
  }

  // PKCE generation + token endpoint live in the shared client; this service
  // owns the loopback transport, token persistence, and account extraction.
  private readonly oauthClient = new PkceOAuthClient({
    clientId: CODEX_CONFIG.CLIENT_ID,
    authorizeUrl: CODEX_CONFIG.AUTHORIZE_URL,
    tokenUrl: CODEX_CONFIG.TOKEN_URL,
    redirectUri: CODEX_CONFIG.REDIRECT_URI,
    scope: CODEX_CONFIG.SCOPE,
    extraAuthParams: {
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true'
    }
  })

  // ── Auth config access ──

  private getOAuthAuthConfig = async (): Promise<Extract<AuthConfig, { type: 'oauth' }> | null> => {
    const authConfig = await providerService.getAuthConfig(OPENAI_CODEX_PROVIDER_ID)
    return authConfig?.type === 'oauth' ? authConfig : null
  }

  /**
   * Decode the `chatgpt_account_id` claim from a Codex access token. Returns
   * `null` for any malformed token rather than throwing — the account id is a
   * convenience header, not a hard requirement for every code path.
   */
  private extractAccountId(accessToken: string): string | null {
    try {
      const parts = accessToken.split('.')
      if (parts.length !== 3) return null
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'))
      const accountId = payload?.[CODEX_CONFIG.JWT_CLAIM_PATH]?.chatgpt_account_id
      return typeof accountId === 'string' && accountId.length > 0 ? accountId : null
    } catch {
      return null
    }
  }

  // ── Loopback callback server ──

  private closeActiveServer(): void {
    for (const server of this.activeServers) {
      server.close()
    }
    this.activeServers = []
  }

  private clearStoredAuth = async (): Promise<void> => {
    await providerService.update(OPENAI_CODEX_PROVIDER_ID, { authConfig: { type: 'api-key' }, isEnabled: false })
  }

  /**
   * Start loopback HTTP servers and resolve with the authorization `code` once
   * OpenAI redirects the browser back to `localhost:1455/auth/callback`. Bind
   * both IPv4 and IPv6 loopback so either localhost resolution path is handled.
   * The `state` is validated here as CSRF/replay defense.
   */
  private waitForAuthorizationCode(expectedState: string, signal: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '', CODEX_CONFIG.REDIRECT_URI)
        if (url.pathname !== CODEX_CONFIG.CALLBACK_PATH) {
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
          reject(new CodexOauthServiceError(`OAuth provider returned error: ${error}`))
          return
        }
        if (!state || state !== expectedState) {
          respond('Sign-in failed')
          reject(new CodexOauthServiceError('OAuth callback state mismatch'))
          return
        }
        if (!code) {
          respond('Sign-in failed')
          reject(new CodexOauthServiceError('No authorization code received'))
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
              new CodexOauthServiceError(
                `Failed to start OAuth callback server on ${host}:${CODEX_CONFIG.CALLBACK_PORT}: ${err.message}`,
                err
              )
            )
          })

          server.listen(CODEX_CONFIG.CALLBACK_PORT, host)
        })

      void Promise.all(CODEX_CONFIG.CALLBACK_HOSTS.map(listen)).catch(reject)
      signal.addEventListener('abort', () => reject(new CodexOauthServiceError('Sign-in timed out')), { once: true })
    })
  }

  // ── Token persistence ──

  private async persistTokens(tokenData: OAuthTokenResponse): Promise<void> {
    const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = tokenData
    const current = await this.getOAuthAuthConfig()
    const accountId = this.extractAccountId(accessToken) ?? current?.accountId
    const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined

    await providerService.update(OPENAI_CODEX_PROVIDER_ID, {
      authConfig: {
        type: 'oauth',
        clientId: CODEX_CONFIG.CLIENT_ID,
        accessToken,
        ...(refreshToken || current?.refreshToken ? { refreshToken: refreshToken || current?.refreshToken } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        ...(accountId ? { accountId } : {})
      }
    })
  }

  private async doRefresh(refreshToken: string): Promise<string | null> {
    try {
      const tokenData = await this.oauthClient.refresh(refreshToken)
      await this.persistTokens(tokenData)
      return tokenData.access_token
    } catch (error) {
      logger.error('Failed to refresh Codex token', error as Error)
      return null
    }
  }

  private refreshAccessToken(refreshToken: string): Promise<string | null> {
    // De-duplicate concurrent refreshes (chat + agent may both fire at once).
    this.refreshPromise ??= this.doRefresh(refreshToken).finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  // ── Public surface (runtime + IPC) ──

  /**
   * Return a valid access token (refreshing if expired) plus the account id, for
   * the runtime config builder. Returns `null` when the user is not signed in or
   * the refresh failed — the caller surfaces the missing-credential error.
   */
  public getValidAccessToken = async (): Promise<{ accessToken: string; accountId: string | null } | null> => {
    const config = await this.getOAuthAuthConfig()
    if (!config?.accessToken) return null

    const expired = config.expiresAt !== undefined && Date.now() >= config.expiresAt - TOKEN_EXPIRY_BUFFER_MS
    if (!expired) {
      return { accessToken: config.accessToken, accountId: config.accountId ?? null }
    }

    if (!config.refreshToken) {
      await this.clearStoredAuth()
      return null
    }

    const refreshed = await this.refreshAccessToken(config.refreshToken)
    if (!refreshed) return null

    const next = await this.getOAuthAuthConfig()
    return { accessToken: refreshed, accountId: next?.accountId ?? null }
  }

  public signIn = async (): Promise<CodexSignInResult> => {
    if (this.activeServers.length > 0) {
      throw new CodexOauthServiceError('A Codex sign-in is already in progress')
    }

    const { authUrl, state, codeVerifier } = this.oauthClient.createAuthorizationRequest()

    const timeout = AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)
    try {
      const codePromise = this.waitForAuthorizationCode(state, timeout)
      await shell.openExternal(authUrl)
      const code = await codePromise

      await this.persistTokens(await this.oauthClient.exchangeCode(code, codeVerifier))
      // Enable the provider on first successful sign-in (seeded disabled).
      await providerService.update(OPENAI_CODEX_PROVIDER_ID, { isEnabled: true })

      const config = await this.getOAuthAuthConfig()
      logger.info('Codex sign-in succeeded')
      return { accountId: config?.accountId ?? null }
    } catch (error) {
      logger.error('Codex sign-in failed', error as Error)
      throw error instanceof CodexOauthServiceError ? error : new CodexOauthServiceError('Codex sign-in failed', error)
    } finally {
      this.closeActiveServer()
    }
  }

  public hasToken = async (): Promise<boolean> => {
    const config = await this.getOAuthAuthConfig()
    if (!config?.accessToken) return false

    const expired = config.expiresAt !== undefined && Date.now() >= config.expiresAt - TOKEN_EXPIRY_BUFFER_MS
    if (expired && !config.refreshToken) {
      await this.clearStoredAuth()
      return false
    }

    return true
  }

  public getAccount = async (): Promise<CodexAccount> => {
    const config = await this.getOAuthAuthConfig()
    return { accountId: config?.accountId ?? null }
  }

  /** Clear stored tokens and disable the login-only provider. */
  public logout = async (): Promise<void> => {
    await this.clearStoredAuth()
    logger.info('Cleared Codex OAuth tokens')
  }
}
