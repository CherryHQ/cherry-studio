import fs from 'node:fs/promises'
import { createServer, type AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { SdkError, SdkErrorCode, SdkHttpError, UnauthorizedError } from '@modelcontextprotocol/client'
import { createMcpHandler, Server } from '@modelcontextprotocol/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('electron', () => ({
  app: {
    getLocale: () => 'en-US',
    getPreferredSystemLanguages: () => ['en-US']
  },
  net: { fetch: fetchMock },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

import { application } from '@application'
import type { McpServer } from '@shared/data/types/mcpServer'
import { shouldReportFailure } from '@shared/utils/errorReporting'

import { classifyMcpFailure } from '../../failureFacts'
import { McpAuthorizationCompleted, McpOAuthCoordinator } from '../../oauth/McpOAuthCoordinator'
import { McpOAuthClientProvider } from '../../oauth/provider'
import { oauthServerUrlHash } from '../../oauth/storage'
import { createExternalMcpConnection, externalMcpConnectionInternals } from '../ExternalMcpConnection'
import { fetchMcpHandler } from './fetchMcpHandler'

const probeRejectionBody = JSON.stringify({
  jsonRpcError: {
    code: -32603,
    message: 'Failed to handle request: Missing handler for request type: server/discover'
  },
  cause: null,
  localizedMessage: 'Failed to handle request',
  message: 'Failed to handle request'
})

const events = {
  toolsChanged: vi.fn(),
  promptsChanged: vi.fn(),
  resourcesChanged: vi.fn(),
  resourceUpdated: vi.fn(),
  log: vi.fn()
}

const server = {
  id: 'mx-ds-mcp',
  name: 'mx-ds-mcp',
  baseUrl: 'https://mx-ds-mcp.test/mcp',
  type: 'streamableHttp',
  headers: { Authorization: 'Bearer fixture' },
  isActive: true
} as McpServer

const createLog = () => ({ info: vi.fn(), warn: vi.fn(), stdio: vi.fn() })

function createLegacyHandler() {
  return createMcpHandler(
    () => {
      const mcp = new Server({ name: 'mx-ds-mcp', version: '1' }, { capabilities: { tools: {} } })
      mcp.setRequestHandler('tools/list', async () => ({
        tools: [{ name: 'mx_quote', inputSchema: { type: 'object' } }]
      }))
      return mcp
    },
    { legacy: 'stateless' }
  )
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('ExternalMcpConnection transport fallback policy', () => {
  it.each(['auto', 'legacy'] as const)(
    'keeps a real refused TCP connection local during the %s handshake',
    async (mode) => {
      const listener = createServer()
      await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
      const port = (listener.address() as AddressInfo).port
      await new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())))
      const methods: string[] = []
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        if (request.method === 'POST') {
          const method = (await request.clone().json()).method
          methods.push(method)
          if (mode === 'legacy' && method === 'server/discover') return new Response(null, { status: 404 })
        }
        return fetch(request)
      })
      const error = await createExternalMcpConnection({
        server: { ...server, baseUrl: `http://127.0.0.1:${port}/mcp` },
        appVersion: '0.0.0-test',
        events,
        log: createLog(),
        connectTimeoutMs: 5_000
      }).then(
        (connection) => connection.close(),
        (rejection: unknown) => rejection
      )
      expect(error).toBeInstanceOf(Error)
      expect(methods).toEqual(mode === 'auto' ? ['server/discover'] : ['server/discover', 'initialize'])
      const codes: unknown[] = []
      const seen = new Set<object>()
      let cause = error
      while (cause && typeof cause === 'object' && !seen.has(cause)) {
        seen.add(cause)
        if ('code' in cause) codes.push(cause.code)
        cause = 'cause' in cause ? cause.cause : undefined
      }
      expect(codes).toContain('ECONNREFUSED')
      expect(classifyMcpFailure(error, true)).toMatchObject({
        source: 'environment',
        kind: 'expected',
        reason: 'transport_unavailable'
      })
      expect(shouldReportFailure(classifyMcpFailure(error, false))).toBe(true)
    }
  )

  it.each([
    { error: new Error('net::ERR_CONNECTION_REFUSED'), eligible: false },
    { error: new TypeError('net::ERR_CONNECTION_REFUSED'), eligible: true },
    { error: new TypeError('Cannot read properties of undefined'), eligible: true },
    {
      error: new TypeError('Cannot read properties of undefined with a transport cause', {
        cause: Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' })
      }),
      eligible: true
    },
    {
      error: new Error('Request assembly failed with a nested TypeError', {
        cause: new TypeError('Cannot read properties of undefined', {
          cause: Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' })
        })
      }),
      eligible: true
    },
    {
      error: new ReferenceError('Network handler is undefined', {
        cause: Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' })
      }),
      eligible: true
    },
    {
      error: new SyntaxError('Invalid request data', {
        cause: Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' })
      }),
      eligible: true
    },
    {
      error: new SdkError(SdkErrorCode.NotConnected, 'Not connected', undefined, {
        cause: Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' })
      }),
      eligible: true
    }
  ])(
    'retains network provenance without hiding programming errors: $error.name $error.message',
    async ({ error, eligible }) => {
      fetchMock.mockRejectedValueOnce(error)
      const failure = await createExternalMcpConnection({
        server,
        appVersion: '0.0.0-test',
        events,
        log: createLog(),
        connectTimeoutMs: 5_000
      }).then(
        (connection) => connection.close(),
        (rejection: unknown) => rejection
      )
      expect(failure).toBeInstanceOf(Error)
      expect(shouldReportFailure(classifyMcpFailure(failure, true))).toBe(eligible)
      expect(shouldReportFailure(classifyMcpFailure(failure, false))).toBe(true)
    }
  )

  it('coalesces authorization before credentials can be overwritten and releases failed attempts', async () => {
    const coordinator = new McpOAuthCoordinator()
    const controller = new AbortController()
    const first = await coordinator.begin('target', controller.signal)
    const concurrent = coordinator.begin('target', controller.signal)
    first.finish()
    await expect(concurrent).rejects.toBeInstanceOf(McpAuthorizationCompleted)
    const retry = await coordinator.begin('target', controller.signal)
    const waiting = coordinator.begin('target', controller.signal)
    controller.abort(new Error('cancelled'))
    await expect(waiting).rejects.toThrow('cancelled')
    expect(retry.signal.aborted).toBe(true)
    const fresh = await coordinator.begin('target', new AbortController().signal)
    coordinator.close()
    expect(fresh.signal.aborted).toBe(true)
  })
  it('tries the configured URL transport before its compatibility fallback', () => {
    const server = {
      baseUrl: 'https://example.com/mcp',
      type: 'sse'
    } as McpServer
    expect(externalMcpConnectionInternals.transportCandidates(server)).toEqual(['sse', 'streamableHttp'])

    server.type = 'streamableHttp'
    expect(externalMcpConnectionInternals.transportCandidates(server)).toEqual(['streamableHttp', 'sse'])
  })

  it('falls back only for endpoint-shape mismatch status codes', () => {
    expect(
      externalMcpConnectionInternals.isTransportFallbackError(
        new SdkHttpError(SdkErrorCode.ClientHttpFailedToOpenStream, 'HTTP request failed', { status: 405 })
      )
    ).toBe(true)
    expect(
      externalMcpConnectionInternals.isTransportFallbackError(
        new SdkHttpError(SdkErrorCode.ClientHttpAuthentication, 'Unauthorized', { status: 401 })
      )
    ).toBe(false)
    expect(externalMcpConnectionInternals.isTransportFallbackError(new Error('network unavailable'))).toBe(false)
  })

  it('keeps OAuth enabled only for the built-in QVeris server when an API-key Bearer header is configured', () => {
    const qveris: McpServer = {
      id: 'qveris-builtin',
      name: '@cherry/qveris',
      installSource: 'builtin',
      headers: { Authorization: 'Bearer fixture' },
      isActive: true
    }
    expect(externalMcpConnectionInternals.prefersOAuth(qveris)).toBe(true)
    expect(externalMcpConnectionInternals.prefersOAuth({ ...qveris, headers: {} })).toBe(true)
    expect(externalMcpConnectionInternals.prefersOAuth({ ...qveris, installSource: 'manual' })).toBe(false)
    expect(externalMcpConnectionInternals.prefersOAuth({ ...qveris, name: 'manual-server' })).toBe(false)
  })

  it('prefers OAuth tokens over QVeris API key fallback and never leaks the API key to OAuth endpoints', async () => {
    const oauthDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qveris-oauth-test-'))
    const getPathSpy = vi
      .spyOn(application, 'getPath')
      .mockImplementation((key: string, filename?: string) =>
        key === 'feature.mcp.oauth'
          ? path.resolve(oauthDir, filename ?? '')
          : path.resolve('/mock', key, filename ?? '')
      )
    const qverisUrl = 'https://mcp.qveris.ai/mcp'
    const authIssuer = 'https://auth.qveris.ai'
    const qverisServer: McpServer = {
      id: 'qveris-1',
      name: '@cherry/qveris',
      installSource: 'builtin',
      type: 'streamableHttp',
      baseUrl: qverisUrl,
      headers: { APP: 'Cherry Studio', Authorization: 'Bearer fallback-api-key' },
      isActive: true
    }

    const handler = createLegacyHandler()
    try {
      const mcpAuthHeaders: Array<string | null> = []
      const oauthAuthHeaders: Array<{ url: string; authorization: string | null }> = []

      // 1. No cached OAuth token + server rejects fallback API key with 401 -> OAuth discovery runs
      //    without leaking `Authorization: Bearer fallback-api-key` to discovery/registration/token endpoints.
      const seedProvider = new McpOAuthClientProvider({
        serverUrlHash: oauthServerUrlHash(qverisUrl),
        configDir: oauthDir
      })
      await seedProvider.saveClientInformation(
        { client_id: 'public-client', issuer: authIssuer },
        { issuer: authIssuer }
      )
      await seedProvider.saveTokens(
        {
          access_token: 'expired-oauth-token',
          refresh_token: 'refresh-1',
          token_type: 'Bearer',
          issuer: authIssuer
        },
        { issuer: authIssuer }
      )

      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = request.url
        const authHeader = request.headers.get('authorization')

        if (url === qverisUrl) {
          mcpAuthHeaders.push(authHeader)
          if (authHeader !== 'Bearer fresh-oauth-token') {
            return new Response(null, {
              status: 401,
              headers: {
                'WWW-Authenticate':
                  'Bearer resource_metadata="https://mcp.qveris.ai/.well-known/oauth-protected-resource/mcp"'
              }
            })
          }
          return fetchMcpHandler(handler, input, init)
        }

        oauthAuthHeaders.push({ url, authorization: authHeader })
        if (url === 'https://mcp.qveris.ai/.well-known/oauth-protected-resource/mcp') {
          return Response.json({ resource: qverisUrl, authorization_servers: [authIssuer] })
        }
        if (url === `${authIssuer}/.well-known/oauth-authorization-server`) {
          return Response.json({
            issuer: authIssuer,
            authorization_endpoint: `${authIssuer}/oauth/authorize`,
            token_endpoint: `${authIssuer}/oauth/token`,
            registration_endpoint: `${authIssuer}/oauth/register`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['none'],
            code_challenge_methods_supported: ['S256']
          })
        }
        if (url === `${authIssuer}/oauth/token`) {
          // Real QVeris AS rejects `/oauth/token` with 401 invalid_client if any Bearer header is present.
          if (authHeader) {
            return Response.json(
              { error: 'invalid_client', error_description: 'HTTP Basic client authentication is required' },
              { status: 401 }
            )
          }
          return Response.json({
            access_token: 'fresh-oauth-token',
            refresh_token: 'refresh-2',
            token_type: 'Bearer'
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      })

      const refreshedConnection = await createExternalMcpConnection({
        server: qverisServer,
        appVersion: '0.0.0-test',
        events,
        log: createLog(),
        allowInteractiveAuthorization: false,
        connectTimeoutMs: 5_000
      })
      try {
        expect((await refreshedConnection.listTools()).map((tool) => tool.name)).toContain('mx_quote')
        // Cached OAuth token took priority over `fallback-api-key`, then refreshed cleanly to `fresh-oauth-token`.
        expect(mcpAuthHeaders[0]).toBe('Bearer expired-oauth-token')
        expect(mcpAuthHeaders).toContain('Bearer fresh-oauth-token')
        expect(mcpAuthHeaders).not.toContain('Bearer fallback-api-key')
        expect(oauthAuthHeaders.length).toBeGreaterThan(0)
        expect(oauthAuthHeaders.every((entry) => entry.authorization === null)).toBe(true)
      } finally {
        await refreshedConnection.close()
      }

      // 2. When no OAuth session exists yet, QVeris falls back to `QVERIS_API_KEY` on the MCP endpoint;
      //    if that key is rejected with 401 in background mode, OAuth discovery still stays clean and yields UnauthorizedError.
      await seedProvider.invalidateCredentials('all')
      mcpAuthHeaders.length = 0
      oauthAuthHeaders.length = 0

      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = request.url
        const authHeader = request.headers.get('authorization')

        if (url === qverisUrl) {
          mcpAuthHeaders.push(authHeader)
          if (authHeader === 'Bearer valid-fallback-key') {
            return fetchMcpHandler(handler, input, init)
          }
          return new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate':
                'Bearer resource_metadata="https://mcp.qveris.ai/.well-known/oauth-protected-resource/mcp"'
            }
          })
        }

        oauthAuthHeaders.push({ url, authorization: authHeader })
        if (url === 'https://mcp.qveris.ai/.well-known/oauth-protected-resource/mcp') {
          return Response.json({ resource: qverisUrl, authorization_servers: [authIssuer] })
        }
        if (url === `${authIssuer}/.well-known/oauth-authorization-server`) {
          return Response.json({
            issuer: authIssuer,
            authorization_endpoint: `${authIssuer}/oauth/authorize`,
            token_endpoint: `${authIssuer}/oauth/token`,
            registration_endpoint: `${authIssuer}/oauth/register`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['none'],
            code_challenge_methods_supported: ['S256']
          })
        }
        if (url === `${authIssuer}/oauth/register`) {
          return Response.json({ ...seedProvider.clientMetadata, client_id: 'registered-client' })
        }
        throw new Error(`Unexpected request: ${url}`)
      })

      await expect(
        createExternalMcpConnection({
          server: qverisServer,
          appVersion: '0.0.0-test',
          events,
          log: createLog(),
          allowInteractiveAuthorization: false,
          connectTimeoutMs: 5_000
        })
      ).rejects.toSatisfy((err) => UnauthorizedError.isInstance(err))
      expect(mcpAuthHeaders[0]).toBe('Bearer fallback-api-key')
      expect(oauthAuthHeaders.every((entry) => entry.authorization === null)).toBe(true)

      const fallbackConnection = await createExternalMcpConnection({
        server: { ...qverisServer, headers: { APP: 'Cherry Studio', Authorization: 'Bearer valid-fallback-key' } },
        appVersion: '0.0.0-test',
        events,
        log: createLog(),
        allowInteractiveAuthorization: false,
        connectTimeoutMs: 5_000
      })
      await fallbackConnection.close()
    } finally {
      getPathSpy.mockRestore()
      await handler.close()
      await fs.rm(oauthDir, { recursive: true, force: true })
    }
  })
})

