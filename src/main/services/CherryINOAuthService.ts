import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { CHERRYIN_CONFIG } from '@shared/config/constant'
import type { AuthConfig } from '@shared/data/types/provider'
import { IpcChannel } from '@shared/IpcChannel'
import { createHash, randomBytes } from 'crypto'
import { net, webContents } from 'electron'
import * as z from 'zod'

const logger = loggerService.withContext('CherryINOAuthService')
const CHERRYIN_PROVIDER_ID = 'cherryin'
const SENSITIVE_FIELD_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'api-key',
  'api_key',
  'apikey',
  'x-api-key',
  'key',
  'token',
  'access_token',
  'refresh_token',
  'code',
  'code_verifier',
  'client_secret',
  'password'
])

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
    z.object({ data: UserSelfProfileSchema.nullable().optional() }).transform((payload) => payload.data ?? null),
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

class CherryINOAuthServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'CherryINOAuthServiceError'
  }
}

class CherryINHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly endpoint: string
  ) {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ''} from ${endpoint}`)
    this.name = 'CherryINHttpError'
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

function isSensitiveFieldName(name: string): boolean {
  const normalized = name.toLowerCase()
  return (
    SENSITIVE_FIELD_NAMES.has(normalized) ||
    normalized.includes('authorization') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('api-key') ||
    normalized.includes('api_key')
  )
}

function redactSensitiveValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  if (!value) {
    return '<empty>'
  }

  const prefix = value.slice(0, Math.min(6, value.length))
  const suffix = value.length > 10 ? value.slice(-4) : ''
  return suffix
    ? `${prefix}...${suffix} (redacted, length=${value.length})`
    : `${prefix}... (redacted, length=${value.length})`
}

function sanitizeStructuredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStructuredValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveFieldName(key) ? redactSensitiveValue(item) : sanitizeStructuredValue(item)
      ])
    )
  }

  return value
}

function serializeHeaders(headers?: HeadersInit): Record<string, unknown> {
  if (!headers) {
    return {}
  }

  const entries: [string, unknown][] = []

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => entries.push([key, value]))
  } else if (Array.isArray(headers)) {
    entries.push(...headers)
  } else {
    entries.push(...Object.entries(headers))
  }

  return Object.fromEntries(
    entries.map(([key, value]) => [key, isSensitiveFieldName(key) ? redactSensitiveValue(value) : value])
  )
}

function serializeRequestBody(body: RequestInit['body']): unknown {
  if (body == null) {
    return null
  }

  if (typeof body === 'string') {
    const trimmed = body.trim()

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return sanitizeStructuredValue(JSON.parse(trimmed))
      } catch {
        return body
      }
    }

    if (body.includes('=')) {
      const params = new URLSearchParams(body)
      return Object.fromEntries(
        Array.from(params.entries()).map(([key, value]) => [
          key,
          isSensitiveFieldName(key) ? redactSensitiveValue(value) : value
        ])
      )
    }

    return body
  }

  if (body instanceof URLSearchParams) {
    return Object.fromEntries(
      Array.from(body.entries()).map(([key, value]) => [
        key,
        isSensitiveFieldName(key) ? redactSensitiveValue(value) : value
      ])
    )
  }

  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return Object.fromEntries(
      Array.from(body.entries()).map(([key, value]) => [
        key,
        isSensitiveFieldName(key)
          ? redactSensitiveValue(value)
          : typeof File !== 'undefined' && value instanceof File
            ? `[File: ${value.name}]`
            : value
      ])
    )
  }

  if (body instanceof ArrayBuffer) {
    return `[ArrayBuffer: ${body.byteLength} bytes]`
  }

  if (ArrayBuffer.isView(body)) {
    return `[${body.constructor.name}: ${body.byteLength} bytes]`
  }

  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return `[Blob: ${body.size} bytes${body.type ? `, ${body.type}` : ''}]`
  }

  return `[${body.constructor.name}]`
}

function createRequestLogContext(url: string, options: RequestInit): Record<string, unknown> {
  const requestUrl = new URL(url)
  const sanitizedUrl = new URL(url)
  const query = Object.fromEntries(
    Array.from(requestUrl.searchParams.entries()).map(([key, value]) => [
      key,
      isSensitiveFieldName(key) ? redactSensitiveValue(value) : value
    ])
  )

  for (const [key, value] of Object.entries(query)) {
    sanitizedUrl.searchParams.set(key, String(value))
  }

  return {
    url: sanitizedUrl.toString(),
    method: options.method ?? 'GET',
    query,
    headers: serializeHeaders(options.headers),
    body: serializeRequestBody(options.body)
  }
}

function serializeResponseBodyForLog(body: string | null): unknown {
  if (body == null || body === '') {
    return body
  }

  const trimmed = body.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return sanitizeStructuredValue(JSON.parse(trimmed))
    } catch {
      return body
    }
  }

  return body
}

async function readResponseTextForLog(response: Response, fallback?: string): Promise<string | null> {
  if (fallback !== undefined) {
    return fallback
  }

  try {
    if (typeof response.clone === 'function') {
      return await response.clone().text()
    }
  } catch (error) {
    logger.warn('Failed to read cloned 401 response body for logging:', error as Error)
  }

  return null
}

async function logUnauthorizedResponse(
  stage: string,
  request: Record<string, unknown>,
  response: Response,
  responseBody?: string
): Promise<void> {
  const body = await readResponseTextForLog(response, responseBody)
  const diagnostic = {
    stage,
    request,
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: serializeHeaders(response.headers),
      body: serializeResponseBodyForLog(body)
    }
  }

  logger.error('CherryIN request returned 401 Unauthorized', diagnostic)
  console.error('[CherryINOAuthService] CherryIN request returned 401 Unauthorized', diagnostic)
}

// Store pending OAuth flows with PKCE verifiers (keyed by state parameter).
// initiatorWebContentsId is captured at startOAuthFlow time so the protocol
// callback can be delivered point-to-point to the originating renderer instead
// of being broadcast to every window.
interface PendingOAuthFlow {
  codeVerifier: string
  oauthServer: string
  apiHost: string
  timestamp: number
  initiatorWebContentsId: number
}

const pendingOAuthFlows = new Map<string, PendingOAuthFlow>()

// Clean up expired flows (older than 10 minutes)
function cleanupExpiredFlows(): void {
  const now = Date.now()
  for (const [state, flow] of pendingOAuthFlows.entries()) {
    if (now - flow.timestamp > 10 * 60 * 1000) {
      pendingOAuthFlows.delete(state)
    }
  }
}

class CherryINOAuthService {
  private getOAuthAuthConfig = async (): Promise<Extract<AuthConfig, { type: 'oauth' }> | null> => {
    try {
      const authConfig = await providerService.getAuthConfig(CHERRYIN_PROVIDER_ID)
      return authConfig?.type === 'oauth' ? authConfig : null
    } catch (error) {
      logger.error('Failed to read CherryIN auth config:', error as Error)
      return null
    }
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
    cleanupExpiredFlows()
    this.validateApiHost(oauthServer)

    const resolvedApiHost = apiHost ?? oauthServer
    if (apiHost) {
      this.validateApiHost(apiHost)
    }

    // Generate PKCE parameters
    const codeVerifier = this.generateRandomString(64) // 43-128 chars per RFC 7636
    const codeChallenge = this.generateCodeChallenge(codeVerifier)
    const state = this.generateRandomString(32)

    // Store verifier and config for later use (keyed by state for CSRF protection)
    pendingOAuthFlows.set(state, {
      codeVerifier,
      oauthServer,
      apiHost: resolvedApiHost,
      timestamp: Date.now(),
      initiatorWebContentsId: event.sender.id
    })

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

    const flow = pendingOAuthFlows.get(state)
    if (!flow) {
      logger.warn('OAuth callback for unknown or expired state, ignoring')
      return
    }
    pendingOAuthFlows.delete(state)

    const initiator = webContents.fromId(flow.initiatorWebContentsId)
    if (!initiator || initiator.isDestroyed()) {
      logger.warn('OAuth initiator webContents no longer available; dropping callback')
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

    try {
      const apiKeys = await this.performTokenExchange(code, flow)
      initiator.send(IpcChannel.CherryIN_OAuthResult, { state, apiKeys })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Token exchange failed during OAuth callback', error as Error)
      initiator.send(IpcChannel.CherryIN_OAuthResult, { state, error: message })
    }
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
      const tokenRequestUrl = `${oauthServer}/oauth2/token`
      const tokenRequestOptions: RequestInit = {
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
      }
      const tokenResponse = await net.fetch(tokenRequestUrl, tokenRequestOptions)

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text()
        if (tokenResponse.status === 401) {
          await logUnauthorizedResponse(
            'performTokenExchange.token',
            createRequestLogContext(tokenRequestUrl, tokenRequestOptions),
            tokenResponse,
            errorText
          )
        }
        logger.error(`Token exchange failed: ${tokenResponse.status} ${errorText}`)
        throw new CherryINOAuthServiceError(`Failed to exchange code for token: ${tokenResponse.status}`)
      }

      const tokenJson = await tokenResponse.json()
      const tokenData = TokenResponseSchema.parse(tokenJson)

      const { access_token: accessToken, refresh_token: refreshToken } = tokenData

      await this.saveTokenInternal(accessToken, refreshToken)
      logger.debug('Successfully obtained access token, fetching API keys')

      const apiKeysRequestUrl = `${apiHost}/api/v1/oauth/tokens`
      const apiKeysRequestOptions: RequestInit = {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
      const apiKeysResponse = await net.fetch(apiKeysRequestUrl, apiKeysRequestOptions)

      if (!apiKeysResponse.ok) {
        const errorText = await apiKeysResponse.text()
        if (apiKeysResponse.status === 401) {
          await logUnauthorizedResponse(
            'performTokenExchange.apiKeys',
            createRequestLogContext(apiKeysRequestUrl, apiKeysRequestOptions),
            apiKeysResponse,
            errorText
          )
        }
        logger.error(`Failed to fetch API keys: ${apiKeysResponse.status} ${errorText}`)
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
  private refreshAccessToken = async (apiHost: string): Promise<string | null> => {
    try {
      const refreshToken = await this.getRefreshToken()
      if (!refreshToken) {
        logger.warn('No refresh token available')
        return null
      }

      logger.info('Attempting to refresh access token')

      const requestUrl = `${apiHost}/oauth2/token`
      const requestOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: CHERRYIN_CONFIG.CLIENT_ID
        }).toString()
      }
      const response = await net.fetch(requestUrl, requestOptions)

      if (!response.ok) {
        const errorText = await response.text()
        if (response.status === 401) {
          await logUnauthorizedResponse(
            'refreshAccessToken',
            createRequestLogContext(requestUrl, requestOptions),
            response,
            errorText
          )
        }
        logger.error(`Token refresh failed: ${response.status} ${errorText}`)
        return null
      }

      const tokenJson = await response.json()
      const tokenData = TokenResponseSchema.parse(tokenJson)
      const { access_token: newAccessToken, refresh_token: newRefreshToken } = tokenData

      // Save new tokens using internal method
      await this.saveTokenInternal(newAccessToken, newRefreshToken)
      logger.info('Successfully refreshed access token')
      return newAccessToken
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Invalid token refresh response format:', error.issues)
        return null
      }
      logger.error('Failed to refresh token:', error as Error)
      return null
    }
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
      const requestUrl = `${apiHost}${endpoint}`
      const requestOptions: RequestInit = {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }

      const response = await net.fetch(requestUrl, requestOptions)

      if (response.status === 401) {
        await logUnauthorizedResponse(endpoint, createRequestLogContext(requestUrl, requestOptions), response)
      }

      return response
    }

    let response = await makeRequest(token)

    // If 401, try to refresh token and retry once
    if (response.status === 401) {
      logger.info('Got 401, attempting token refresh')
      const newToken = await this.refreshAccessToken(apiHost)
      if (newToken) {
        response = await makeRequest(newToken)
      }
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
        throw new CherryINHttpError(response.status, response.statusText, '/api/v1/oauth/balance')
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
      throw new CherryINOAuthServiceError(`Failed to get balance: ${getErrorMessage(error)}`, error)
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

export const cherryINOAuthService = new CherryINOAuthService()
