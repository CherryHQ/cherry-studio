import type * as LifecycleModule from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerServiceMocks = vi.hoisted(() => ({
  getAuthConfig: vi.fn(),
  update: vi.fn()
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
  const actual = (await importOriginal()) as { net: Electron.Net }
  return {
    ...actual,
    net: {
      ...actual.net,
      fetch: netMocks.fetch
    }
  }
})

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()

  class MockBaseService {
    public ipcHandle = vi.fn().mockImplementation(() => ({ dispose: vi.fn() }))
    protected _activated = false
    protected readonly _disposables: Array<{ dispose: () => void }> = []

    public get isActivated(): boolean {
      return this._activated
    }

    protected registerDisposable(disposable: { dispose: () => void } | (() => void)): { dispose: () => void } {
      const wrapped = typeof disposable === 'function' ? { dispose: disposable } : disposable
      this._disposables.push(wrapped)
      return wrapped
    }

    protected registerInterval(callback: () => void | Promise<void>, intervalMs: number): { dispose: () => void } {
      const handle = setInterval(() => {
        void (async () => {
          try {
            await callback()
          } catch {
            // swallow — matches BaseService behavior
          }
        })()
      }, intervalMs)
      const disposable = { dispose: () => clearInterval(handle) }
      this._disposables.push(disposable)
      return disposable
    }

    protected async activate(): Promise<boolean> {
      if (this._activated) return true
      const self = this as unknown as { onActivate?: () => void | Promise<void> }
      await self.onActivate?.()
      this._activated = true
      return true
    }

    protected async deactivate(): Promise<boolean> {
      if (!this._activated) return true
      const self = this as unknown as { onDeactivate?: () => void | Promise<void> }
      await self.onDeactivate?.()
      this._activated = false
      return true
    }
  }

  return { ...actual, BaseService: MockBaseService }
})

import { net } from 'electron'

import { mockMainLoggerService } from '../../../../tests/__mocks__/MainLoggerService'
import { CherryINOAuthService } from '../CherryINOAuthService'

