import { application } from '@application'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { CHERRYIN_CONFIG } from '@shared/config/constant'
import type { AuthConfig } from '@shared/data/types/provider'
import { IpcChannel } from '@shared/IpcChannel'
import { createHash, randomBytes } from 'crypto'
import { net } from 'electron'
import * as z from 'zod'

const logger = loggerService.withContext('CherryINOAuthService')
const CHERRYIN_PROVIDER_ID = 'cherryin'

// Zod schemas for API response validation
const BalanceDataSchema = z.object({
  quota: z.number(),
  used_quota: z.number()
})

const BalanceResponseSchema = z.object({
  success: z.boolean(),
  data: BalanceDataSchema
})

// API key can be either a string or an object with key/token property, transform to string
const ApiKeyItemSchema = z
  .union([z.string(), z.object({ key: z.string() }), z.object({ token: z.string() })])
  .transform((item): string => {
    if (typeof item === 'string') return item
    if ('key' in item) return item.key
    return item.token
  })

// Response can be array or object with data array, transform to string array
const ApiKeysResponseSchema = z
  .union([z.array(ApiKeyItemSchema), z.object({ data: z.array(ApiKeyItemSchema) })])
  .transform((data): string[] => (Array.isArray(data) ? data : data.data))

// Token response schema
const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().optional()
})

const UserSelfProfileSchema = z.object({
  display_name: z.string().optional().nullable(),
  username: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  group: z.string().optional().nullable()
})

const UserSelfResponseSchema = z
  .union([
    z
      .object({ data: UserSelfProfileSchema.nullable() })
      .passthrough()
      .transform((payload) => payload.data),
    UserSelfProfileSchema.transform((profile) => profile)
  ])
  .transform((payload): CherryINProfile | null => {
    const profile = payload

    if (!profile) {
      return null
    }

    return {
      displayName: profile.display_name ?? null,
      username: profile.username ?? null,
      email: profile.email ?? null,
      group: profile.group ?? null
    }
  })

// Export types for use in other modules
export interface BalanceResponse {
  balance: number
  profile: CherryINProfile | null
  monthlyUsageTokens: number | null
  monthlySpend: number | null
}

export interface CherryINProfile {
  displayName: string | null
  username: string | null
  email: string | null
  group: string | null
}

export interface OAuthFlowParams {
  authUrl: string
  state: string
}

const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000
const OAUTH_FLOW_CLEANUP_INTERVAL_MS = 60 * 1000

class CherryINOAuthServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly code?: string
  ) {
    super(message)
    this.name = 'CherryINOAuthServiceError'
  }
}

// Store pending OAuth flows with PKCE verifiers (keyed by state parameter).
// initiatorWindowId is the WindowManager UUID of the renderer that started the
// flow, captured at startOAuthFlow time so the protocol callback can be
// delivered point-to-point to the originating window instead of being broadcast
// to every window.
interface PendingOAuthFlow {
  codeVerifier: string
  oauthServer: string
  apiHost: string
  timestamp: number
  initiatorWindowId: string
}

interface TokenRefreshResult {
  accessToken: string | null
  attempted: boolean
}

@Injectable('CherryINOAuthService')
@ServicePhase(Phase.Background)
export class CherryINOAuthService extends BaseService implements Activatable {
  private readonly pendingOAuthFlows = new Map<string, PendingOAuthFlow>()
  private refreshAccessTokenPromise: Promise<TokenRefreshResult> | null = null
  private cleanupTimer: NodeJS.Timeout | null = null

  protected onInit(): void {
    this.registerIpcHandlers()
  }

  protected onStop(): void {
    this.pendingOAuthFlows.clear()
    this.refreshAccessTokenPromise = null
  }

  onActivate(): void {
    this.cleanupTimer = setInterval(() => this.cleanupExpiredFlows(), OAUTH_FLOW_CLEANUP_INTERVAL_MS)
    this.cleanupTimer.unref?.()
  }

