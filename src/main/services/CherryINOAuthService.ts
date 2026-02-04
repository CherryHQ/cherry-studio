import { loggerService } from '@logger'
import { net } from 'electron'
import * as z from 'zod'

import { reduxService } from './ReduxService'

const logger = loggerService.withContext('CherryINOAuthService')

const CONFIG = {
  CLIENT_ID: '2a348c87-bae1-4756-a62f-b2e97200fd6d'
}

// Zod schemas for API response validation
const UserInfoDataSchema = z.object({
  id: z.number(),
  username: z.string(),
  display_name: z.string().optional(),
  email: z.string(),
  group: z.string().optional()
})

const UserInfoResponseSchema = z.object({
  success: z.boolean(),
  data: UserInfoDataSchema
})

const BalanceDataSchema = z.object({
  quota: z.number(),
  used_quota: z.number()
})

const BalanceResponseSchema = z.object({
  success: z.boolean(),
  data: BalanceDataSchema
})

const UsageDataSchema = z.object({
  request_count: z.number(),
  used_quota: z.number(),
  quota: z.number()
})

const UsageResponseSchema = z.object({
  success: z.boolean(),
  data: UsageDataSchema
})

// Export types for use in other modules
export interface BalanceResponse {
  balance: number
}

export interface UsageResponse {
  requestCount: number
  usedPercent: number
}

export interface UserInfoResponse {
  id: number
  username: string
  displayName?: string
  email: string
  group?: string
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

class CherryINOAuthService {
  /**
   * Save OAuth tokens to Redux store
   * @param accessToken - The access token to save
   * @param refreshToken - The refresh token to save (only updates if provided and non-empty)
   */
  public saveToken = async (
    _: Electron.IpcMainInvokeEvent,
    accessToken: string,
    refreshToken?: string
  ): Promise<void> => {
    try {
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
          client_id: CONFIG.CLIENT_ID
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
        // Save new tokens
        await this.saveToken({} as Electron.IpcMainInvokeEvent, newAccessToken, newRefreshToken)
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
    try {
      const response = await this.authenticatedFetch(apiHost, '/api/v1/oauth/balance')

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const json = await response.json()
      logger.info('Balance API raw response:', json)
      const parsed = BalanceResponseSchema.parse(json)

      if (!parsed.success) {
        throw new CherryINOAuthServiceError('API returned success: false')
      }

      const { quota, used_quota } = parsed.data
      // quota = remaining balance, used_quota = amount used
      // Convert to USD: 500000 units = 1 USD
      const balanceYuan = quota / 500000
      logger.info('Balance API parsed data:', { quota, used_quota, balanceYuan })
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
   * Get user usage from CherryIN API
   */
  public getUsage = async (_: Electron.IpcMainInvokeEvent, apiHost: string): Promise<UsageResponse> => {
    try {
      const response = await this.authenticatedFetch(apiHost, '/api/v1/oauth/usage')

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const json = await response.json()
      logger.info('Usage API raw response:', json)
      const parsed = UsageResponseSchema.parse(json)

      if (!parsed.success) {
        throw new CherryINOAuthServiceError('API returned success: false')
      }

      const { quota, used_quota, request_count } = parsed.data
      // quota = remaining, used_quota = used, total = quota + used_quota
      const total = quota + used_quota
      const usedPercent = total > 0 ? Math.round((used_quota / total) * 10000) / 100 : 0
      logger.info('Usage API parsed data:', { quota, used_quota, total, request_count, usedPercent })

      return {
        requestCount: request_count,
        usedPercent: usedPercent
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Invalid usage response format:', error.issues)
        throw new CherryINOAuthServiceError('Invalid response format from server', error)
      }
      logger.error('Failed to get usage:', error as Error)
      throw new CherryINOAuthServiceError('Failed to get usage', error)
    }
  }

  /**
   * Get user info from CherryIN API
   */
  public getUserInfo = async (_: Electron.IpcMainInvokeEvent, apiHost: string): Promise<UserInfoResponse> => {
    try {
      const response = await this.authenticatedFetch(apiHost, '/api/v1/oauth/userinfo')

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const json = await response.json()
      const parsed = UserInfoResponseSchema.parse(json)

      if (!parsed.success) {
        throw new CherryINOAuthServiceError('API returned success: false')
      }

      return {
        id: parsed.data.id,
        username: parsed.data.username,
        displayName: parsed.data.display_name,
        email: parsed.data.email,
        group: parsed.data.group
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Invalid user info response format:', error.issues)
        throw new CherryINOAuthServiceError('Invalid response format from server', error)
      }
      logger.error('Failed to get user info:', error as Error)
      throw new CherryINOAuthServiceError('Failed to get user info', error)
    }
  }

  /**
   * Revoke OAuth token and clear from Redux store
   */
  public logout = async (_: Electron.IpcMainInvokeEvent, apiHost: string): Promise<void> => {
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
