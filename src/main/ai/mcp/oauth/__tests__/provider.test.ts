import type { OAuthClientInformation, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The provider constructor reads application.getPath('feature.mcp.oauth'); the
// unified mock supplies a deterministic path so construction never touches Electron.
// We pass an explicit configDir per test, so storage actually lands in a temp dir.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({})
})

const { McpOAuthClientProvider } = await import('../provider')

const CLIENT_INFO = { client_id: 'cid', client_secret: 'csecret' } as OAuthClientInformation
const TOKENS = { access_token: 'at', token_type: 'Bearer', refresh_token: 'rt' } as OAuthTokens

describe('McpOAuthClientProvider.invalidateCredentials', () => {
  let configDir: string
  const serverUrlHash = 'hash-1'

  const makeProvider = () => new McpOAuthClientProvider({ serverUrlHash, configDir })

  const seedRegisteredClient = async (authServerUrl?: string) => {
    const seed = makeProvider()
    if (authServerUrl) {
      await seed.saveDiscoveryState({ authorizationServerUrl: authServerUrl })
    }
    await seed.saveClientInformation(CLIENT_INFO)
    await seed.saveTokens(TOKENS)
    await seed.saveCodeVerifier('verifier-xyz')
  }

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oauth-invalidate-test-'))
  })

  afterEach(async () => {
    await fs.rm(configDir, { recursive: true, force: true })
  })

  it("scope 'tokens' clears only the tokens when the auth server is known", async () => {
    await seedRegisteredClient('https://auth.example.com')
    const provider = makeProvider()
    await provider.invalidateCredentials('tokens')

    expect(await provider.tokens()).toBeUndefined()
    expect(await provider.clientInformation()).toMatchObject({ client_id: 'cid' })
    expect(await provider.codeVerifier()).toBe('verifier-xyz')
  })

  it("scope 'tokens' on a legacy client (no recorded auth server) also clears the stale client", async () => {
    await seedRegisteredClient()
    const provider = makeProvider()
    await provider.invalidateCredentials('tokens')

    expect(await provider.tokens()).toBeUndefined()
    expect(await provider.clientInformation()).toBeUndefined()
    expect(await provider.codeVerifier()).toBe('verifier-xyz')
  })

  it("scope 'client' clears only the client information", async () => {
    await seedRegisteredClient('https://auth.example.com')
    const provider = makeProvider()
    await provider.invalidateCredentials('client')

    expect(await provider.clientInformation()).toBeUndefined()
    expect(await provider.tokens()).toMatchObject({ access_token: 'at' })
    expect(await provider.codeVerifier()).toBe('verifier-xyz')
  })

  it("scope 'verifier' clears only the code verifier", async () => {
    await seedRegisteredClient('https://auth.example.com')
    const provider = makeProvider()
    await provider.invalidateCredentials('verifier')

    // Empty verifier is treated as "none" by the storage getter.
    await expect(provider.codeVerifier()).rejects.toThrow(/No code verifier/)
    expect(await provider.tokens()).toMatchObject({ access_token: 'at' })
    expect(await provider.clientInformation()).toMatchObject({ client_id: 'cid' })
  })

  it("scope 'all' clears every stored credential", async () => {
    await seedRegisteredClient('https://auth.example.com')
    const provider = makeProvider()
    await provider.invalidateCredentials('all')

    expect(await provider.tokens()).toBeUndefined()
    expect(await provider.clientInformation()).toBeUndefined()
    await expect(provider.codeVerifier()).rejects.toThrow(/No code verifier/)
  })

  it("scope 'discovery' leaves stored credentials untouched", async () => {
    await seedRegisteredClient('https://auth.example.com')
    const provider = makeProvider()
    await provider.invalidateCredentials('discovery')

    expect(await provider.tokens()).toMatchObject({ access_token: 'at' })
    expect(await provider.clientInformation()).toMatchObject({ client_id: 'cid' })
    expect(await provider.codeVerifier()).toBe('verifier-xyz')
  })

  it('ignores an unknown scope without touching stored credentials', async () => {
    await seedRegisteredClient('https://auth.example.com')
    const provider = makeProvider()
    await provider.invalidateCredentials('bogus' as 'all')

    expect(await provider.tokens()).toMatchObject({ access_token: 'at' })
    expect(await provider.clientInformation()).toMatchObject({ client_id: 'cid' })
    expect(await provider.codeVerifier()).toBe('verifier-xyz')
  })
})

describe('McpOAuthClientProvider.saveDiscoveryState', () => {
  let configDir: string
  const serverUrlHash = 'hash-2'

  const makeProvider = () => new McpOAuthClientProvider({ serverUrlHash, configDir })

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oauth-discovery-test-'))
  })

  afterEach(async () => {
    await fs.rm(configDir, { recursive: true, force: true })
  })

  it('clears the stale client when the authorization server has changed', async () => {
    const seed = makeProvider()
    await seed.saveDiscoveryState({ authorizationServerUrl: 'https://old-auth.example.com' })
    await seed.saveClientInformation(CLIENT_INFO)
    await seed.saveTokens(TOKENS)

    const provider = makeProvider()
    await provider.saveDiscoveryState({ authorizationServerUrl: 'https://new-auth.example.com' })

    expect(await provider.clientInformation()).toBeUndefined()
    expect(await provider.tokens()).toBeUndefined()
  })

  it('keeps the client when the authorization server is unchanged', async () => {
    const seed = makeProvider()
    await seed.saveDiscoveryState({ authorizationServerUrl: 'https://auth.example.com' })
    await seed.saveClientInformation(CLIENT_INFO)
    await seed.saveTokens(TOKENS)

    const provider = makeProvider()
    await provider.saveDiscoveryState({ authorizationServerUrl: 'https://auth.example.com' })

    expect(await provider.clientInformation()).toMatchObject({ client_id: 'cid' })
    expect(await provider.tokens()).toMatchObject({ access_token: 'at' })
  })

  it('keeps a legacy client whose auth server was never recorded', async () => {
    const seed = makeProvider()
    await seed.saveClientInformation(CLIENT_INFO)
    await seed.saveTokens(TOKENS)

    const provider = makeProvider()
    await provider.saveDiscoveryState({ authorizationServerUrl: 'https://auth.example.com' })

    expect(await provider.clientInformation()).toMatchObject({ client_id: 'cid' })
    expect(await provider.tokens()).toMatchObject({ access_token: 'at' })
  })
})
