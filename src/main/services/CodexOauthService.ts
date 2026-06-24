import { createServer, type Server } from 'node:http'

import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import type { AuthConfig } from '@shared/data/types/provider'
import { IpcChannel } from '@shared/IpcChannel'
import { createHash, randomBytes } from 'crypto'
import { net, shell } from 'electron'
import * as z from 'zod'

const logger = loggerService.withContext('CodexOauthService')

// OpenAI Codex OAuth configuration. The client_id and the loopback redirect URI
// are fixed by OpenAI's registered OAuth client (the same one the Codex CLI
// uses) — they cannot be changed app-side.
const CODEX_CONFIG = {
  CLIENT_ID: 'app_EMoamEEZ73f0CkXaXp7hrann',
  AUTHORIZE_URL: 'https://auth.openai.com/oauth/authorize',
  TOKEN_URL: 'https://auth.openai.com/oauth/token',
  REDIRECT_URI: 'http://localhost:1455/auth/callback',
  CALLBACK_HOST: '127.0.0.1',
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

const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().optional()
})

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
  private activeServer: Server | null = null
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

  // ── PKCE helpers ──

  private base64UrlEncode(buffer: Buffer): string {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  private generateCodeVerifier(): string {
    // 32 random bytes → 43-char base64url string (within RFC 7636's 43-128 range).
    return this.base64UrlEncode(randomBytes(32))
  }

  private generateCodeChallenge(codeVerifier: string): string {
    return this.base64UrlEncode(createHash('sha256').update(codeVerifier).digest())
  }

  private generateState(): string {
    return randomBytes(16).toString('hex')
  }

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
    if (this.activeServer) {
      this.activeServer.close()
      this.activeServer = null
    }
  }

  /**
   * Start the loopback HTTP server and resolve with the authorization `code`
   * once OpenAI redirects the browser back to `127.0.0.1:1455/auth/callback`.
   * The `state` is validated here as CSRF/replay defense.
   */
  private waitForAuthorizationCode(expectedState: string, signal: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '', `http://${CODEX_CONFIG.CALLBACK_HOST}:${CODEX_CONFIG.CALLBACK_PORT}`)
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
      })

      this.activeServer = server

      server.on('error', (err) => {
        reject(
          new CodexOauthServiceError(
            `Failed to start OAuth callback server on port ${CODEX_CONFIG.CALLBACK_PORT}: ${err.message}`,
            err
          )
        )
      })

      signal.addEventListener('abort', () => reject(new CodexOauthServiceError('Sign-in timed out')), { once: true })

      server.listen(CODEX_CONFIG.CALLBACK_PORT, CODEX_CONFIG.CALLBACK_HOST)
    })
  }

  // ── Token exchange / persistence ──

  private async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<void> {
    const response = await net.fetch(CODEX_CONFIG.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CODEX_CONFIG.CLIENT_ID,
        code,
        code_verifier: codeVerifier,
        redirect_uri: CODEX_CONFIG.REDIRECT_URI
      }).toString()
    })

    if (!response.ok) {
      throw new CodexOauthServiceError(`Failed to exchange code for token: ${response.status}`)
    }

    const tokenData = TokenResponseSchema.parse(await response.json())
    await this.persistTokens(tokenData)
  }

  private async persistTokens(tokenData: z.infer<typeof TokenResponseSchema>): Promise<void> {
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
      const response = await net.fetch(CODEX_CONFIG.TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: CODEX_CONFIG.CLIENT_ID
        }).toString()
      })

      if (!response.ok) {
        logger.error('Codex token refresh failed', { status: response.status })
        return null
      }

      const tokenData = TokenResponseSchema.parse(await response.json())
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
      return { accessToken: config.accessToken, accountId: config.accountId ?? null }
    }

    const refreshed = await this.refreshAccessToken(config.refreshToken)
    if (!refreshed) return null

    const next = await this.getOAuthAuthConfig()
    return { accessToken: refreshed, accountId: next?.accountId ?? null }
  }

  public signIn = async (): Promise<CodexSignInResult> => {
    if (this.activeServer) {
      throw new CodexOauthServiceError('A Codex sign-in is already in progress')
    }

    const codeVerifier = this.generateCodeVerifier()
    const codeChallenge = this.generateCodeChallenge(codeVerifier)
    const state = this.generateState()

    const authUrl = new URL(CODEX_CONFIG.AUTHORIZE_URL)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', CODEX_CONFIG.CLIENT_ID)
    authUrl.searchParams.set('redirect_uri', CODEX_CONFIG.REDIRECT_URI)
    authUrl.searchParams.set('scope', CODEX_CONFIG.SCOPE)
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('id_token_add_organizations', 'true')
    authUrl.searchParams.set('codex_cli_simplified_flow', 'true')

    const timeout = AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)
    try {
      const codePromise = this.waitForAuthorizationCode(state, timeout)
      await shell.openExternal(authUrl.toString())
      const code = await codePromise

      await this.exchangeAuthorizationCode(code, codeVerifier)
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
    return !!config?.accessToken
  }

  public getAccount = async (): Promise<CodexAccount> => {
    const config = await this.getOAuthAuthConfig()
    return { accountId: config?.accountId ?? null }
  }

  /** Clear stored tokens. Resets the provider to api-key auth so `hasToken()` is false. */
  public logout = async (): Promise<void> => {
    await providerService.update(OPENAI_CODEX_PROVIDER_ID, { authConfig: { type: 'api-key' } })
    logger.info('Cleared Codex OAuth tokens')
  }
}
