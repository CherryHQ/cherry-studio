import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeMocks = vi.hoisted(() => ({
  startDeepLinkFlow: vi.fn(),
  hasToken: vi.fn(),
  getValidAccessToken: vi.fn(),
  saveTokens: vi.fn(),
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
  class MockBaseService {
    public ipcHandle = vi.fn().mockImplementation(() => ({ dispose: vi.fn() }))
  }

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

  it('registers CherryIN IPC handlers through the lifecycle init hook', async () => {
    await (cherryInOauthService as any).onInit()

    const ipcHandle = (cherryInOauthService as any).ipcHandle as ReturnType<typeof vi.fn>
    expect(ipcHandle.mock.calls.map(([channel]) => channel)).toEqual([
      'cherryin:save-token',
      'cherryin:has-token',
      'cherryin:get-balance',
      'cherryin:logout',
      'cherryin:start-oauth-flow'
    ])
  })

  it('delegates CherryIN OAuth start to OAuthRuntimeService deep-link flow', async () => {
    runtimeMocks.startDeepLinkFlow.mockResolvedValue({ authUrl: 'https://open.cherryin.ai/oauth2/auth', state: 'state' })
    const event = { sender: { id: 7 } } as Electron.IpcMainInvokeEvent

    await expect(cherryInOauthService.startOAuthFlow(event, 'https://open.cherryin.ai')).resolves.toEqual({
      authUrl: 'https://open.cherryin.ai/oauth2/auth',
      state: 'state'
    })

    expect(runtimeMocks.startDeepLinkFlow).toHaveBeenCalledWith(event, 'cherryin', {
      oauthServer: 'https://open.cherryin.ai',
      apiHost: 'https://open.cherryin.ai'
    })
  })

  it('delegates token save and hasToken to OAuthRuntimeService', async () => {
    runtimeMocks.hasToken.mockResolvedValue(true)

    await cherryInOauthService.saveToken({} as Electron.IpcMainInvokeEvent, 'access', 'refresh')
    await expect(cherryInOauthService.hasToken()).resolves.toBe(true)

    expect(runtimeMocks.saveTokens).toHaveBeenCalledWith('cherryin', { accessToken: 'access', refreshToken: 'refresh' })
    expect(runtimeMocks.hasToken).toHaveBeenCalledWith('cherryin')
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

    const result = await cherryInOauthService.getBalance({} as Electron.IpcMainInvokeEvent, 'https://open.cherryin.ai')

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
    expect(runtimeMocks.getValidAccessToken).toHaveBeenCalledWith('cherryin', { apiHost: 'https://open.cherryin.ai' })
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

    await expect(
      cherryInOauthService.getBalance({} as Electron.IpcMainInvokeEvent, 'https://open.cherryin.ai')
    ).rejects.toThrow('Failed to get balance: HTTP 401 Unauthorized from /api/v1/oauth/balance')

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

    await expect(
      cherryInOauthService.startOAuthFlow({ sender: { id: 1 } } as Electron.IpcMainInvokeEvent, forgedHost)
    ).rejects.toThrow(/Unauthorized API host/)

    await expect(cherryInOauthService.getBalance({} as Electron.IpcMainInvokeEvent, forgedHost)).rejects.toThrow(
      /Unauthorized API host/
    )

    await expect(cherryInOauthService.logout({} as Electron.IpcMainInvokeEvent, forgedHost)).rejects.toThrow(
      /Unauthorized API host/
    )
  })

  it('revokes remotely and delegates local token clearing to OAuthRuntimeService on logout', async () => {
    runtimeMocks.getValidAccessToken.mockResolvedValue({ accessToken: 'oauth-access' })
    netMocks.fetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response)

    await cherryInOauthService.logout({} as Electron.IpcMainInvokeEvent, 'https://open.cherryin.ai')

    expect(netMocks.fetch).toHaveBeenCalledWith(
      'https://open.cherryin.ai/oauth2/revoke',
      expect.objectContaining({ method: 'POST', body: 'token=oauth-access&token_type_hint=access_token' })
    )
    expect(runtimeMocks.logout).toHaveBeenCalledWith('cherryin')
  })
})
