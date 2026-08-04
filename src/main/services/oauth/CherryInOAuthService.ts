import { application } from '@application'
import { loggerService } from '@logger'
import type { CherryInBalance, CherryInProfile } from '@shared/ipc/schemas/cherryin'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import { net } from 'electron'
import * as z from 'zod'

import { CherryInOAuthServiceError, validateCherryInApiHost } from './CherryInOAuthConfig'
import { describeOAuthError, OAuthTransientError } from './errors'

const logger = loggerService.withContext('CherryInOAuthService')

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
  .transform((payload): CherryInProfile | null => {
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

/**
 * CherryIN's REST operations (balance/profile/logout) layered over the OAuth
 * session that `OAuthRuntimeService` owns. Stateless orchestration — owns no
 * long-lived resources and registers no side effects — so it is a direct-import
 * singleton, not a lifecycle service (see lifecycle-decision-guide.md).
 */
export class CherryInOAuthService {
  private validateApiHost(apiHost: string): void {
    validateCherryInApiHost(apiHost)
  }

  public getToken = async (apiHost = 'https://open.cherryin.ai'): Promise<string | null> => {
    this.validateApiHost(apiHost)
    try {
      const credentials = await application
        .get('OAuthRuntimeService')
        .getValidAccessToken(SystemProviderIds.cherryin, { apiHost })
      return credentials?.accessToken ?? null
    } catch (error) {
      // A transient refresh failure means the session is still valid but we
      // can't produce a token right now. The sole caller is logout, which must
      // still clear the local session — treat it as "no token to revoke".
      if (error instanceof OAuthTransientError) {
        logger.debug('CherryIN token temporarily unavailable, skipping remote revoke', describeOAuthError(error))
        return null
      }
      throw error
    }
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

  // Token fetch, the not-signed-in guard and the 401 force-refresh+retry live in
  // OAuthRuntimeService.authenticatedFetch (shared with Codex/Grok). CherryIN only
  // shapes the request (apiHost + bearer/json headers), threads its `apiHost`
  // context for refresh, and supplies the 401 diagnostic log.
  private authenticatedFetch = (apiHost: string, endpoint: string, options: RequestInit = {}): Promise<Response> => {
    return application.get('OAuthRuntimeService').authenticatedFetch(
      SystemProviderIds.cherryin,
      (creds) => ({
        input: `${apiHost}${endpoint}`,
        init: {
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      }),
      (input, init) => net.fetch(input as RequestInfo, init),
      {
        context: { apiHost },
        notSignedInMessage: 'OAuth session expired: failed to refresh access token',
        onUnauthorized: (response) =>
          this.logUnauthorizedResponse(apiHost, endpoint, response, {
            ...options,
            headers: {
              ...options.headers,
              Authorization: 'Bearer <redacted>',
              'Content-Type': 'application/json'
            }
          })
      }
    )
  }

  private getProfile = async (apiHost: string): Promise<CherryInProfile | null> => {
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

  public getBalance = async (apiHost: string): Promise<CherryInBalance> => {
    this.validateApiHost(apiHost)

    try {
      const response = await this.authenticatedFetch(apiHost, '/api/v1/oauth/balance')

      if (!response.ok) {
        throw new CherryInOAuthServiceError(`HTTP ${response.status} ${response.statusText} from /api/v1/oauth/balance`)
      }

      const json = await response.json()
      logger.debug('Balance API raw response:', json)
      const parsed = BalanceResponseSchema.parse(json)

      if (!parsed.success) {
        throw new CherryInOAuthServiceError('API returned success: false')
      }

      const { quota, used_quota: usedQuota } = parsed.data
      const profile = await this.getProfile(apiHost)
      const balance = quota / 500000
      logger.info('Balance fetched successfully', { balance, usedQuota })
      return {
        balance,
        profile
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Invalid balance response format:', error.issues)
        throw new CherryInOAuthServiceError('Invalid response format from server', error)
      }
      logger.error('Failed to get balance:', error as Error)
      const detail = error instanceof Error && error.message ? `: ${error.message}` : ''
      throw new CherryInOAuthServiceError(`Failed to get balance${detail}`, error)
    }
  }

  public logout = async (apiHost: string): Promise<void> => {
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

      await application.get('OAuthRuntimeService').logout(SystemProviderIds.cherryin)
      logger.debug('Successfully cleared CherryIN OAuth tokens from auth config')
    } catch (error) {
      logger.error('Failed to logout:', error as Error)
      throw new CherryInOAuthServiceError('Failed to logout', error)
    }
  }
}

export const cherryInOAuthService = new CherryInOAuthService()
