import type * as LifecycleModule from '@main/core/lifecycle'
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

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

// BaseService pulls in the lifecycle container; stub it to an empty base so the
// subclass can be constructed in isolation (the token logic touches no base members).
vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()
  class MockBaseService {}
  return { ...actual, BaseService: MockBaseService }
})

import type { PkceOAuthClient } from '@main/utils/oauth/PkceOAuthClient'
import { type OAuthTokenResponse } from '@main/utils/oauth/PkceOAuthClient'

import { type LoopbackConfig, LoopbackOAuthService } from '../LoopbackOAuthService'

const PROVIDER_ID = 'test-loopback'

class TestOAuthService extends LoopbackOAuthService {
  protected readonly providerId = PROVIDER_ID
  protected readonly clientId = 'test-client'
  protected readonly loopback: LoopbackConfig = {
    hosts: ['127.0.0.1'],
    port: 1,
    path: '/cb',
    redirectUri: 'http://127.0.0.1:1/cb'
  }

  public readonly refreshMock = vi.fn<(refreshToken: string) => Promise<OAuthTokenResponse>>()
  public extra: Record<string, unknown> = {}

  protected getClient(): PkceOAuthClient {
    return { refresh: this.refreshMock } as unknown as PkceOAuthClient
  }

  protected extraAuthFields(): Record<string, unknown> {
    return this.extra
  }

  // Expose protected members for assertions.
  public persist(tokenData: OAuthTokenResponse) {
    return this.persistTokens(tokenData)
  }
  public validToken() {
    return this.getValidToken()
  }
}

const oauthConfig = (over: Record<string, unknown> = {}) => ({
  type: 'oauth' as const,
  clientId: 'test-client',
  accessToken: 'access',
  ...over
})

describe('LoopbackOAuthService', () => {
  let service: TestOAuthService

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    service = new TestOAuthService()
    providerServiceMocks.update.mockResolvedValue(undefined)
  })

  describe('persistTokens', () => {
    it('writes clientId, access/refresh tokens, computed expiry and extra fields', async () => {
      providerServiceMocks.getAuthConfig.mockResolvedValue(null)
      service.extra = { accountId: 'acc-1' }

      await service.persist({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })

      expect(providerServiceMocks.update).toHaveBeenCalledWith(PROVIDER_ID, {
        authConfig: {
          type: 'oauth',
          clientId: 'test-client',
          accessToken: 'a',
          refreshToken: 'r',
          expiresAt: Date.now() + 3600 * 1000,
          accountId: 'acc-1'
        }
      })
    })

    it('keeps the existing refresh token when the response omits one', async () => {
      providerServiceMocks.getAuthConfig.mockResolvedValue(oauthConfig({ refreshToken: 'old' }))

      await service.persist({ access_token: 'a2' })

      expect(providerServiceMocks.update).toHaveBeenCalledWith(PROVIDER_ID, {
        authConfig: { type: 'oauth', clientId: 'test-client', accessToken: 'a2', refreshToken: 'old' }
      })
    })
  })

  describe('getValidToken', () => {
    it('returns the stored token when it is not expired', async () => {
      providerServiceMocks.getAuthConfig.mockResolvedValue(oauthConfig({ expiresAt: Date.now() + 600_000 }))

      await expect(service.validToken()).resolves.toBe('access')
      expect(service.refreshMock).not.toHaveBeenCalled()
    })

    it('refreshes when expired and a refresh token exists', async () => {
      providerServiceMocks.getAuthConfig.mockResolvedValue(
        oauthConfig({ expiresAt: Date.now() - 1, refreshToken: 'r' })
      )
      service.refreshMock.mockResolvedValue({ access_token: 'fresh' })

      await expect(service.validToken()).resolves.toBe('fresh')
      expect(service.refreshMock).toHaveBeenCalledWith('r')
    })

    it('clears a dead session (expired, no refresh token) and returns null', async () => {
      providerServiceMocks.getAuthConfig.mockResolvedValue(oauthConfig({ expiresAt: Date.now() - 1 }))

      await expect(service.validToken()).resolves.toBeNull()
      expect(providerServiceMocks.update).toHaveBeenCalledWith(PROVIDER_ID, {
        authConfig: { type: 'api-key' },
        isEnabled: false
      })
    })

    it('de-duplicates concurrent refreshes', async () => {
      providerServiceMocks.getAuthConfig.mockResolvedValue(
        oauthConfig({ expiresAt: Date.now() - 1, refreshToken: 'r' })
      )
      let resolveRefresh: (v: OAuthTokenResponse) => void = () => {}
      service.refreshMock.mockReturnValue(
        new Promise<OAuthTokenResponse>((resolve) => {
          resolveRefresh = resolve
        })
      )

      const first = service.validToken()
      const second = service.validToken()
      resolveRefresh({ access_token: 'fresh' })

      await expect(Promise.all([first, second])).resolves.toEqual(['fresh', 'fresh'])
      expect(service.refreshMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('hasToken', () => {
    it('returns false and clears a dead session', async () => {
      providerServiceMocks.getAuthConfig.mockResolvedValue(oauthConfig({ expiresAt: Date.now() - 1 }))

      await expect(service.hasToken()).resolves.toBe(false)
      expect(providerServiceMocks.update).toHaveBeenCalledWith(PROVIDER_ID, {
        authConfig: { type: 'api-key' },
        isEnabled: false
      })
    })

    it('returns true when a usable token is present', async () => {
      providerServiceMocks.getAuthConfig.mockResolvedValue(oauthConfig({ expiresAt: Date.now() + 600_000 }))

      await expect(service.hasToken()).resolves.toBe(true)
      expect(providerServiceMocks.update).not.toHaveBeenCalled()
    })
  })

  describe('getAccount', () => {
    it('defaults to no account for providers without an account concept', async () => {
      await expect(service.getAccount()).resolves.toEqual({ accountId: null })
    })
  })

  describe('logout', () => {
    it('resets to api-key mode and disables the provider', async () => {
      await service.logout()

      expect(providerServiceMocks.update).toHaveBeenCalledWith(PROVIDER_ID, {
        authConfig: { type: 'api-key' },
        isEnabled: false
      })
    })
  })
})
