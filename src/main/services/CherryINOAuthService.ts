import { loggerService } from '@logger'
import { CHERRYIN_CONFIG } from '@shared/config/constant'
import { createHash, randomBytes } from 'crypto'
import { net } from 'electron'
import * as z from 'zod'

import { reduxService } from './ReduxService'

const logger = loggerService.withContext('CherryINOAuthService')

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

// Export types for use in other modules
export interface BalanceResponse {
  balance: number
}

export interface OAuthFlowParams {
  authUrl: string
  state: string
}

export interface TokenExchangeResult {
  apiKeys: string
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

// Store pending OAuth flows with PKCE verifiers (keyed by state parameter)
interface PendingOAuthFlow {
  codeVerifier: string
  oauthServer: string
  apiHost: string
  timestamp: number
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
    _: Electron.IpcMainInvokeEvent,
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
      timestamp: Date.now()
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
   * Exchange authorization code for tokens and fetch API keys
   * @param code - Authorization code from OAuth callback
   * @param state - State parameter for CSRF protection and flow lookup
   * @returns API keys string
   */
  public exchangeToken = async (
    _: Electron.IpcMainInvokeEvent,
    code: string,
    state: string
  ): Promise<TokenExchangeResult> => {
    // Retrieve stored code_verifier and config
    const flowData = pendingOAuthFlows.get(state)
    if (!flowData) {
      throw new CherryINOAuthServiceError('OAuth flow expired or not found')
    }
    pendingOAuthFlows.delete(state)

    const { codeVerifier, oauthServer, apiHost } = flowData

    logger.debug('Exchanging code for token')

    try {
      // Exchange authorization code for access token
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
        logger.error(`Token exchange failed: ${tokenResponse.status} ${errorText}`)
        throw new CherryINOAuthServiceError(`Failed to exchange code for token: ${tokenResponse.status}`)
      }

      const tokenJson = await tokenResponse.json()
      logger.debug('Token exchange raw response:', tokenJson)
      const tokenData = TokenResponseSchema.parse(tokenJson)

      const { access_token: accessToken, refresh_token: refreshToken } = tokenData

      // Save tokens using internal method
      await this.saveTokenInternal(accessToken, refreshToken)
      logger.debug('Successfully obtained access token, fetching API keys')

      // Fetch API keys using the access token
      const apiKeysResponse = await net.fetch(`${apiHost}/api/v1/oauth/tokens`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })

      if (!apiKeysResponse.ok) {
        const errorText = await apiKeysResponse.text()
        logger.error(`Failed to fetch API keys: ${apiKeysResponse.status} ${errorText}`)
        throw new CherryINOAuthServiceError(`Failed to fetch API keys: ${apiKeysResponse.status}`)
      }

      const apiKeysJson = await apiKeysResponse.json()
      logger.debug('API keys raw response:', apiKeysJson)
      // Schema transforms and extracts keys to string array
      const keysArray = ApiKeysResponseSchema.parse(apiKeysJson)
      const apiKeys = keysArray.filter(Boolean).join(',')

      if (!apiKeys) {
        throw new CherryINOAuthServiceError('No API keys received')
      }

      logger.debug('Successfully obtained API keys')
      return { apiKeys }
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Invalid response format:', error.issues)
        throw new CherryINOAuthServiceError('Invalid response format from server', error)
      }
      throw error
    }
  }

  /**
   * Internal method to save OAuth tokens to Redux store
   */
  private saveTokenInternal = async (accessToken: string, refreshToken?: string): Promise<void> => {
    // Only include refreshToken in payload if it's provided and non-empty
    // This prevents clearing the existing refresh token when server doesn't return a new one
    const payload: { accessToken: string; refreshToken?: string } = { accessToken }
    if (refreshToken) {
      payload.refreshToken = refreshToken
    }
    await reduxService.dispatch({
      type: 'llm/setCherryInTokens',
      payload
    })
    logger.debug('Successfully saved CherryIN OAuth tokens to Redux')
  }

  /**
   * Save OAuth tokens to Redux store (IPC handler)
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
   * Read OAuth access token from Redux store
   */
  public getToken = async (): Promise<string | null> => {
    try {
      const token = await reduxService.select<string>('state.llm.settings.cherryIn.accessToken')
      return token || null
    } catch (error) {
      logger.error('Failed to read token:', error as Error)
      return null
    }
  }

  /**
   * Read OAuth refresh token from Redux store
   */
  private getRefreshToken = async (): Promise<string | null> => {
    try {
      const token = await reduxService.select<string>('state.llm.settings.cherryIn.refreshToken')
      return token || null
    } catch (error) {
      logger.error('Failed to read refresh token:', error as Error)
      return null
    }
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
        logger.error(`Token refresh failed: ${response.status} ${errorText}`)
        return null
      }

      const tokenData = await response.json()
      const newAccessToken = tokenData.access_token
      const newRefreshToken = tokenData.refresh_token

      if (newAccessToken) {
        // Save new tokens using internal method
        await this.saveTokenInternal(newAccessToken, newRefreshToken)
        logger.info('Successfully refreshed access token')
        return newAccessToken
      }

      return null
    } catch (error) {
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
      return net.fetch(`${apiHost}${endpoint}`, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      })
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

  /**
   * Get user balance from CherryIN API
   */
  public getBalance = async (_: Electron.IpcMainInvokeEvent, apiHost: string): Promise<BalanceResponse> => {
    this.validateApiHost(apiHost)

    try {
      const response = await this.authenticatedFetch(apiHost, '/api/v1/oauth/balance')

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const json = await response.json()
      logger.debug('Balance API raw response:', json)
      const parsed = BalanceResponseSchema.parse(json)

      if (!parsed.success) {
        throw new CherryINOAuthServiceError('API returned success: false')
      }

      const { quota } = parsed.data
      // quota = remaining balance
      // Convert to USD: 500000 units = 1 USD
      const balanceYuan = quota / 500000
      logger.info('Balance fetched successfully', { balanceYuan })
      return {
        balance: balanceYuan
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Invalid balance response format:', error.issues)
        throw new CherryINOAuthServiceError('Invalid response format from server', error)
      }
      logger.error('Failed to get balance:', error as Error)
      throw new CherryINOAuthServiceError('Failed to get balance', error)
    }
  }

  /**
   * Revoke OAuth token and clear from Redux store
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

      // Clear tokens from Redux store
      await reduxService.dispatch({
        type: 'llm/clearCherryInTokens'
      })
      logger.debug('Successfully cleared CherryIN OAuth tokens from Redux')
    } catch (error) {
      logger.error('Failed to logout:', error as Error)
      throw new CherryINOAuthServiceError('Failed to logout', error)
    }
  }
}

export default new CherryINOAuthService()
