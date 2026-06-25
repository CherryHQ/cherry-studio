import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import { GROK_CLI_PROVIDER_ID } from '@shared/data/presets/grokCli'
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
  getAccount: vi.fn(() => Promise.resolve({ accountId: null })),
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
const codex = { providerId: OPENAI_CODEX_PROVIDER_ID }
const grok = { providerId: GROK_CLI_PROVIDER_ID }

describe('oauthHandlers', () => {
  it('dispatches sign_in to the service for the given provider', async () => {
    await expect(oauthHandlers['oauth.sign_in'](codex, ctx)).resolves.toEqual({ accountId: 'acc-1' })
    expect(codexService.signIn).toHaveBeenCalledOnce()

    await expect(oauthHandlers['oauth.sign_in'](grok, ctx)).resolves.toEqual({ accountId: null })
    expect(grokService.signIn).toHaveBeenCalledOnce()
  })

  it('dispatches has_token to the matching provider service', async () => {
    await expect(oauthHandlers['oauth.has_token'](codex, ctx)).resolves.toBe(true)
    await expect(oauthHandlers['oauth.has_token'](grok, ctx)).resolves.toBe(false)
  })

  it('dispatches get_account to the matching provider service', async () => {
    await expect(oauthHandlers['oauth.get_account'](codex, ctx)).resolves.toEqual({ accountId: 'acc-1' })
    expect(codexService.getAccount).toHaveBeenCalledOnce()
  })

  it('dispatches logout to the matching provider service', async () => {
    await oauthHandlers['oauth.logout'](grok, ctx)
    expect(grokService.logout).toHaveBeenCalledOnce()
    expect(codexService.logout).not.toHaveBeenCalled()
  })

  it('throws for a provider with no registered OAuth service', () => {
    expect(() => oauthHandlers['oauth.sign_in']({ providerId: 'unknown' }, ctx)).toThrow(/unknown/)
  })
})
