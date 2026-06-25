import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { oauthHandlers } from '../oauth'

const codexService = {
  signIn: vi.fn(() => Promise.resolve({ accountId: 'acc-1' })),
  hasToken: vi.fn(() => Promise.resolve(true)),
  getAccount: vi.fn(() => Promise.resolve({ accountId: 'acc-1' })),
  logout: vi.fn(() => Promise.resolve())
}
const grokService = {
  signIn: vi.fn(() => Promise.resolve({ accountId: null })),
  hasToken: vi.fn(() => Promise.resolve(false)),
  logout: vi.fn(() => Promise.resolve())
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'CodexOauthService') return codexService
    if (name === 'GrokCliOauthService') return grokService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

const ctx = { senderId: 'w1' as const }

describe('oauthHandlers', () => {
  it('codex_sign_in returns the account shape from the service', async () => {
    const result = await oauthHandlers['oauth.codex_sign_in'](undefined, ctx)
    expect(codexService.signIn).toHaveBeenCalledOnce()
    expect(result).toEqual({ accountId: 'acc-1' })
  })

  it('codex_has_token forwards the boolean result', async () => {
    await expect(oauthHandlers['oauth.codex_has_token'](undefined, ctx)).resolves.toBe(true)
  })

  it('codex_get_account returns the account shape', async () => {
    await expect(oauthHandlers['oauth.codex_get_account'](undefined, ctx)).resolves.toEqual({ accountId: 'acc-1' })
  })

  it('codex_logout delegates to the service', async () => {
    await oauthHandlers['oauth.codex_logout'](undefined, ctx)
    expect(codexService.logout).toHaveBeenCalledOnce()
  })

  it('grok_sign_in swallows the service return to match the void route', async () => {
    await expect(oauthHandlers['oauth.grok_sign_in'](undefined, ctx)).resolves.toBeUndefined()
    expect(grokService.signIn).toHaveBeenCalledOnce()
  })

  it('grok_has_token forwards the boolean result', async () => {
    await expect(oauthHandlers['oauth.grok_has_token'](undefined, ctx)).resolves.toBe(false)
  })

  it('grok_logout delegates to the service', async () => {
    await oauthHandlers['oauth.grok_logout'](undefined, ctx)
    expect(grokService.logout).toHaveBeenCalledOnce()
  })
})
