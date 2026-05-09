import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerServiceMocks = vi.hoisted(() => ({
  getAuthConfig: vi.fn(),
  update: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getAuthConfig: providerServiceMocks.getAuthConfig,
    update: providerServiceMocks.update
  }
}))

import { net } from 'electron'

import { mockMainLoggerService } from '../../../../tests/__mocks__/MainLoggerService'
import { cherryINOAuthService } from '../CherryINOAuthService'

describe('CherryINOAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
