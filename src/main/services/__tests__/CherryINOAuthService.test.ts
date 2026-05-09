import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerServiceMocks = vi.hoisted(() => ({
  getAuthConfig: vi.fn(),
  update: vi.fn()
}))

const ipcMainMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn()
}))

const netMocks = vi.hoisted(() => ({
  fetch: vi.fn()
}))

const windowManagerMocks = vi.hoisted(() => ({
  getWindowIdByWebContents: vi.fn(),
  getWindow: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getAuthConfig: providerServiceMocks.getAuthConfig,
    update: providerServiceMocks.update
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'WindowManager') {
      return {
        getWindowIdByWebContents: windowManagerMocks.getWindowIdByWebContents,
        getWindow: windowManagerMocks.getWindow
      }
    }
    return originalGet(name)
  })
  return result
})

vi.mock('electron', async (importOriginal) => {
  const actual = (await importOriginal()) as {
    ipcMain: Electron.IpcMain
    net: Electron.Net
  }
  return {
    ...actual,
    ipcMain: {
      ...actual.ipcMain,
      handle: ipcMainMocks.handle,
      removeHandler: ipcMainMocks.removeHandler
    },
    net: {
      ...actual.net,
      fetch: netMocks.fetch
    }
  }
})

import { BaseService } from '@main/core/lifecycle'
import { net } from 'electron'

import { mockMainLoggerService } from '../../../../tests/__mocks__/MainLoggerService'
import { CherryINOAuthService } from '../CherryINOAuthService'

