import { loggerService } from '@logger'
import { net, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import * as z from 'zod'

import { getConfigDir } from '../utils/file'

const logger = loggerService.withContext('CherryINOAuthService')

const CONFIG = {
  TOKEN_FILE_NAME: '.cherryin_oauth_token'
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
  private readonly tokenFilePath: string

  constructor() {
    this.tokenFilePath = this.getTokenFilePath()
  }

  private getTokenFilePath = (): string => {
    return path.join(getConfigDir(), CONFIG.TOKEN_FILE_NAME)
  }

  /**
   * Save OAuth access token to local file (encrypted)
   */
  public saveToken = async (_: Electron.IpcMainInvokeEvent, token: string): Promise<void> => {
    try {
      const encryptedToken = safeStorage.encryptString(token)
      const dir = path.dirname(this.tokenFilePath)
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true })
      }
      await fs.promises.writeFile(this.tokenFilePath, encryptedToken)
      logger.debug('Successfully saved CherryIN OAuth token')
    } catch (error) {
      logger.error('Failed to save token:', error as Error)
      throw new CherryINOAuthServiceError('Failed to save OAuth token', error)
    }
  }

  /**
   * Read OAuth access token from local file (decrypted)
   */
  public getToken = async (): Promise<string | null> => {
    try {
      if (!fs.existsSync(this.tokenFilePath)) {
        return null
      }
      const encryptedToken = await fs.promises.readFile(this.tokenFilePath)
      return safeStorage.decryptString(Buffer.from(encryptedToken))
    } catch (error) {
      logger.error('Failed to read token:', error as Error)
      return null
    }
  }

  /**
   * Check if OAuth token exists
   */
  public hasToken = async (): Promise<boolean> => {
    return fs.existsSync(this.tokenFilePath)
  }

  /**
   * Get user balance from CherryIN API
   */
  public getBalance = async (_: Electron.IpcMainInvokeEvent, apiHost: string): Promise<BalanceResponse> => {
    try {
      const token = await this.getToken()
      if (!token) {
        throw new CherryINOAuthServiceError('No OAuth token found')
      }

      const response = await net.fetch(`${apiHost}/api/v1/oauth/balance`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

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
      const token = await this.getToken()
      if (!token) {
        throw new CherryINOAuthServiceError('No OAuth token found')
      }

      const response = await net.fetch(`${apiHost}/api/v1/oauth/usage`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

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
      const token = await this.getToken()
      if (!token) {
        throw new CherryINOAuthServiceError('No OAuth token found')
      }

      const response = await net.fetch(`${apiHost}/api/v1/oauth/userinfo`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

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
   * Revoke OAuth token and delete local token file
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
          // Log but don't fail - we still want to delete local token
          logger.warn('Failed to revoke token on server:', revokeError as Error)
        }
      }

      // Delete local token file
      if (fs.existsSync(this.tokenFilePath)) {
        await fs.promises.unlink(this.tokenFilePath)
        logger.debug('Successfully deleted local token file')
      }
    } catch (error) {
      logger.error('Failed to logout:', error as Error)
      throw new CherryINOAuthServiceError('Failed to logout', error)
    }
  }
}

export default new CherryINOAuthService()