describe('CherryINOAuthService', () => {
  let cherryINOAuthService: CherryINOAuthService

  beforeEach(() => {
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

  it('registers CherryIN IPC handlers through the lifecycle init hook', async () => {
    await (cherryINOAuthService as any).onInit()

    const ipcHandle = (cherryINOAuthService as any).ipcHandle as ReturnType<typeof vi.fn>
    expect(ipcHandle.mock.calls.map(([channel]) => channel)).toEqual([
      'cherryin:save-token',
      'cherryin:has-token',
      'cherryin:get-balance',
      'cherryin:logout',
      'cherryin:start-oauth-flow'
    ])
  })

  it('rejects OAuth callbacks with missing or unknown state (CSRF defense)', async () => {
    await (cherryINOAuthService as any).onInit()

    const warnSpy = vi.spyOn(mockMainLoggerService, 'warn').mockImplementation(() => {})

    const { state: validState } = await cherryINOAuthService.startOAuthFlow(
      { sender: { id: 7 } } as Electron.IpcMainInvokeEvent,
      'https://open.cherryin.ai'
    )

    // Case 1: missing state — silently dropped, no token exchange attempted.
    await cherryINOAuthService.handleOAuthCallback(new URL('cherrystudio://oauth/callback?code=auth-code'))
    expect(warnSpy).toHaveBeenCalledWith('OAuth callback missing state parameter, ignoring')
    expect(netMocks.fetch).not.toHaveBeenCalled()

    // Case 2: unknown state — silently dropped, valid pending flow stays intact.
    await cherryINOAuthService.handleOAuthCallback(
      new URL('cherrystudio://oauth/callback?state=attacker-forged-state&code=auth-code')
    )
    expect(warnSpy).toHaveBeenCalledWith('OAuth callback for unknown or expired state, ignoring')
    expect(netMocks.fetch).not.toHaveBeenCalled()

    // The legitimate pending flow remains and is still consumable on a
    // subsequent matching callback — confirms case-2 did not drop it.
    const pendingFlows = (cherryINOAuthService as any).pendingOAuthFlows as Map<string, unknown>
    expect(pendingFlows.has(validState)).toBe(true)

    warnSpy.mockRestore()
  })

  it('activates pending-flow cleanup only while an OAuth flow is active', async () => {
    await (cherryINOAuthService as any).onInit()
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
    await (cherryINOAuthService as any).onInit()

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
    // Pick a non-401 status so the 401 → refresh / clear-session path is not engaged
    // and the raw HTTP status surfaces in the thrown message verbatim.
    vi.mocked(net.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    } as Response)

    await expect(
      cherryINOAuthService.getBalance({} as Electron.IpcMainInvokeEvent, 'https://open.cherryin.ai')
    ).rejects.toThrow('Failed to get balance: HTTP 500 Internal Server Error from /api/v1/oauth/balance')
  })

  it('clears the OAuth session and throws OAuthSessionExpired when 401 hits with no refresh token', async () => {
    providerServiceMocks.getAuthConfig.mockResolvedValue({
      type: 'oauth',
      clientId: 'client-id',
      accessToken: 'oauth-access',
      refreshToken: null
    })
    providerServiceMocks.update.mockResolvedValue(undefined)
    vi.mocked(net.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    } as Response)

    await expect(
      cherryINOAuthService.getBalance({} as Electron.IpcMainInvokeEvent, 'https://open.cherryin.ai')
    ).rejects.toThrow('OAuth session expired: no refresh token available')

    expect(providerServiceMocks.update).toHaveBeenCalledWith('cherryin', { authConfig: { type: 'api-key' } })
  })

  it('logs 401 response details when refresh succeeds but the retry is still unauthorized', async () => {
    const errorSpy = vi.spyOn(mockMainLoggerService, 'error').mockImplementation(() => {})
    providerServiceMocks.getAuthConfig.mockResolvedValue({
      type: 'oauth',
      clientId: 'client-id',
      accessToken: 'oauth-access-token',
      refreshToken: 'refresh-token'
    })
    providerServiceMocks.update.mockResolvedValue(undefined)
    vi.mocked(net.fetch).mockImplementation(async (url) => {
      const urlString = String(url)
      if (urlString.endsWith('/oauth2/token')) {
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
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        clone: () =>
          ({
            text: async () => '{"error":"invalid_token","access_token":"server-token"}'
          }) as Response
      } as Response
    })

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

  it('redacts form-encoded OAuth credentials and nested array values in diagnostics', () => {
    const redact = (cherryINOAuthService as any).redactDiagnosticValue as (value: unknown) => unknown

    expect(
      redact('grant_type=refresh_token&refresh_token=refresh-secret&access_token=access-secret&code=auth-code')
    ).toBe('grant_type=refresh_token&refresh_token=<redacted>&access_token=<redacted>&code=<redacted>')
    expect(
      redact({
        data: ['Bearer live-token', 'client_secret=client-secret'],
        nested: { refresh_token: 'refresh-secret' }
      })
    ).toEqual({
      data: ['Bearer <redacted>', 'client_secret=<redacted>'],
      nested: { refresh_token: '<redacted>' }
    })
  })

  it('rejects api hosts outside the allowlist on every IPC entry point (SSRF defense)', async () => {
    // Pins the validateApiHost negative case for the three entry points that
    // call it: startOAuthFlow, getBalance, logout. A future widening of
    // CHERRYIN_CONFIG.ALLOWED_HOSTS or a new entry point that skips the
    // guard would not break any existing test without this.
    const forgedHost = 'https://attacker.example.com'

    await expect(
      cherryINOAuthService.startOAuthFlow({ sender: { id: 1 } } as Electron.IpcMainInvokeEvent, forgedHost)
    ).rejects.toThrow(/Unauthorized API host/)

    await expect(cherryINOAuthService.getBalance({} as Electron.IpcMainInvokeEvent, forgedHost)).rejects.toThrow(
      /Unauthorized API host/
    )

    await expect(cherryINOAuthService.logout({} as Electron.IpcMainInvokeEvent, forgedHost)).rejects.toThrow(
      /Unauthorized API host/
    )
  })

  it('does NOT persist OAuth token when the api-keys fetch fails after token exchange', async () => {
    // Pins Important #1 fix (556d88918): performTokenExchange must defer
    // saveTokenInternal until after /oauth/tokens succeeds. A future
    // refactor that re-orders the save before the keys-validation would
    // silently leak a usable accessToken into SQLite while the user-visible
    // flow throws, leaving hasToken() true.
    providerServiceMocks.getAuthConfig.mockResolvedValue(null)
    providerServiceMocks.update.mockResolvedValue(undefined)
    vi.mocked(net.fetch).mockImplementation(async (url) => {
      const urlString = String(url)
      if (urlString.endsWith('/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ access_token: 'leaked-access', refresh_token: 'leaked-refresh' })
        } as Response
      }
      // /api/v1/oauth/tokens — fail
      return {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'upstream down'
      } as Response
    })

    const { state } = await cherryINOAuthService.startOAuthFlow(
      { sender: { id: 7 } } as Electron.IpcMainInvokeEvent,
      'https://open.cherryin.ai'
    )

    await cherryINOAuthService.handleOAuthCallback(
      new URL(`cherrystudio://oauth/callback?state=${state}&code=auth-code`)
    )

    // No provider.update with an `oauth` authConfig — token must NOT have
    // been persisted because the api-keys fetch failed.
    const oauthUpdateCalls = providerServiceMocks.update.mock.calls.filter((call) => {
      const dto = call[1] as { authConfig?: { type?: string } } | undefined
      return dto?.authConfig?.type === 'oauth'
    })
    expect(oauthUpdateCalls).toEqual([])
  })

  it('drops the OAuth callback silently when the initiator window is gone', async () => {
    // T6: pin the resolveInitiatorWebContents -> null branch in the SUCCESS
    // path. After a legit code arrives the callback must not crash and must
    // not send to the wrong window — the pending flow is still cleared so
    // the renderer can re-initiate cleanly. A regression that defaults to
    // broadcast or to MainWindow would land OAuth `apiKeys` on unrelated
    // windows.
    const fetchMock = vi.mocked(net.fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ access_token: 'a', refresh_token: 'r' })
    } as Response)

    await (cherryINOAuthService as any).onInit()
    const { state } = await cherryINOAuthService.startOAuthFlow(
      { sender: { id: 7 } } as Electron.IpcMainInvokeEvent,
      'https://open.cherryin.ai'
    )

    // The initiator window is gone by the time the callback arrives.
    const sendSpy = vi.fn()
    windowManagerMocks.getWindow.mockReturnValueOnce({
      isDestroyed: () => true,
      webContents: { send: sendSpy }
    })

    await cherryINOAuthService.handleOAuthCallback(
      new URL(`cherrystudio://oauth/callback?state=${state}&code=auth-code`)
    )

    // No send fired (window is destroyed) and the pending flow is consumed.
    expect(sendSpy).not.toHaveBeenCalled()
    const pendingFlows = (cherryINOAuthService as any).pendingOAuthFlows as Map<string, unknown>
    expect(pendingFlows.has(state)).toBe(false)
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