  onDeactivate(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  protected onDestroy(): void {
    this.pendingOAuthFlows.clear()
    this.refreshAccessTokenPromise = null
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.CherryIN_SaveToken, this.saveToken)
    this.ipcHandle(IpcChannel.CherryIN_HasToken, this.hasToken)
    this.ipcHandle(IpcChannel.CherryIN_GetBalance, this.getBalance)
    this.ipcHandle(IpcChannel.CherryIN_Logout, this.logout)
    this.ipcHandle(IpcChannel.CherryIN_StartOAuthFlow, this.startOAuthFlow)
  }

  // Clean up expired flows (older than 10 minutes).
  private cleanupExpiredFlows(): void {
    const now = Date.now()
    for (const [state, flow] of this.pendingOAuthFlows.entries()) {
      if (now - flow.timestamp > OAUTH_FLOW_TTL_MS) {
        this.pendingOAuthFlows.delete(state)
      }
    }

    this.deactivateIfIdle()
  }

  private deactivateIfIdle(): void {
    if (this.pendingOAuthFlows.size > 0) {
      return
    }

    void this.deactivate()
  }

  private getOAuthAuthConfig = async (): Promise<Extract<AuthConfig, { type: 'oauth' }> | null> => {
    const authConfig = await providerService.getAuthConfig(CHERRYIN_PROVIDER_ID)
    return authConfig?.type === 'oauth' ? authConfig : null
  }

  /**
   * Validate API host against allowlist to prevent SSRF attacks
   */
  private validateApiHost(apiHost: string): void {
    if (!CHERRYIN_CONFIG.ALLOWED_HOSTS.includes(apiHost)) {
      throw new CherryINOAuthServiceError(`Unauthorized API host: ${apiHost}`)
    }
  }

  /**
   * Generate a cryptographically random string for PKCE code_verifier
   */
  private generateRandomString(length: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
    const bytes = randomBytes(length)
    return Array.from(bytes, (byte) => charset[byte % charset.length]).join('')
  }