describe('CherryINOAuthService', () => {
  let cherryINOAuthService: CherryINOAuthService

  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    vi.useRealTimers()
    windowManagerMocks.getWindowIdByWebContents.mockReturnValue('mock-window-id')
    windowManagerMocks.getWindow.mockReturnValue({
      isDestroyed: () => false,
      webContents: {
        send: vi.fn()
      }
    })
    cherryINOAuthService = new CherryINOAuthService()
  })

  it('registers CherryIN IPC handlers through BaseService lifecycle and removes them on stop', async () => {
    await (cherryINOAuthService as any)._doInit()

    expect(ipcMainMocks.handle.mock.calls.map(([channel]) => channel)).toEqual([
      'cherryin:save-token',
      'cherryin:has-token',
      'cherryin:get-balance',
      'cherryin:logout',
      'cherryin:start-oauth-flow'
    ])

    await (cherryINOAuthService as any)._doStop()

    expect(ipcMainMocks.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      'cherryin:save-token',
      'cherryin:has-token',
      'cherryin:get-balance',
      'cherryin:logout',
      'cherryin:start-oauth-flow'
    ])
  })

  it('activates pending-flow cleanup only while an OAuth flow is active', async () => {
    await (cherryINOAuthService as any)._doInit()
    expect(cherryINOAuthService.isActivated).toBe(false)

    const { state } = await cherryINOAuthService.startOAuthFlow(
      { sender: { id: 7 } } as Electron.IpcMainInvokeEvent,
      'https://open.cherryin.ai'
    )

    expect(state).toHaveLength(32)
    expect(cherryINOAuthService.isActivated).toBe(true)

    await cherryINOAuthService.handleOAuthCallback(
      new URL(`cherrystudio://oauth/callback?state=${state}&error=access_denied`)
    )

    expect(cherryINOAuthService.isActivated).toBe(false)
  })

  it('cleans up abandoned OAuth flows on the activation-scoped timer', async () => {
    vi.useFakeTimers()
    await (cherryINOAuthService as any)._doInit()

    await cherryINOAuthService.startOAuthFlow(
      { sender: { id: 7 } } as Electron.IpcMainInvokeEvent,
      'https://open.cherryin.ai'
    )

    expect(cherryINOAuthService.isActivated).toBe(true)

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 60 * 1000)

    expect(cherryINOAuthService.isActivated).toBe(false)

    vi.useRealTimers()
  })

  it('saves tokens into provider auth config and preserves the prior refresh token when none is returned', async () => {
    providerServiceMocks.getAuthConfig.mockResolvedValue({
      type: 'oauth',
      clientId: 'existing-client',
      accessToken: 'old-access',
      refreshToken: 'old-refresh'
    })
    providerServiceMocks.update.mockResolvedValue(undefined)

    await cherryINOAuthService.saveToken({} as Electron.IpcMainInvokeEvent, 'new-access')

    expect(providerServiceMocks.update).toHaveBeenCalledWith('cherryin', {
      authConfig: {
        type: 'oauth',
        clientId: 'existing-client',
        accessToken: 'new-access',
        refreshToken: 'old-refresh'
      }
    })
  })

  it('fails token saves without overwriting auth config when the current auth config cannot be read', async () => {
    providerServiceMocks.getAuthConfig.mockRejectedValue(new Error('sqlite busy'))

    await expect(cherryINOAuthService.saveToken({} as Electron.IpcMainInvokeEvent, 'new-access')).rejects.toThrow(
      'Failed to save OAuth token'
    )

    expect(providerServiceMocks.update).not.toHaveBeenCalled()
  })

  it('reads the access token from provider auth config', async () => {
    providerServiceMocks.getAuthConfig.mockResolvedValue({
      type: 'oauth',
      clientId: 'client-id',
      accessToken: 'oauth-access',
      refreshToken: 'oauth-refresh'
    })

    await expect(cherryINOAuthService.getToken()).resolves.toBe('oauth-access')
  })

  it('maps balance/profile data and leaves monthly metrics null when those fields are unavailable', async () => {
    providerServiceMocks.getAuthConfig.mockResolvedValue({
      type: 'oauth',
      clientId: 'client-id',
      accessToken: 'oauth-access',
      refreshToken: 'oauth-refresh'
    })
    vi.mocked(net.fetch)
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
          success: true,
          data: {
            display_name: 'Siin',
            username: 'siin',
            email: 'siin@gmail.com',
            group: 'Pro'
          }
        })
      } as Response)

    const result = await cherryINOAuthService.getBalance({} as Electron.IpcMainInvokeEvent, 'https://open.cherryin.ai')

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
  })

  it('maps flat profile responses without treating them as missing wrapped data', async () => {
    providerServiceMocks.getAuthConfig.mockResolvedValue({
      type: 'oauth',
      clientId: 'client-id',
      accessToken: 'oauth-access',
      refreshToken: 'oauth-refresh'
    })
    vi.mocked(net.fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          success: true,
          data: {
            quota: 1000,
            used_quota: 0
          }
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          display_name: 'Flat User',
          username: 'flat',
          email: 'flat@example.com',
          group: 'Team'
        })
      } as Response)

    const result = await cherryINOAuthService.getBalance({} as Electron.IpcMainInvokeEvent, 'https://open.cherryin.ai')

    expect(result.profile).toEqual({
      displayName: 'Flat User',
      username: 'flat',
      email: 'flat@example.com',
      group: 'Team'
    })
  })

  it('deduplicates concurrent token refreshes after simultaneous unauthorized responses', async () => {
    providerServiceMocks.getAuthConfig.mockResolvedValue({
      type: 'oauth',
      clientId: 'client-id',
      accessToken: 'expired-access',
      refreshToken: 'refresh-token'
    })
    providerServiceMocks.update.mockResolvedValue(undefined)

    let releaseRefresh!: () => void
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })

    vi.mocked(net.fetch).mockImplementation(async (url, init) => {
      const urlString = String(url)

      if (urlString.endsWith('/oauth2/token')) {
        await refreshGate
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            access_token: 'fresh-access',
            refresh_token: 'fresh-refresh'
          })
        } as Response
      }

      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization
      if (authorization === 'Bearer fresh-access') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            success: true,
            data: {
              quota: 100,
              used_quota: 0
            }
          })
        } as Response
      }

      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        clone: () =>
          ({
            text: async () => '{}'
          }) as Response
      } as Response
    })

    const first = cherryINOAuthService.getBalance({} as Electron.IpcMainInvokeEvent, 'https://open.cherryin.ai')
    const second = cherryINOAuthService.getBalance({} as Electron.IpcMainInvokeEvent, 'https://open.cherryin.ai')

    await vi.waitFor(() => {
      expect(vi.mocked(net.fetch).mock.calls.filter(([url]) => String(url).endsWith('/oauth2/token'))).toHaveLength(1)
    })

    releaseRefresh()

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        balance: 0.0002,
        profile: {
          displayName: null,
          username: null,
          email: null,
          group: null
        },
        monthlyUsageTokens: null,
        monthlySpend: 0
      },
      {
        balance: 0.0002,
        profile: {
          displayName: null,
          username: null,
          email: null,
          group: null
        },
        monthlyUsageTokens: null,
        monthlySpend: 0
      }
    ])
    expect(providerServiceMocks.update).toHaveBeenCalledTimes(2)
    expect(vi.mocked(net.fetch).mock.calls.filter(([url]) => String(url).endsWith('/oauth2/token'))).toHaveLength(2)
  })

  it('exposes balance API HTTP failures in the thrown error message', async () => {
    providerServiceMocks.getAuthConfig.mockResolvedValue({
      type: 'oauth',
      clientId: 'client-id',
      accessToken: 'oauth-access',
      refreshToken: null
    })
    vi.mocked(net.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    } as Response)

    await expect(
      cherryINOAuthService.getBalance({} as Electron.IpcMainInvokeEvent, 'https://open.cherryin.ai')
    ).rejects.toThrow('Failed to get balance: HTTP 401 Unauthorized from /api/v1/oauth/balance')
  })

  it('logs 401 response details with request context', async () => {
    const errorSpy = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    providerServiceMocks.getAuthConfig.mockResolvedValue({
      type: 'oauth',
      clientId: 'client-id',
      accessToken: 'oauth-access-token',
      refreshToken: null
    })
    vi.mocked(net.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      clone: () =>
        ({
          text: async () => '{"error":"invalid_token","access_token":"server-token"}'
        }) as Response
    } as Response)

    await expect(
      cherryINOAuthService.getBalance({} as Electron.IpcMainInvokeEvent, 'https://open.cherryin.ai')
    ).rejects.toThrow('Failed to get balance: HTTP 401 Unauthorized from /api/v1/oauth/balance')

    expect(errorSpy).toHaveBeenCalledWith(
      'CherryIN request returned 401 Unauthorized',
      expect.objectContaining({
        stage: '/api/v1/oauth/balance',
        request: expect.objectContaining({
          url: 'https://open.cherryin.ai/api/v1/oauth/balance',
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('redacted')
          }),
          body: null
        }),
        response: expect.objectContaining({
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          body: expect.objectContaining({
            error: 'invalid_token',
            access_token: expect.stringContaining('redacted')
          })
        })
      })
    )
    errorSpy.mockRestore()
  })

  it('clears auth config back to api-key mode on logout', async () => {
    providerServiceMocks.getAuthConfig.mockResolvedValue({
      type: 'oauth',
      clientId: 'client-id',
      accessToken: 'oauth-access',
      refreshToken: 'oauth-refresh'
    })
    providerServiceMocks.update.mockResolvedValue(undefined)
    vi.mocked(net.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK'
    } as Response)

    await cherryINOAuthService.logout({} as Electron.IpcMainInvokeEvent, 'https://open.cherryin.ai')

    expect(providerServiceMocks.update).toHaveBeenCalledWith('cherryin', {
      authConfig: {
        type: 'api-key'
      }
    })
  })
})
