import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import { net } from 'electron'
import * as z from 'zod'

import {
  CHERRYIN_PROVIDER_ID,
  CherryInOauthServiceError,
  validateCherryInApiHost
} from './CherryInOAuthConfig'

const logger = loggerService.withContext('CherryInOauthService')

const BalanceDataSchema = z.object({
  quota: z.number(),
  used_quota: z.number()
})

const BalanceResponseSchema = z.object({
  success: z.boolean(),
  data: BalanceDataSchema
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

export interface OauthFlowParams {
  authUrl: string
  state: string
}

@Injectable('CherryInOauthService')
@ServicePhase(Phase.Background)
export class CherryInOauthService extends BaseService {
  protected onInit(): void {
    this.registerIpcHandlers()
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.CherryIN_SaveToken, this.saveToken)
    this.ipcHandle(IpcChannel.CherryIN_HasToken, this.hasToken)
    this.ipcHandle(IpcChannel.CherryIN_GetBalance, this.getBalance)
    this.ipcHandle(IpcChannel.CherryIN_Logout, this.logout)
    this.ipcHandle(IpcChannel.CherryIN_StartOAuthFlow, this.startOAuthFlow)
  }

  private validateApiHost(apiHost: string): void {
    validateCherryInApiHost(apiHost)
  }

  public startOAuthFlow = async (
    event: Electron.IpcMainInvokeEvent,
    oauthServer: string,
    apiHost?: string
  ): Promise<OauthFlowParams> => {
    this.validateApiHost(oauthServer)
    if (apiHost) this.validateApiHost(apiHost)

    return application.get('OAuthRuntimeService').startDeepLinkFlow(event, CHERRYIN_PROVIDER_ID, {
      oauthServer,
      apiHost: apiHost ?? oauthServer
    })
  }

  public saveToken = async (
    _: Electron.IpcMainInvokeEvent,
    accessToken: string,
    refreshToken?: string
  ): Promise<void> => {
    try {
      await application.get('OAuthRuntimeService').saveTokens(CHERRYIN_PROVIDER_ID, {
        accessToken,
        ...(refreshToken ? { refreshToken } : {})
      })
    } catch (error) {
      logger.error('Failed to save token:', error as Error)
      throw new CherryInOauthServiceError('Failed to save OAuth token', error)
    }
  }

  public getToken = async (apiHost = 'https://open.cherryin.ai'): Promise<string | null> => {
    this.validateApiHost(apiHost)
    const credentials = await application.get('OAuthRuntimeService').getValidAccessToken(CHERRYIN_PROVIDER_ID, { apiHost })
    return credentials?.accessToken ?? null
  }

  public hasToken = async (): Promise<boolean> => {
    return application.get('OAuthRuntimeService').hasToken(CHERRYIN_PROVIDER_ID)
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

  private authenticatedFetch = async (
    apiHost: string,
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    const getCredentials = async (forceRefresh = false): Promise<{ accessToken: string } | null> => {
      const credentials = await application
        .get('OAuthRuntimeService')
        .getValidAccessToken(CHERRYIN_PROVIDER_ID, { apiHost, forceRefresh })
      return credentials?.accessToken ? { accessToken: credentials.accessToken } : null
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

    const credentials = await getCredentials()
    if (!credentials) {
      throw new CherryInOauthServiceError(
        'OAuth session expired: failed to refresh access token',
        undefined,
        'OAuthSessionExpired'
      )
    }

    let response = await makeRequest(credentials.accessToken)

    if (response.status === 401) {
      logger.info('Got 401, forcing CherryIN OAuth token refresh')
      const refreshedCredentials = await getCredentials(true)
      if (refreshedCredentials) {
        response = await makeRequest(refreshedCredentials.accessToken)
      } else {
        throw new CherryInOauthServiceError(
          'OAuth session expired: failed to refresh access token',
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
        logger.warn('Failed to fetch CherryIN profile', {
          status: response.status,
          statusText: response.statusText,
          body: await this.readResponseBodyForDiagnostics(response)
        })
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

  public getBalance = async (_: Electron.IpcMainInvokeEvent, apiHost: string): Promise<BalanceResponse> => {
    this.validateApiHost(apiHost)

    try {
      const response = await this.authenticatedFetch(apiHost, '/api/v1/oauth/balance')

      if (!response.ok) {
        throw new CherryInOauthServiceError(`HTTP ${response.status} ${response.statusText} from /api/v1/oauth/balance`)
      }

      const json = await response.json()
      logger.debug('Balance API raw response:', json)
      const parsed = BalanceResponseSchema.parse(json)

      if (!parsed.success) {
        throw new CherryInOauthServiceError('API returned success: false')
      }

      const { quota, used_quota: usedQuota } = parsed.data
      const profile = await this.getProfile(apiHost)
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
        throw new CherryInOauthServiceError('Invalid response format from server', error)
      }
      logger.error('Failed to get balance:', error as Error)
      const detail = error instanceof Error && error.message ? `: ${error.message}` : ''
      throw new CherryInOauthServiceError(`Failed to get balance${detail}`, error)
    }
  }

  public logout = async (_: Electron.IpcMainInvokeEvent, apiHost: string): Promise<void> => {
    this.validateApiHost(apiHost)

    try {
      const token = await this.getToken(apiHost)

      if (token) {
        try {
          await net.fetch(`${apiHost}/oauth2/revoke`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              token,
              token_type_hint: 'access_token'
            }).toString()
          })
          logger.debug('Successfully revoked token on server')
        } catch (revokeError) {
          logger.warn('Failed to revoke token on server:', revokeError as Error)
        }
      }

      await application.get('OAuthRuntimeService').logout(CHERRYIN_PROVIDER_ID)
      logger.debug('Successfully cleared CherryIN OAuth tokens from auth config')
    } catch (error) {
      logger.error('Failed to logout:', error as Error)
      throw new CherryInOauthServiceError('Failed to logout', error)
    }
  }
}
