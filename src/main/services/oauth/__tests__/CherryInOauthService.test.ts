import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeMocks = vi.hoisted(() => ({
  startDeepLinkFlow: vi.fn(),
  getValidAccessToken: vi.fn(),
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

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {}

  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    Phase: { Background: 'background' }
  }
})

import { mockMainLoggerService } from '../../../../../tests/__mocks__/MainLoggerService'
import { CherryInOauthService } from '../CherryInOauthService'

describe('CherryInOauthService', () => {
  let cherryInOauthService: CherryInOauthService

  beforeEach(() => {
    vi.clearAllMocks()
    cherryInOauthService = new CherryInOauthService()
  })

  it('delegates CherryIN OAuth start to OAuthRuntimeService deep-link flow', async () => {
    runtimeMocks.startDeepLinkFlow.mockResolvedValue({
      authUrl: 'https://open.cherryin.ai/oauth2/auth',
      state: 'state'
    })

    await expect(cherryInOauthService.startOAuthFlow('settings-window', 'https://open.cherryin.ai')).resolves.toEqual({
      authUrl: 'https://open.cherryin.ai/oauth2/auth',
      state: 'state'
    })

    expect(runtimeMocks.startDeepLinkFlow).toHaveBeenCalledWith('settings-window', 'cherryin', {
      oauthServer: 'https://open.cherryin.ai',
      apiHost: 'https://open.cherryin.ai'
    })
  })

  it('maps balance/profile data using runtime-provided OAuth credentials', async () => {
    runtimeMocks.getValidAccessToken.mockResolvedValue({ accessToken: 'oauth-access' })
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

    const result = await cherryInOauthService.getBalance('https://open.cherryin.ai')

    expect(result).toEqual({
      balance: 128.5,
      profile: {
        displayName: 'Siin',
        username: 'siin',
        email: 'siin@gmail.com',
        group: 'Pro'
      },
      monthlyUsageTokens: null,
      monthlySpend: 6.82
    })
    expect(runtimeMocks.getValidAccessToken).toHaveBeenCalledWith('cherryin', {
      apiHost: 'https://open.cherryin.ai',
      forceRefresh: false
    })
    expect(netMocks.fetch).toHaveBeenCalledWith(
      'https://open.cherryin.ai/api/v1/oauth/balance',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer oauth-access' }) })
    )
  })

  it('logs 401 response details and surfaces balance HTTP failures', async () => {
    const errorSpy = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    runtimeMocks.getValidAccessToken.mockResolvedValue({ accessToken: 'oauth-access-token' })
    netMocks.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      clone: () =>
        ({
          text: async () => '{"error":"invalid_token","access_token":"server-token"}'
        }) as Response
    } as Response)

    await expect(cherryInOauthService.getBalance('https://open.cherryin.ai')).rejects.toThrow(
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

    await expect(cherryInOauthService.startOAuthFlow('settings-window', forgedHost)).rejects.toThrow(
      /Unauthorized API host/
    )

    await expect(cherryInOauthService.getBalance(forgedHost)).rejects.toThrow(/Unauthorized API host/)

    await expect(cherryInOauthService.logout(forgedHost)).rejects.toThrow(/Unauthorized API host/)
  })

  it('revokes remotely and delegates local token clearing to OAuthRuntimeService on logout', async () => {
    runtimeMocks.getValidAccessToken.mockResolvedValue({ accessToken: 'oauth-access' })
    netMocks.fetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response)

    await cherryInOauthService.logout('https://open.cherryin.ai')

    expect(netMocks.fetch).toHaveBeenCalledWith(
      'https://open.cherryin.ai/oauth2/revoke',
      expect.objectContaining({ method: 'POST', body: 'token=oauth-access&token_type_hint=access_token' })
    )
    expect(runtimeMocks.logout).toHaveBeenCalledWith('cherryin')
  })
})
