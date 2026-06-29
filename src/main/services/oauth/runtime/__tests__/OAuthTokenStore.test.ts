import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerServiceMock = vi.hoisted(() => ({
  getAuthConfig: vi.fn(),
  update: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({ providerService: providerServiceMock }))

import { ProviderAuthConfigOAuthTokenStore } from '../OAuthTokenStore'

describe('ProviderAuthConfigOAuthTokenStore', () => {
  const store = new ProviderAuthConfigOAuthTokenStore()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads only oauth-typed auth config', async () => {
    providerServiceMock.getAuthConfig.mockResolvedValueOnce({ type: 'api-key' })
    expect(await store.get('p')).toBeNull()

    providerServiceMock.getAuthConfig.mockResolvedValueOnce({
      type: 'oauth',
      clientId: 'c',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 123,
      accountId: 'acc'
    })
    expect(await store.get('p')).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 123, accountId: 'acc' })
  })

  it('clear() drops tokens but does NOT disable the provider by default (preserves a manual API key)', async () => {
    providerServiceMock.getAuthConfig.mockResolvedValue(null)
    await store.clear('cherryin')
    expect(providerServiceMock.update).toHaveBeenCalledWith('cherryin', { authConfig: { type: 'api-key' } })
    expect(providerServiceMock.update.mock.calls[0][1]).not.toHaveProperty('isEnabled')
  })

  it('clear({ disableProvider: true }) also disables the provider (OAuth-only providers)', async () => {
    await store.clear('codex', { disableProvider: true })
    expect(providerServiceMock.update).toHaveBeenCalledWith('codex', {
      authConfig: { type: 'api-key' },
      isEnabled: false
    })
  })
})