  /**
   * Base64URL encode a buffer (no padding, URL-safe characters)
   */
  private base64UrlEncode(buffer: Buffer): string {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  /**
   * Generate PKCE code_challenge from code_verifier using S256 method
   */
  private generateCodeChallenge(codeVerifier: string): string {
    const hash = createHash('sha256').update(codeVerifier).digest()
    return this.base64UrlEncode(hash)
  }

  /**
   * Start OAuth flow - generates PKCE params and returns auth URL
   * @param oauthServer - OAuth server URL (e.g., https://open.cherryin.ai)
   * @param apiHost - API host URL (defaults to oauthServer)
   * @returns authUrl to open in browser and state for later verification
   */
  public startOAuthFlow = async (
    event: Electron.IpcMainInvokeEvent,
    oauthServer: string,
    apiHost?: string
  ): Promise<OAuthFlowParams> => {
    this.cleanupExpiredFlows()
    this.validateApiHost(oauthServer)

    const resolvedApiHost = apiHost ?? oauthServer
    if (apiHost) {
      this.validateApiHost(apiHost)
    }

    const initiatorWindowId = application.get('WindowManager').getWindowIdByWebContents(event.sender)
    if (!initiatorWindowId) {
      throw new CherryINOAuthServiceError('OAuth flow initiator is not a managed window')
    }

    // Generate PKCE parameters
    const codeVerifier = this.generateRandomString(64) // 43-128 chars per RFC 7636
    const codeChallenge = this.generateCodeChallenge(codeVerifier)
    const state = this.generateRandomString(32)

    // Store verifier and config for later use (keyed by state for CSRF protection)
    this.pendingOAuthFlows.set(state, {
      codeVerifier,
      oauthServer,
      apiHost: resolvedApiHost,
      timestamp: Date.now(),
      initiatorWindowId
    })
    await this.activate()

    // Build authorization URL
    const authUrl = new URL(`${oauthServer}/oauth2/auth`)
    authUrl.searchParams.set('client_id', CHERRYIN_CONFIG.CLIENT_ID)
    authUrl.searchParams.set('redirect_uri', CHERRYIN_CONFIG.REDIRECT_URI)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', CHERRYIN_CONFIG.SCOPES)
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')

    logger.debug('Started OAuth flow')

    return {
      authUrl: authUrl.toString(),
      state
    }
  }

  /**
   * Handle the OAuth deep-link callback (cherrystudio://oauth/callback?...).
   * Routed here from `ProtocolService` for the `oauth` host. Performs the PKCE
   * token exchange in the main process and pushes the result back to the
   * webContents that originally invoked `startOAuthFlow` — never broadcast.
   *
   * Failure modes (each terminates the flow, removes the pending entry, and
   * notifies the initiator if still alive):
   *   - missing/expired `state`     → silently dropped (CSRF / replay defense)
   *   - `error=...` in the URL      → propagated as `{ state, error }`
   *   - missing `code`              → propagated as `{ state, error }`
   *   - token exchange failure      → propagated as `{ state, error: message }`
   */
  public handleOAuthCallback = async (url: URL): Promise<void> => {
    const state = url.searchParams.get('state')
    const errorParam = url.searchParams.get('error')
    const code = url.searchParams.get('code')

    if (!state) {
      logger.warn('OAuth callback missing state parameter, ignoring')
      return
    }

    const flow = this.pendingOAuthFlows.get(state)
    if (!flow) {
      logger.warn('OAuth callback for unknown or expired state, ignoring')
      return
    }
    this.pendingOAuthFlows.delete(state)

    try {
      const initiator = this.resolveInitiatorWebContents(flow.initiatorWindowId)
      if (!initiator) {
        logger.warn('OAuth initiator window no longer available; dropping callback')
        return
      }

      if (errorParam) {
        const description = url.searchParams.get('error_description') || errorParam
        logger.error(`OAuth provider returned error: ${description}`)
        initiator.send(IpcChannel.CherryIN_OAuthResult, { state, error: description })
        return
      }

      if (!code) {
        initiator.send(IpcChannel.CherryIN_OAuthResult, { state, error: 'No authorization code received' })
        return
      }

      const apiKeys = await this.performTokenExchange(code, flow)
      initiator.send(IpcChannel.CherryIN_OAuthResult, { state, apiKeys })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Token exchange failed during OAuth callback', error as Error)
      const initiator = this.resolveInitiatorWebContents(flow.initiatorWindowId)
      if (initiator) {
        initiator.send(IpcChannel.CherryIN_OAuthResult, { state, error: message })
      }
    } finally {
      this.deactivateIfIdle()
    }
  }

  private resolveInitiatorWebContents(windowId: string): Electron.WebContents | null {
    const window = application.get('WindowManager').getWindow(windowId)
    if (!window || window.isDestroyed()) return null
    return window.webContents
  }

  /**
   * Exchange an authorization code for tokens and fetch the user's API keys.
   * Internal helper for `handleOAuthCallback` — renderer no longer drives this
   * step, so this is no longer an IPC entry point.
   */
  private performTokenExchange = async (code: string, flow: PendingOAuthFlow): Promise<string> => {
    const { codeVerifier, oauthServer, apiHost } = flow

    logger.debug('Exchanging code for token')

    try {
      const tokenResponse = await net.fetch(`${oauthServer}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CHERRYIN_CONFIG.CLIENT_ID,
          code,
          redirect_uri: CHERRYIN_CONFIG.REDIRECT_URI,
          code_verifier: codeVerifier
        }).toString()
      })

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text()
        logger.error('Token exchange failed', {
          status: tokenResponse.status,
          body: this.redactDiagnosticValue(errorText)
        })
        throw new CherryINOAuthServiceError(`Failed to exchange code for token: ${tokenResponse.status}`)
      }

      const tokenJson = await tokenResponse.json()
      const tokenData = TokenResponseSchema.parse(tokenJson)

      const { access_token: accessToken, refresh_token: refreshToken } = tokenData

      await this.saveTokenInternal(accessToken, refreshToken)
      logger.debug('Successfully obtained access token, fetching API keys')

      const apiKeysResponse = await net.fetch(`${apiHost}/api/v1/oauth/tokens`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })

      if (!apiKeysResponse.ok) {
        const errorText = await apiKeysResponse.text()
        logger.error('Failed to fetch API keys', {
          status: apiKeysResponse.status,
          body: this.redactDiagnosticValue(errorText)
        })
        throw new CherryINOAuthServiceError(`Failed to fetch API keys: ${apiKeysResponse.status}`)
      }

      const apiKeysJson = await apiKeysResponse.json()
      const keysArray = ApiKeysResponseSchema.parse(apiKeysJson)
      const apiKeys = keysArray.filter(Boolean).join(',')

      if (!apiKeys) {
        throw new CherryINOAuthServiceError('No API keys received')
      }

      logger.debug('Successfully obtained API keys')
      return apiKeys
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Invalid response format:', error.issues)
        throw new CherryINOAuthServiceError('Invalid response format from server', error)
      }
      throw error
    }
  }

  /**
   * Reset CherryIN provider authConfig back to api-key mode so hasToken() returns
   * false and the UI stops treating the session as live after refresh fails.
   */
  private clearOAuthSession = async (): Promise<void> => {
    await providerService.update(CHERRYIN_PROVIDER_ID, { authConfig: { type: 'api-key' } })
  }

  /**
   * Internal method to save OAuth tokens to the v2 provider auth config.
   */
  private saveTokenInternal = async (accessToken: string, refreshToken?: string): Promise<void> => {
    const currentConfig = await this.getOAuthAuthConfig()
    const nextRefreshToken = refreshToken || currentConfig?.refreshToken

    await providerService.update(CHERRYIN_PROVIDER_ID, {
      authConfig: {
        type: 'oauth',
        clientId: currentConfig?.clientId || CHERRYIN_CONFIG.CLIENT_ID,
        accessToken,
        ...(nextRefreshToken ? { refreshToken: nextRefreshToken } : {})
      }
    })
    logger.debug('Successfully saved CherryIN OAuth tokens to auth config')
  }

  /**
   * Save OAuth tokens to provider auth config (IPC handler)
   * @param accessToken - The access token to save
   * @param refreshToken - The refresh token to save (only updates if provided and non-empty)
   */
  public saveToken = async (
    _: Electron.IpcMainInvokeEvent,
    accessToken: string,
    refreshToken?: string
  ): Promise<void> => {
    try {
      await this.saveTokenInternal(accessToken, refreshToken)
    } catch (error) {
      logger.error('Failed to save token:', error as Error)
      throw new CherryINOAuthServiceError('Failed to save OAuth token', error)
    }
  }

  /**
   * Read OAuth access token from provider auth config
   */
  public getToken = async (): Promise<string | null> => {
    const authConfig = await this.getOAuthAuthConfig()
    return authConfig?.accessToken || null
  }

  /**
   * Read OAuth refresh token from provider auth config
   */
  private getRefreshToken = async (): Promise<string | null> => {
    const authConfig = await this.getOAuthAuthConfig()
    return authConfig?.refreshToken || null
  }

  /**
   * Check if OAuth token exists
   */
  public hasToken = async (): Promise<boolean> => {
    const token = await this.getToken()
    return !!token
  }

  /**
   * Refresh access token using refresh token
   */
  private doRefreshAccessToken = async (apiHost: string): Promise<TokenRefreshResult> => {
    try {
      const refreshToken = await this.getRefreshToken()
      if (!refreshToken) {
        logger.warn('No refresh token available')
        return { accessToken: null, attempted: false }
      }

      logger.info('Attempting to refresh access token')

      const response = await net.fetch(`${apiHost}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: CHERRYIN_CONFIG.CLIENT_ID
        }).toString()
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Token refresh failed', {
          status: response.status,
          body: this.redactDiagnosticValue(errorText)
        })
        return { accessToken: null, attempted: true }
      }

      const tokenJson = await response.json()
      const tokenData = TokenResponseSchema.parse(tokenJson)
      const { access_token: newAccessToken, refresh_token: newRefreshToken } = tokenData

      // Save new tokens using internal method
      await this.saveTokenInternal(newAccessToken, newRefreshToken)
      logger.info('Successfully refreshed access token')
      return { accessToken: newAccessToken, attempted: true }
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Invalid token refresh response format:', error.issues)
        return { accessToken: null, attempted: true }
      }
      logger.error('Failed to refresh token:', error as Error)
      return { accessToken: null, attempted: true }
    }
  }

  private refreshAccessToken = async (apiHost: string): Promise<TokenRefreshResult> => {
    if (this.refreshAccessTokenPromise) {
      logger.debug('Joining in-flight CherryIN OAuth token refresh')
      return this.refreshAccessTokenPromise
    }

    this.refreshAccessTokenPromise = this.doRefreshAccessToken(apiHost).finally(() => {
      this.refreshAccessTokenPromise = null
    })

    return this.refreshAccessTokenPromise
  }

  private redactDiagnosticValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value
        .replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
        .replace(/\b(refresh_token|access_token|code|client_secret)=([^&\s]+)/gi, '$1=<redacted>')
        .replace(/[\w-]*token["']?\s*:\s*["'][^"']+["']/gi, (match) =>
          match.replace(/:\s*["'][^"']+["']/, ': "<redacted>"')
        )
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.redactDiagnosticValue(item))
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          /token|authorization|api[-_]?key/i.test(key) ? '<redacted>' : this.redactDiagnosticValue(item)
        ])
      )
    }

    return value
  }

  private readResponseBodyForDiagnostics = async (response: Response): Promise<unknown> => {
    if (typeof response.clone !== 'function') {
      return null
    }

    try {
      const text = await response.clone().text()
      if (!text) {
        return null
      }

      try {
        return this.redactDiagnosticValue(JSON.parse(text))
      } catch {
        return this.redactDiagnosticValue(text)
      }
    } catch (error) {
      logger.warn('Failed to read CherryIN error response body for diagnostics:', error as Error)
      return null
    }
  }

  private logUnauthorizedResponse = async (
    apiHost: string,
    endpoint: string,
    response: Response,
    requestOptions: RequestInit
  ): Promise<void> => {
    logger.error('CherryIN request returned 401 Unauthorized', {
      stage: endpoint,
      request: {
        url: `${apiHost}${endpoint}`,
        method: requestOptions.method ?? 'GET',
        headers: this.redactDiagnosticValue(requestOptions.headers ?? {}),
        body: requestOptions.body ? this.redactDiagnosticValue(String(requestOptions.body)) : null
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: {},
        body: await this.readResponseBodyForDiagnostics(response)
      }
    })
  }

  /**
   * Make authenticated API request with automatic token refresh on 401
   */
  private authenticatedFetch = async (
    apiHost: string,
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    const token = await this.getToken()
    if (!token) {
      throw new CherryINOAuthServiceError('No OAuth token found')
    }

    const makeRequest = async (accessToken: string): Promise<Response> => {
      const requestOptions: RequestInit = {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }

      return net.fetch(`${apiHost}${endpoint}`, requestOptions)
    }

    let response = await makeRequest(token)

    // If 401, try to refresh token and retry once
    if (response.status === 401) {
      logger.info('Got 401, attempting token refresh')
      const refreshResult = await this.refreshAccessToken(apiHost)
      if (refreshResult.accessToken) {
        response = await makeRequest(refreshResult.accessToken)
      } else {
        // No usable access token after refresh — clear the OAuth session so the
        // UI stops reporting "logged in" and surface a typed error for the caller.
        await this.clearOAuthSession()
        throw new CherryINOAuthServiceError(
          refreshResult.attempted
            ? 'OAuth session expired: failed to refresh access token'
            : 'OAuth session expired: no refresh token available',
          undefined,
          'OAuthSessionExpired'
        )
      }
    }

    if (response.status === 401) {
      await this.logUnauthorizedResponse(apiHost, endpoint, response, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: 'Bearer <redacted>',
          'Content-Type': 'application/json'
        }
      })
    }

    return response
  }

  private getProfile = async (apiHost: string): Promise<CherryINProfile | null> => {
    try {
      const response = await this.authenticatedFetch(apiHost, '/api/user/self')

      if (!response.ok) {
        logger.warn(`Failed to fetch CherryIN profile: ${response.status} ${response.statusText}`)
        return null
      }

      const json = await response.json()
      return UserSelfResponseSchema.parse(json)
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('Failed to parse CherryIN profile response:', error.issues)
      } else {
        logger.warn('Failed to fetch CherryIN profile:', error as Error)
      }
      return null
    }
  }

  /**
   * Get user balance from CherryIN API
   */
  public getBalance = async (_: Electron.IpcMainInvokeEvent, apiHost: string): Promise<BalanceResponse> => {
    this.validateApiHost(apiHost)

    try {
      const response = await this.authenticatedFetch(apiHost, '/api/v1/oauth/balance')

      if (!response.ok) {
        throw new CherryINOAuthServiceError(`HTTP ${response.status} ${response.statusText} from /api/v1/oauth/balance`)
      }

      const json = await response.json()
      logger.debug('Balance API raw response:', json)
      const parsed = BalanceResponseSchema.parse(json)

      if (!parsed.success) {
        throw new CherryINOAuthServiceError('API returned success: false')
      }

      const { quota, used_quota: usedQuota } = parsed.data
      const profile = await this.getProfile(apiHost)
      // quota = remaining balance
      // Convert to USD: 500000 units = 1 USD
      const balance = quota / 500000
      const monthlySpend = usedQuota / 500000
      logger.info('Balance fetched successfully', { balance, usedQuota, monthlySpend })
      return {
        balance,
        profile,
        monthlyUsageTokens: null,
        monthlySpend
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Invalid balance response format:', error.issues)
        throw new CherryINOAuthServiceError('Invalid response format from server', error)
      }
      logger.error('Failed to get balance:', error as Error)
      const detail = error instanceof Error && error.message ? `: ${error.message}` : ''
      throw new CherryINOAuthServiceError(`Failed to get balance${detail}`, error)
    }
  }

  /**
   * Revoke OAuth token and clear it from provider auth config
   */
  public logout = async (_: Electron.IpcMainInvokeEvent, apiHost: string): Promise<void> => {
    this.validateApiHost(apiHost)

    try {
      const token = await this.getToken()

      // Try to revoke token on server (best effort, RFC 7009)
      if (token) {
        try {
          await net.fetch(`${apiHost}/oauth2/revoke`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              token: token,
              token_type_hint: 'access_token'
            }).toString()
          })
          logger.debug('Successfully revoked token on server')
        } catch (revokeError) {
          // Log but don't fail - we still want to clear local token
          logger.warn('Failed to revoke token on server:', revokeError as Error)
        }
      }

      // Reset to API-key mode so v2 runtime/UI stop treating this provider as OAuth-backed.
      await providerService.update(CHERRYIN_PROVIDER_ID, {
        authConfig: {
          type: 'api-key'
        }
      })
      logger.debug('Successfully cleared CherryIN OAuth tokens from auth config')
    } catch (error) {
      logger.error('Failed to logout:', error as Error)
      throw new CherryINOAuthServiceError('Failed to logout', error)
    }
  }
}
