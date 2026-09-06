import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getValidAccessToken: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    OAuthRuntimeService: { getValidAccessToken: mocks.getValidAccessToken }
  } as never)
})

const { getProviderTransportAdapter } = await import('../runtimeTransport')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getProviderTransportAdapter', () => {
  it('returns adapters for the app-managed-OAuth providers and undefined otherwise', () => {
    expect(getProviderTransportAdapter('grok-cli')).toBeDefined()
    expect(getProviderTransportAdapter('openai-codex')).toBeDefined()
    expect(getProviderTransportAdapter('openai')).toBeUndefined()
    expect(getProviderTransportAdapter('claude-code')).toBeUndefined()
  })
})

describe('grok-cli adapter', () => {
  const adapter = getProviderTransportAdapter('grok-cli')!

  it('resolves a fresh OAuth token via the runtime service', async () => {
    mocks.getValidAccessToken.mockResolvedValue({ accessToken: 'grok-token', accountId: null })
    await expect(adapter.resolveCredentials()).resolves.toEqual({ accessToken: 'grok-token', accountId: null })
    expect(mocks.getValidAccessToken).toHaveBeenCalledWith('grok-cli')
  })

  it('throws when the user is not signed in', async () => {
    mocks.getValidAccessToken.mockResolvedValue(null)
    await expect(adapter.resolveCredentials()).rejects.toThrow(/Not signed in to grok-cli/)
  })

  it('builds Grok-CLI headers with the OAuth bearer and model override', () => {
    const headers = adapter.buildHeaders({ accessToken: 'grok-token' }, 'grok-cli/grok-build')
    expect(headers.authorization).toBe('Bearer grok-token')
    expect(headers['x-grok-client-identifier']).toBe('cherry-studio')
    expect(headers['x-xai-token-auth']).toBe('xai-grok-cli')
    // Model id is normalized (prefix dropped, lower-cased) for the override header.
    expect(headers['x-grok-model-override']).toBe('grok-build')
  })

  it('rewrites the payload into the Grok proxy shape', () => {
    const out = adapter.rewritePayload({
      input: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' }
      ],
      reasoning: { effort: 'high' }
    })
    expect(out.instructions).toBe('sys')
    expect(out.input).toEqual([{ role: 'user', content: 'hi' }])
    expect(out.reasoning).toBeUndefined()
  })
})

describe('openai-codex adapter', () => {
  const adapter = getProviderTransportAdapter('openai-codex')!

  it('resolves credentials including the ChatGPT account id', async () => {
    mocks.getValidAccessToken.mockResolvedValue({ accessToken: 'codex-token', accountId: 'acct-1' })
    await expect(adapter.resolveCredentials()).resolves.toEqual({ accessToken: 'codex-token', accountId: 'acct-1' })
    expect(mocks.getValidAccessToken).toHaveBeenCalledWith('openai-codex')
  })

  it('builds codex headers with the bearer, account id, and beta markers', () => {
    const headers = adapter.buildHeaders({ accessToken: 'codex-token', accountId: 'acct-1' }, 'gpt-5-codex')
    expect(headers.authorization).toBe('Bearer codex-token')
    expect(headers['chatgpt-account-id']).toBe('acct-1')
    expect(headers['openai-beta']).toBe('responses=experimental')
    expect(headers.originator).toBe('cherry-studio')
  })

  it('rewrites the payload to disable store and include encrypted reasoning', () => {
    const out = adapter.rewritePayload({ include: ['foo'] })
    expect(out.store).toBe(false)
    expect(out.include).toEqual(['foo', 'reasoning.encrypted_content'])
  })
})
