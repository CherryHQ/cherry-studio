import type { OAuthClientInformation, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const openMock = vi.hoisted(() => vi.fn())
vi.mock('open', () => ({ default: openMock }))

// The provider constructor reads application.getPath('feature.mcp.oauth'); the
// unified mock supplies a deterministic path so construction never touches Electron.
// We pass an explicit configDir per test, so storage actually lands in a temp dir.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({})
})

const { McpAuthorizationRequiredError, McpOAuthClientProvider } = await import('../provider')

const CLIENT_INFO = { client_id: 'cid', client_secret: 'csecret' } as OAuthClientInformation
const TOKENS = { access_token: 'at', token_type: 'Bearer', refresh_token: 'rt' } as OAuthTokens

describe('McpOAuthClientProvider authorization mode', () => {
  let configDir: string

  beforeEach(async () => {
    openMock.mockReset().mockResolvedValue(undefined)
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oauth-mode-test-'))
  })

  afterEach(async () => {
    await fs.rm(configDir, { recursive: true, force: true })
  })

  it('does not open the browser when a silent connection needs a new grant', async () => {
    const provider = new McpOAuthClientProvider({ serverUrlHash: 'silent', configDir })

    await expect(provider.redirectToAuthorization(new URL('https://example.com/authorize'))).rejects.toBeInstanceOf(
      McpAuthorizationRequiredError
    )
    expect(openMock).not.toHaveBeenCalled()
  })

  it('opens the browser for an interactive authorization request', async () => {
    const provider = new McpOAuthClientProvider({ serverUrlHash: 'interactive', configDir, authMode: 'interactive' })

    await provider.redirectToAuthorization(new URL('https://example.com/authorize'))

    expect(openMock).toHaveBeenCalledExactlyOnceWith('https://example.com/authorize')
  })
})

describe('McpOAuthClientProvider.invalidateCredentials', () => {
  let configDir: string
  const serverUrlHash = 'hash-1'

  const makeProvider = () => new McpOAuthClientProvider({ serverUrlHash, configDir })

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oauth-invalidate-test-'))
    const seed = makeProvider()
    await seed.saveClientInformation(CLIENT_INFO)
    await seed.saveTokens(TOKENS)
    await seed.saveCodeVerifier('verifier-xyz')
  })

  afterEach(async () => {
    await fs.rm(configDir, { recursive: true, force: true })
  })

  it("scope 'tokens' clears only the tokens", async () => {
    const provider = makeProvider()
    await provider.invalidateCredentials('tokens')

    expect(await provider.tokens()).toBeUndefined()
    expect(await provider.clientInformation()).toMatchObject({ client_id: 'cid' })
    expect(await provider.codeVerifier()).toBe('verifier-xyz')
  })

  it("scope 'client' clears only the client information", async () => {
    const provider = makeProvider()
    await provider.invalidateCredentials('client')

    expect(await provider.clientInformation()).toBeUndefined()
    expect(await provider.tokens()).toMatchObject({ access_token: 'at' })
    expect(await provider.codeVerifier()).toBe('verifier-xyz')
  })

  it("scope 'verifier' clears only the code verifier", async () => {
    const provider = makeProvider()
    await provider.invalidateCredentials('verifier')

    // Empty verifier is treated as "none" by the storage getter.
    await expect(provider.codeVerifier()).rejects.toThrow(/No code verifier/)
    expect(await provider.tokens()).toMatchObject({ access_token: 'at' })
    expect(await provider.clientInformation()).toMatchObject({ client_id: 'cid' })
  })

  it("scope 'all' clears every stored credential", async () => {
    const provider = makeProvider()
    await provider.invalidateCredentials('all')

    expect(await provider.tokens()).toBeUndefined()
    expect(await provider.clientInformation()).toBeUndefined()
    await expect(provider.codeVerifier()).rejects.toThrow(/No code verifier/)
  })

  it('ignores an unknown scope without touching stored credentials', async () => {
    const provider = makeProvider()
    await provider.invalidateCredentials('bogus' as 'all')

    expect(await provider.tokens()).toMatchObject({ access_token: 'at' })
    expect(await provider.clientInformation()).toMatchObject({ client_id: 'cid' })
    expect(await provider.codeVerifier()).toBe('verifier-xyz')
  })
})
