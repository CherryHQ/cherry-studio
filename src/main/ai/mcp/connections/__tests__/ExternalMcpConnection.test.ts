import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { SdkError, SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client'
import { createMcpHandler, Server } from '@modelcontextprotocol/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, openMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), openMock: vi.fn() }))
vi.mock('open', () => ({ default: openMock }))
vi.mock('electron', () => ({
  net: { fetch: fetchMock },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({})
})

import { application } from '@application'
import type { McpServer } from '@shared/data/types/mcpServer'

import { McpAuthorizationCompleted, McpOAuthCoordinator } from '../../oauth/McpOAuthCoordinator'
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

function createLegacyHandler(toolName = 'mx_quote') {
  return createMcpHandler(
    () => {
      const mcp = new Server({ name: 'mx-ds-mcp', version: '1' }, { capabilities: { tools: {} } })
      mcp.setRequestHandler('tools/list', async () => ({
        tools: [{ name: toolName, inputSchema: { type: 'object' } }]
      }))
      return mcp
    },
    { legacy: 'stateless' }
  )
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('ExternalMcpConnection OAuth accounts', () => {
  let configDir: string
  const issuer = 'https://accounts.test'
  const baseUrl = 'https://mcp.accounts.test/mcp'
  const handlers = new Map<string, ReturnType<typeof createLegacyHandler>>()
  const connections: Awaited<ReturnType<typeof createExternalMcpConnection>>[] = []
  const refreshes: string[] = []
  let account: string
  let expired: Set<string>
  let coordinator: McpOAuthCoordinator

  const finishAuthorization = async (url: string, owner: string) => {
    const authorization = new URL(url)
    const callback = new URL(authorization.searchParams.get('redirect_uri')!)
    callback.searchParams.set('code', owner)
    callback.searchParams.set('state', authorization.searchParams.get('state')!)
    callback.searchParams.set('iss', issuer)
    await fetch(callback)
  }

  const connect = async (id: string, signal?: AbortSignal) => {
    const connection = await createExternalMcpConnection({
      server: { ...server, id, name: id, baseUrl, headers: {} },
      appVersion: 'test',
      events,
      log: createLog(),
      connectTimeoutMs: 10_000,
      oauthCoordinator: coordinator,
      signal
    })
    connections.push(connection)
    return connection
  }

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-accounts-'))
    vi.mocked(application.getPath).mockReturnValue(configDir)
    coordinator = new McpOAuthCoordinator()
    account = 'A'
    expired = new Set()
    refreshes.length = 0
    for (const id of ['A', 'B']) handlers.set(id, createLegacyHandler(`account_${id}`))
    openMock.mockReset().mockImplementation((url: string) => finishAuthorization(url, account))
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.url === baseUrl) {
        const token = request.headers.get('authorization')?.replace('Bearer ', '')
        const owner = token?.replace('renewed-', '')
        if (owner && handlers.has(owner) && !expired.has(token!)) {
          return fetchMcpHandler(handlers.get(owner)!, input, init)
        }
        return new Response(null, {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.accounts.test/metadata"' }
        })
      }
      if (request.url === 'https://mcp.accounts.test/metadata') {
        return Response.json({ resource: baseUrl, authorization_servers: [issuer] })
      }
      if (request.url === `${issuer}/.well-known/oauth-authorization-server`) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          registration_endpoint: `${issuer}/register`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none']
        })
      }
      if (request.url === `${issuer}/register`) {
        return Response.json({ ...(await request.json()), client_id: 'test-client' })
      }
      if (request.url === `${issuer}/token`) {
        const body = new URLSearchParams(await request.text())
        const refreshing = body.get('grant_type') === 'refresh_token'
        const owner = refreshing ? body.get('refresh_token')!.replace('refresh-', '') : body.get('code')!
        if (refreshing) refreshes.push(owner)
        return Response.json({
          access_token: refreshing ? `renewed-${owner}` : owner,
          token_type: 'Bearer',
          refresh_token: `refresh-${owner}`
        })
      }
      return new Response(null, { status: 404 })
    })
  })

  afterEach(async () => {
    coordinator.close()
    await Promise.all(connections.splice(0).map((connection) => connection.close()))
    await Promise.all([...handlers.values()].map((handler) => handler.close()))
    handlers.clear()
    await fs.rm(configDir, { recursive: true, force: true })
  })

  it('authorizes two configurations independently and preserves each account through reconnect and refresh', async () => {
    const first = await connect('mcp01')
    expect((await first.listTools())[0]?.name).toBe('account_A')
    account = 'B'
    const second = await connect('mcp02')
    expect((await second.listTools())[0]?.name).toBe('account_B')
    expect(openMock).toHaveBeenCalledTimes(2)
    await first.close()
    await second.close()

    expired.add('A')
    const reconnectedA = await connect('mcp01')
    const reconnectedB = await connect('mcp02')
    expect((await reconnectedA.listTools())[0]?.name).toBe('account_A')
    expect((await reconnectedB.listTools())[0]?.name).toBe('account_B')
    expect(refreshes).toEqual(['A'])
    expect(openMock).toHaveBeenCalledTimes(2)
  })

  it('releases the callback listener after cancellation so another account can authorize', async () => {
    openMock.mockImplementationOnce(async () => undefined)
    const cancelled = new AbortController()
    const first = connect('mcp01', cancelled.signal)
    const rejected = expect(first).rejects.toThrow('cancel account A')
    await vi.waitFor(() => expect(openMock).toHaveBeenCalledTimes(1))
    account = 'B'
    const second = connect('mcp02')
    cancelled.abort(new Error('cancel account A'))
    await rejected
    expect((await (await second).listTools())[0]?.name).toBe('account_B')
    expect(openMock).toHaveBeenCalledTimes(2)
  })

  it('queues concurrent accounts and binds each callback to its own state and PKCE challenge', async () => {
    openMock.mockImplementationOnce(async () => undefined)
    const first = connect('mcp01')
    await vi.waitFor(() => expect(openMock).toHaveBeenCalledTimes(1))
    account = 'B'
    const second = connect('mcp02')
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input) === `${issuer}/.well-known/oauth-authorization-server`)
          .length
      ).toBeGreaterThanOrEqual(2)
    )
    expect(openMock).toHaveBeenCalledTimes(1)
    await finishAuthorization(openMock.mock.calls[0][0], 'A')
    const [a, b] = await Promise.all([first, second])
    expect((await a.listTools())[0]?.name).toBe('account_A')
    expect((await b.listTools())[0]?.name).toBe('account_B')
    expect(openMock).toHaveBeenCalledTimes(2)
    for (const parameter of ['state', 'code_challenge']) {
      const values = openMock.mock.calls.map(([url]) => new URL(url).searchParams.get(parameter))
      expect(values.every(Boolean)).toBe(true)
      expect(new Set(values).size).toBe(2)
    }
  })
})

describe('ExternalMcpConnection transport fallback policy', () => {
  it('queues different accounts until callback cleanup finishes and skips cancelled waiters', async () => {
    const coordinator = new McpOAuthCoordinator()
    const cleanup = Promise.withResolvers<void>()
    const active = await coordinator.begin('A', new AbortController().signal, () => cleanup.promise)
    const cancelled = new AbortController()
    const middle = coordinator.begin('B', cancelled.signal)
    const rejected = expect(middle).rejects.toThrow('cancel B')
    const acquired = vi.fn()
    const last = coordinator.begin('C', new AbortController().signal).then((lease) => {
      acquired()
      return lease
    })
    cancelled.abort(new Error('cancel B'))
    await rejected
    active.finish(new Error('cancel A'))
    await Promise.resolve()
    expect(acquired).not.toHaveBeenCalled()
    cleanup.resolve()
    const finalLease = await last
    expect(acquired).toHaveBeenCalledTimes(1)
    finalLease.finish()
  })
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
