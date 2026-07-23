import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeMocks = vi.hoisted(() => ({
  getValidAccessToken: vi.fn(),
  authenticatedFetch: vi.fn(),
  logout: vi.fn()
}))

const netMocks = vi.hoisted(() => ({
  fetch: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'OAuthRuntimeService') return runtimeMocks
    return originalGet(name)
  })
  return result
})

vi.mock('electron', () => ({
  net: {
    fetch: netMocks.fetch
  }
}))

import { mockMainLoggerService } from '../../../../../tests/__mocks__/MainLoggerService'
import { CherryInOAuthService } from '../CherryInOAuthService'
import { OAuthTransientError } from '../errors'

describe('CherryInOAuthService', () => {
  let cherryInOAuthService: CherryInOAuthService

  beforeEach(() => {
    vi.clearAllMocks()
    // Faithful stand-in for OAuthRuntimeService.authenticatedFetch: token
    // resolution + 401 force-refresh live in the runtime (covered by its own
    // tests). Here we only drive the request shaping/response handling the
    // CherryIN service owns — build with a fixed credential, run doFetch, and
    // fire onUnauthorized on a 401 so the diagnostic log is exercised.
    runtimeMocks.authenticatedFetch.mockImplementation(async (_providerId, buildRequest, doFetch, options = {}) => {
      const { input, init } = buildRequest({ accessToken: 'oauth-access', accountId: null })
      const response = await doFetch(input, init)
      if (response.status === 401) await options.onUnauthorized?.(response)
      return response
    })
    cherryInOAuthService = new CherryInOAuthService()
  })

  it('maps balance/profile data and shapes the authenticated balance request', async () => {
    netMocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          success: true,
          data: {
            quota: 64250000,
            used_quota: 3410000
          }
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          display_name: 'Siin',
          username: 'siin',
          email: 'siin@gmail.com',
          group: 'Pro'
        })
      } as Response)

    const result = await cherryInOAuthService.getBalance('https://open.cherryin.ai')

    expect(result).toEqual({
      balance: 128.5,
      profile: {
        displayName: 'Siin',
        username: 'siin',
        email: 'siin@gmail.com',
        group: 'Pro'
      }
    })
    // Delegates to the runtime with the cherryin provider id and its apiHost
    // context, and shapes the bearer/json request the runtime then drives.
    expect(runtimeMocks.authenticatedFetch).toHaveBeenCalledWith(
      'cherryin',
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ context: { apiHost: 'https://open.cherryin.ai' } })
    )
    expect(netMocks.fetch).toHaveBeenCalledWith(
      'https://open.cherryin.ai/api/v1/oauth/balance',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer oauth-access' }) })
    )
  })

  it('logs 401 response details and surfaces balance HTTP failures', async () => {
    const errorSpy = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    netMocks.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      clone: () =>
        ({
          text: async () => '{"error":"invalid_token","access_token":"server-token"}'
        }) as Response
    } as Response)

    await expect(cherryInOAuthService.getBalance('https://open.cherryin.ai')).rejects.toThrow(
      'Failed to get balance: HTTP 401 Unauthorized from /api/v1/oauth/balance'
    )

    expect(errorSpy).toHaveBeenCalledWith(
      'CherryIN request returned 401 Unauthorized',
      expect.objectContaining({
        stage: '/api/v1/oauth/balance',
        response: expect.objectContaining({ body: expect.objectContaining({ access_token: '<redacted>' }) })
      })
    )
    errorSpy.mockRestore()
  })

  it('rejects api hosts outside the allowlist on every IPC entry point', async () => {
    const forgedHost = 'https://attacker.example.com'

    await expect(cherryInOAuthService.getBalance(forgedHost)).rejects.toThrow(/Unauthorized API host/)

    await expect(cherryInOAuthService.logout(forgedHost)).rejects.toThrow(/Unauthorized API host/)
  })

  it('revokes remotely and delegates local token clearing to OAuthRuntimeService on logout', async () => {
    runtimeMocks.getValidAccessToken.mockResolvedValue({ accessToken: 'oauth-access' })
    netMocks.fetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response)

    await cherryInOAuthService.logout('https://open.cherryin.ai')

    expect(netMocks.fetch).toHaveBeenCalledWith(
      'https://open.cherryin.ai/oauth2/revoke',
      expect.objectContaining({ method: 'POST', body: 'token=oauth-access&token_type_hint=access_token' })
    )
    expect(runtimeMocks.logout).toHaveBeenCalledWith('cherryin')
  })

  it('still clears the local session on logout when the token is temporarily unavailable', async () => {
    // A transient refresh failure means no token to revoke — logout must skip
    // the remote revoke but still delegate the local clear.
    runtimeMocks.getValidAccessToken.mockRejectedValue(new OAuthTransientError('temporary, please retry'))

    await cherryInOAuthService.logout('https://open.cherryin.ai')

    expect(netMocks.fetch).not.toHaveBeenCalled()
    expect(runtimeMocks.logout).toHaveBeenCalledWith('cherryin')
  })
})
