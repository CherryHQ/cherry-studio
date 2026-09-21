import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import {
  IssuerMismatchError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens
} from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The provider constructor reads application.getPath('feature.mcp.oauth'); the
// unified mock supplies a deterministic path so construction never touches Electron.
// We pass an explicit configDir per test, so storage actually lands in a temp dir.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({})
})
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

const { McpOAuthClientProvider } = await import('../provider')

const CLIENT_INFO = { client_id: 'cid', client_secret: 'csecret' } as StoredOAuthClientInformation
const TOKENS = { access_token: 'at', token_type: 'Bearer', refresh_token: 'rt' } as StoredOAuthTokens

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

  it('rejects a callback with a mismatched state and consumes the saved state', async () => {
    const provider = makeProvider()
    const state = await provider.state()

    await expect(provider.validateCallbackState(new URLSearchParams({ state: `${state}-wrong` }))).rejects.toThrow(
      /state mismatch/
    )
    await expect(provider.validateCallbackState(new URLSearchParams({ state }))).rejects.toThrow(/state mismatch/)
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

  it('keeps credentials isolated when the authorization server changes', async () => {
    const seed = makeProvider()
    const oldIssuer = { issuer: 'https://old-auth.example.com' }
    const newIssuer = { issuer: 'https://new-auth.example.com' }
    await seed.saveDiscoveryState({ authorizationServerUrl: oldIssuer.issuer })
    await seed.saveClientInformation(CLIENT_INFO, oldIssuer)
    await seed.saveTokens(TOKENS, oldIssuer)

    const provider = makeProvider()
    await provider.saveDiscoveryState({ authorizationServerUrl: newIssuer.issuer })

    expect(await provider.clientInformation(newIssuer)).toBeUndefined()
    expect(await provider.tokens(newIssuer)).toBeUndefined()
    expect(await provider.clientInformation(oldIssuer)).toEqual(CLIENT_INFO)
    expect(await provider.tokens(oldIssuer)).toEqual(TOKENS)
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

  it.each(['issuer', 'endpoints'] as const)(
    'rediscovers changed %s on a challenge and pins the callback to the redirect issuer',
    async (change) => {
      const serverUrl = 'https://resource.example.com/mcp'
      const oldIssuer = 'https://old-auth.example.com'
      const issuer = change === 'issuer' ? 'https://new-auth.example.com' : oldIssuer
      const oldMetadataUrl = 'https://resource.example.com/old-metadata'
      const resourceMetadataUrl = change === 'issuer' ? 'https://resource.example.com/new-metadata' : oldMetadataUrl
      const metadata = (authIssuer: string, version: string) => ({
        issuer: authIssuer,
        authorization_endpoint: `${authIssuer}/${version}/authorize`,
        token_endpoint: `${authIssuer}/${version}/token`,
        registration_endpoint: `${authIssuer}/${version}/register`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        authorization_response_iss_parameter_supported: true
      })
      const oldDiscovery: OAuthDiscoveryState = {
        authorizationServerUrl: oldIssuer,
        resourceMetadataUrl: oldMetadataUrl,
        resourceMetadata: { resource: serverUrl, authorization_servers: [oldIssuer] },
        authorizationServerMetadata: metadata(oldIssuer, 'old')
      }
      const seed = makeProvider()
      await seed.saveDiscoveryState(oldDiscovery)
      await seed.saveClientInformation({ client_id: 'old-client', issuer: oldIssuer }, { issuer: oldIssuer })
      await seed.saveTokens(
        { access_token: 'old-token', token_type: 'Bearer', issuer: oldIssuer },
        { issuer: oldIssuer }
      )

      const provider = makeProvider()
      const redirect = vi.spyOn(provider, 'redirectToAuthorization').mockResolvedValue()
      const requests: string[] = []
      const tokenRequests: URLSearchParams[] = []
      let callbackPending = false
      let endpointVersion = 'new'
      const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
        authProvider: provider,
        fetch: async (input, init) => {
          const url = input.toString()
          requests.push(url)
          if (url === serverUrl) {
            if (new Headers(init?.headers).get('authorization') === 'Bearer renewed-token') {
              return Response.json({ jsonrpc: '2.0', id: 1, result: {} })
            }
            return new Response(null, {
              status: 401,
              headers: { 'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"` }
            })
          }
          if (url === `${issuer}/${endpointVersion}/token`) {
            tokenRequests.push(new URLSearchParams(String(init?.body)))
            return Response.json({ access_token: 'renewed-token', token_type: 'Bearer', refresh_token: 'new-refresh' })
          }
          if (callbackPending) throw new Error(`Callback unexpectedly rediscovered ${url}`)
          if (url === resourceMetadataUrl) {
            return Response.json({ resource: serverUrl, authorization_servers: [issuer] })
          }
          if (url === `${issuer}/.well-known/oauth-authorization-server`) {
            return Response.json(metadata(issuer, endpointVersion))
          }
          if (url === `${issuer}/new/register`) {
            return Response.json({ ...provider.clientMetadata, client_id: 'new-client' })
          }
          throw new Error(`Unexpected OAuth request: ${url}`)
        }
      })

      await expect(
        provider.withAuthorizationFlow(() => transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' }))
      ).rejects.toBeInstanceOf(UnauthorizedError)
      expect(redirect.mock.calls[0]?.[0].toString()).toContain(`${issuer}/new/authorize`)
      expect(requests).toContain(resourceMetadataUrl)
      if (change === 'issuer') {
        expect(await provider.tokens({ issuer })).toBeUndefined()
        expect(await provider.clientInformation({ issuer: oldIssuer })).toMatchObject({ client_id: 'old-client' })
      }

      // Another challenge cannot overwrite an in-flight redirect's persisted binding.
      await provider.withAuthorizationFlow(() => provider.saveDiscoveryState(oldDiscovery))
      callbackPending = true
      await expect(
        provider.withAuthorizationCallback(() =>
          transport.finishAuth(
            new URLSearchParams({ code: 'authorization-code', iss: 'https://wrong-issuer.example.com' })
          )
        )
      ).rejects.toBeInstanceOf(IssuerMismatchError)
      expect(tokenRequests).toHaveLength(0)
      await provider.withAuthorizationCallback(() =>
        transport.finishAuth(new URLSearchParams({ code: 'authorization-code', iss: issuer }))
      )
      expect(tokenRequests[0]?.get('client_id')).toBe(change === 'issuer' ? 'new-client' : 'old-client')
      expect(tokenRequests[0]?.get('grant_type')).toBe('authorization_code')
      expect(await provider.tokens({ issuer })).toMatchObject({ access_token: 'renewed-token', issuer })

      // A later refresh needs no window, and rediscovers endpoints at the same issuer.
      callbackPending = false
      endpointVersion = 'latest'
      await provider.saveTokens(
        { access_token: 'expired-token', token_type: 'Bearer', refresh_token: 'new-refresh', issuer },
        { issuer }
      )
      await provider.withAuthorizationFlow(() => transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' }))
      expect(tokenRequests[1]?.get('grant_type')).toBe('refresh_token')
      expect(requests).toContain(`${issuer}/latest/token`)
      expect(redirect).toHaveBeenCalledTimes(1)
      await transport.close()
    }
  )
})