describe('ExternalMcpConnection legacy probe rejection', () => {
  it('connects and lists tools when a legacy server rejects server/discover with HTTP 500', async () => {
    const handler = createLegacyHandler()
    const log = createLog()
    let rejectedProbes = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === 'POST' && (await request.clone().json()).method === 'server/discover') {
        rejectedProbes++
        return new Response(probeRejectionBody, { status: 500 })
      }
      return fetchMcpHandler(handler, input, init)
    })
    try {
      const connection = await createExternalMcpConnection({
        server,
        appVersion: '0.0.0-test',
        events,
        log,
        connectTimeoutMs: 5_000
      })
      try {
        expect(connection.era).toBe('legacy')
        expect((await connection.listTools()).map((tool) => tool.name)).toContain('mx_quote')
        expect(rejectedProbes).toBeGreaterThan(0)
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('legacy'), expect.anything())
      } finally {
        await connection.close()
      }
    } finally {
      await handler.close()
    }
  })

  it('connects as legacy when server/discover returns an HTML 5xx body', async () => {
    const handler = createLegacyHandler()
    const log = createLog()
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === 'POST' && (await request.clone().json()).method === 'server/discover') {
        return new Response('<html>502 Bad Gateway</html>', { status: 500 })
      }
      return fetchMcpHandler(handler, input, init)
    })
    try {
      const connection = await createExternalMcpConnection({
        server,
        appVersion: '0.0.0-test',
        events,
        log,
        connectTimeoutMs: 5_000
      })
      try {
        expect(connection.era).toBe('legacy')
        expect((await connection.listTools()).map((tool) => tool.name)).toContain('mx_quote')
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('legacy'), expect.anything())
      } finally {
        await connection.close()
      }
    } finally {
      await handler.close()
    }
  })

  it('connects as legacy when server/discover returns a bare empty 5xx body', async () => {
    const handler = createLegacyHandler()
    const log = createLog()
    let rejectedProbes = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === 'POST' && (await request.clone().json()).method === 'server/discover') {
        rejectedProbes++
        return new Response(null, {
          status: 500,
          headers: { 'content-type': 'application/json;charset=utf-8' }
        })
      }
      return fetchMcpHandler(handler, input, init)
    })
    try {
      const connection = await createExternalMcpConnection({
        server,
        appVersion: '0.0.0-test',
        events,
        log,
        connectTimeoutMs: 5_000
      })
      try {
        expect(connection.era).toBe('legacy')
        expect((await connection.listTools()).map((tool) => tool.name)).toContain('mx_quote')
        expect(rejectedProbes).toBeGreaterThan(0)
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('legacy'), expect.anything())
      } finally {
        await connection.close()
      }
    } finally {
      await handler.close()
    }
  })

  it('returns the original probe error if the legacy handshake also fails', async () => {
    const handler = createLegacyHandler()
    const log = createLog()
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === 'POST') {
        const method = (await request.clone().json()).method
        if (method === 'server/discover') return new Response(probeRejectionBody, { status: 500 })
        if (method === 'initialize') return new Response('<html>502 Bad Gateway</html>', { status: 502 })
      }
      return fetchMcpHandler(handler, input, init)
    })
    try {
      const error = await createExternalMcpConnection({
        server,
        appVersion: '0.0.0-test',
        events,
        log,
        connectTimeoutMs: 5_000
      }).then(
        () => null,
        (rejection: unknown) => rejection
      )
      expect(SdkHttpError.isInstance(error)).toBe(true)
      expect(error).toMatchObject({ code: SdkErrorCode.EraNegotiationFailed, status: 500 })
      expect(log.warn).toHaveBeenCalledWith('Legacy retry failed', expect.anything())
    } finally {
      await handler.close()
    }
  })

  it('keeps a modern server on the modern connection path', async () => {
    const handler = createMcpHandler(
      () => new Server({ name: 'modern-mcp', version: '1' }, { capabilities: { tools: {} } }),
      { legacy: 'reject' }
    )
    const log = createLog()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      fetchMcpHandler(handler, input, init)
    )
    try {
      const connection = await createExternalMcpConnection({
        server,
        appVersion: '0.0.0-test',
        events,
        log,
        connectTimeoutMs: 5_000
      })
      try {
        expect(connection.era).toBe('modern')
        expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('legacy'), expect.anything())
      } finally {
        await connection.close()
      }
    } finally {
      await handler.close()
    }
  })

  it('does not retry a network failure as legacy', async () => {
    fetchMock.mockRejectedValue(new Error('network unavailable'))
    const log = createLog()
    const error = await createExternalMcpConnection({
      server,
      appVersion: '0.0.0-test',
      events,
      log,
      connectTimeoutMs: 5_000
    }).then(
      () => null,
      (rejection: unknown) => rejection
    )
    expect(error).not.toBeNull()
    expect(SdkHttpError.isInstance(error)).toBe(false)
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('legacy'), expect.anything())
  })

  it('keeps HTTP 401 as an authentication failure', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }))
    const error = await createExternalMcpConnection({
      server,
      appVersion: '0.0.0-test',
      events,
      log: createLog(),
      connectTimeoutMs: 5_000
    }).then(
      () => null,
      (rejection: unknown) => rejection
    )
    expect(SdkHttpError.isInstance(error)).toBe(true)
    expect(error).toMatchObject({ code: SdkErrorCode.ClientHttpAuthentication, status: 401 })
  })

  it.each([
    ['reporter wrapper', probeRejectionBody],
    ['standard error envelope', '{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"missing handler"}}'],
    ['arbitrary wrapper', '{"problem":{"code":-32000,"message":"unsupported method"}}']
  ])('recognizes a protocol error in the %s', (_name, text) => {
    expect(
      externalMcpConnectionInternals.isLegacyProbeRejection(
        new SdkHttpError(SdkErrorCode.EraNegotiationFailed, 'Probe failed', { status: 500, statusText: '', text })
      )
    ).toBe(true)
  })

  it.each([
    ['HTML body', SdkErrorCode.EraNegotiationFailed, 500, '<html>502 Bad Gateway</html>'],
    ['HTTP error code', SdkErrorCode.EraNegotiationFailed, 500, '{"code":500,"message":"Internal Server Error"}'],
    ['empty body', SdkErrorCode.EraNegotiationFailed, 500, ''],
    ['invalid JSON', SdkErrorCode.EraNegotiationFailed, 500, 'not JSON'],
    ['non-integer error code', SdkErrorCode.EraNegotiationFailed, 500, '{"error":{"code":-32603.5,"message":"bad"}}'],
    ['missing error message', SdkErrorCode.EraNegotiationFailed, 500, '{"error":{"code":-32603}}'],
    ['undefined text', SdkErrorCode.EraNegotiationFailed, 500, undefined]
  ])('recognizes a bare probe 5xx for %s', (_name, code, status, text) => {
    expect(
      externalMcpConnectionInternals.isLegacyProbeRejection(
        new SdkHttpError(code, 'Probe failed', { status, statusText: '', text })
      )
    ).toBe(true)
  })

  it.each([
    ['HTTP 404', SdkErrorCode.EraNegotiationFailed, 404, probeRejectionBody],
    ['HTTP 401', SdkErrorCode.ClientHttpAuthentication, 401, probeRejectionBody],
    ['HTTP 403', SdkErrorCode.ClientHttpForbidden, 403, probeRejectionBody],
    ['authentication code with HTTP 500', SdkErrorCode.ClientHttpAuthentication, 500, probeRejectionBody]
  ])('rejects %s as legacy probe evidence', (_name, code, status, text) => {
    expect(
      externalMcpConnectionInternals.isLegacyProbeRejection(
        new SdkHttpError(code, 'Probe failed', { status, statusText: '', text })
      )
    ).toBe(false)
  })

  it('rejects network and non-HTTP SDK errors as legacy probe evidence', () => {
    expect(externalMcpConnectionInternals.isLegacyProbeRejection(new Error('network unavailable'))).toBe(false)
    expect(
      externalMcpConnectionInternals.isLegacyProbeRejection(
        new SdkError(SdkErrorCode.EraNegotiationFailed, 'Version negotiation probe failed: network unavailable')
      )
    ).toBe(false)
  })
})
