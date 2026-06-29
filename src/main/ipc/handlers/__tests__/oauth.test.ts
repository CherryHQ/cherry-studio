import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { oauthHandlers } from '../oauth'

const runtimeService = {
  signIn: vi.fn((providerId: string) => Promise.resolve({ accountId: `${providerId}-account` })),
  hasToken: vi.fn(() => Promise.resolve(true)),
  getAccount: vi.fn(() => Promise.resolve({ accountId: 'acc-1' })),
  logout: vi.fn(() => Promise.resolve())
}

const codeCliService = {
  checkClaudeLogin: vi.fn(() => Promise.resolve(true))
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => (name === 'CodeCliService' ? codeCliService : runtimeService))
})

const ctx = { senderId: 'w1' as const }
const provider = { providerId: 'codex' }

describe('oauthHandlers', () => {
  it('dispatches sign_in to OAuthRuntimeService with the provider id', async () => {
    await expect(oauthHandlers['oauth.sign_in'](provider, ctx)).resolves.toEqual({ accountId: 'codex-account' })
    expect(appGetMock).toHaveBeenCalledWith('OAuthRuntimeService')
    expect(runtimeService.signIn).toHaveBeenCalledWith('codex')
  })

  it('dispatches has_token to OAuthRuntimeService', async () => {
    await expect(oauthHandlers['oauth.has_token'](provider, ctx)).resolves.toBe(true)
    expect(runtimeService.hasToken).toHaveBeenCalledWith('codex')
  })

  it('dispatches get_account to OAuthRuntimeService', async () => {
    await expect(oauthHandlers['oauth.get_account'](provider, ctx)).resolves.toEqual({ accountId: 'acc-1' })
    expect(runtimeService.getAccount).toHaveBeenCalledWith('codex')
  })

  it('dispatches logout to OAuthRuntimeService', async () => {
    await oauthHandlers['oauth.logout'](provider, ctx)
    expect(runtimeService.logout).toHaveBeenCalledWith('codex')
  })

  it('dispatches check_external_login to CodeCliService', async () => {
    await expect(oauthHandlers['oauth.check_external_login']({ providerId: 'claude-code' }, ctx)).resolves.toBe(true)
    expect(appGetMock).toHaveBeenCalledWith('CodeCliService')
    expect(codeCliService.checkClaudeLogin).toHaveBeenCalledTimes(1)
  })

  it('rejects check_external_login for a non-external-cli provider', () => {
    expect(() => oauthHandlers['oauth.check_external_login']({ providerId: 'codex' }, ctx)).toThrow(
      /Unsupported external-cli/
    )
    expect(codeCliService.checkClaudeLogin).not.toHaveBeenCalled()
  })
})
