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

  it('set({ expectedRefreshToken }) skips the write when the session was cleared mid-refresh', async () => {
    // A logout during an in-flight refresh flips authConfig to api-key; the
    // late refresh must NOT resurrect the session with its now-stale token.
    providerServiceMock.getAuthConfig.mockReturnValue({ type: 'api-key' })
    await store.set('codex', { accessToken: 'stale', refreshToken: 'r2' }, 'client-1', { expectedRefreshToken: 'r' })
    expect(providerServiceMock.update).not.toHaveBeenCalled()
  })

  it('set({ expectedRefreshToken }) skips the write when a re-login replaced the session mid-refresh', async () => {
    // logout → re-login installs a NEW oauth session (different refresh token).
    // The stale refresh must not clobber it, even though the type is oauth again.
    providerServiceMock.getAuthConfig.mockReturnValue({ type: 'oauth', clientId: 'client-1', refreshToken: 'r-new' })
    await store.set('codex', { accessToken: 'stale', refreshToken: 'r2' }, 'client-1', {
      expectedRefreshToken: 'r-old'
    })
    expect(providerServiceMock.update).not.toHaveBeenCalled()
  })

  it('set({ expectedRefreshToken }) updates the session it refreshed from', async () => {
    providerServiceMock.getAuthConfig.mockReturnValue({
      type: 'oauth',
      clientId: 'client-1',
      accessToken: 'old',
      refreshToken: 'r'
    })
    await store.set('codex', { accessToken: 'fresh', refreshToken: 'r2' }, 'client-1', { expectedRefreshToken: 'r' })
    expect(providerServiceMock.update).toHaveBeenCalledWith('codex', {
      authConfig: { type: 'oauth', clientId: 'client-1', accessToken: 'fresh', refreshToken: 'r2' }
    })
  })

  it('clear({ expectedRefreshToken }) skips when a re-login replaced the session', async () => {
    providerServiceMock.getAuthConfig.mockReturnValue({ type: 'oauth', clientId: 'client-1', refreshToken: 'r-new' })
    await store.clear('codex', { disableProvider: true, expectedRefreshToken: 'r-old' })
    expect(providerServiceMock.update).not.toHaveBeenCalled()
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
