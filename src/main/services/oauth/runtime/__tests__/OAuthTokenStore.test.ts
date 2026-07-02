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
    providerServiceMock.getAuthConfig.mockReturnValueOnce({ type: 'api-key' })
    expect(await store.get('p')).toBeNull()

    providerServiceMock.getAuthConfig.mockReturnValueOnce({
      type: 'oauth',
      clientId: 'c',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 123,
      accountId: 'acc'
    })
    expect(await store.get('p')).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 123, accountId: 'acc' })
  })

  it('set() writes the oauth session for an initial sign-in even when no session exists yet', async () => {
    providerServiceMock.getAuthConfig.mockReturnValue(null)
    await store.set('codex', { accessToken: 'a', refreshToken: 'r' }, 'client-1')
    expect(providerServiceMock.update).toHaveBeenCalledWith('codex', {
      authConfig: { type: 'oauth', clientId: 'client-1', accessToken: 'a', refreshToken: 'r' }
    })
  })

  it('set({ requireExistingSession }) skips the write when the session was cleared mid-refresh', async () => {
    // A logout during an in-flight refresh flips authConfig to api-key; the
    // late refresh must NOT resurrect the session with its now-stale token.
    providerServiceMock.getAuthConfig.mockReturnValue({ type: 'api-key' })
    await store.set('codex', { accessToken: 'stale', refreshToken: 'r' }, 'client-1', { requireExistingSession: true })
    expect(providerServiceMock.update).not.toHaveBeenCalled()
  })

  it('set({ requireExistingSession }) still updates a live oauth session', async () => {
    providerServiceMock.getAuthConfig.mockReturnValue({ type: 'oauth', clientId: 'client-1', accessToken: 'old' })
    await store.set('codex', { accessToken: 'fresh', refreshToken: 'r' }, 'client-1', { requireExistingSession: true })
    expect(providerServiceMock.update).toHaveBeenCalledWith('codex', {
      authConfig: { type: 'oauth', clientId: 'client-1', accessToken: 'fresh', refreshToken: 'r' }
    })
  })

  it('clear() drops tokens but does NOT disable the provider by default (preserves a manual API key)', async () => {
    providerServiceMock.getAuthConfig.mockReturnValue(null)
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
