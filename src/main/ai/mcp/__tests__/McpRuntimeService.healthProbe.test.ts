import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  ProtocolError,
  ProtocolErrorCode,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  SseError,
  UnauthorizedError
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import type { McpServer } from '@shared/data/types/mcpServer'

const catalogMock = vi.hoisted(() => ({
  clearSharedToolsCache: vi.fn(),
  refreshTools: vi.fn().mockResolvedValue(undefined)
}))
const broadcastToType = vi.hoisted(() => vi.fn())
const createExternal = vi.hoisted(() => vi.fn())

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    McpCatalogService: catalogMock,
    IpcApiService: { broadcastToType }
  } as Record<string, unknown>)
})

vi.mock('../connections/ExternalMcpConnection', () => ({ createExternalMcpConnection: createExternal }))

const getById = vi.fn<(id: string) => McpServer>()
vi.mock('@data/services/McpServerService', () => ({ mcpServerService: { getById: (id: string) => getById(id) } }))

const { McpRuntimeService, isInconclusiveHealthProbeError } = await import('../McpRuntimeService')
const { ClientMcpConnection } = await import('../connections/ClientMcpConnection')

const server = { id: 'legacy', name: 'legacy', isActive: true, command: process.execPath } as McpServer
const tools = [{ name: 'echo', inputSchema: { type: 'object' } }]

function connection(health: () => Promise<void>) {
  return {
    era: 'legacy' as const,
    health: vi.fn(health),
    listTools: vi.fn().mockResolvedValue(tools),
    close: vi.fn().mockResolvedValue(undefined)
  }
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('health probe error classification', () => {
  it('recognizes only unsupported or unanswered probes, including wrapped errors', () => {
    const timeout = new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out')
    expect(isInconclusiveHealthProbeError(timeout)).toBe(true)
    expect(
      isInconclusiveHealthProbeError(
        new SdkError(SdkErrorCode.MethodNotSupportedByProtocolVersion, 'Method not supported')
      )
    ).toBe(true)
    expect(isInconclusiveHealthProbeError(new ProtocolError(ProtocolErrorCode.MethodNotFound, 'No ping'))).toBe(true)
    expect(isInconclusiveHealthProbeError(new Error('wrapper', { cause: timeout }))).toBe(true)

    for (const error of [
      new SdkError(SdkErrorCode.NotConnected, 'Not connected'),
      new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed'),
      new SseError(500, 'Server error', {} as ErrorEvent),
      new SdkHttpError(SdkErrorCode.ClientHttpFailedToOpenStream, 'HTTP failed', { status: 500 }),
      new SdkHttpError(SdkErrorCode.RequestTimeout, 'HTTP failed', { status: 500 }),
      new Error('unknown'),
      { code: SdkErrorCode.RequestTimeout }
    ]) {
      expect(isInconclusiveHealthProbeError(error)).toBe(false)
    }
  })
})

describe('McpRuntimeService existing connection probes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    getById.mockReturnValue(server)
    broadcastToType.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each([
    ['timeout', new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out')],
    ['method not found', new ProtocolError(ProtocolErrorCode.MethodNotFound, 'No ping')]
  ])('keeps a usable connection after a %s probe', async (_name, error) => {
    const service = new McpRuntimeService()
    const existing = connection(async () => {
      throw error
    })
    const key = service.getServerKey(server)
    ;(service as any).connections.set(key, existing)
    const create = vi.spyOn(service as any, 'createConnection')

    await expect(service.listTools(server.id)).resolves.toEqual(tools)
    await expect(service.listTools(server.id)).resolves.toEqual(tools)
    expect(existing.listTools).toHaveBeenCalledTimes(2)
    expect(existing.close).not.toHaveBeenCalled()
    expect((service as any).connections.get(key)).toBe(existing)
    expect((service as any).probeFailures.size).toBe(0)
    expect(create).not.toHaveBeenCalled()
  })

  it('replaces a connection after an unknown probe error', async () => {
    const service = new McpRuntimeService()
    const stale = connection(async () => {
      throw new Error('connection is stale')
    })
    const replacement = connection(async () => undefined)
    ;(service as any).connections.set(service.getServerKey(server), stale)
    const create = vi.spyOn(service as any, 'createConnection').mockResolvedValue(replacement)

    await expect(service.listTools(server.id)).resolves.toEqual(tools)
    expect(stale.close).toHaveBeenCalledTimes(1)
    expect(replacement.listTools).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('backs off repeated dead connections and settles after the fifth failed probe', async () => {
    const service = new McpRuntimeService()
    const error = new SdkError(SdkErrorCode.NotConnected, 'Not connected')
    const dead = () =>
      connection(async () => {
        throw error
      })
    const connections = [dead()]
    ;(service as any).connections.set(service.getServerKey(server), connections[0])
    const create = vi.spyOn(service as any, 'createConnection').mockImplementation(async () => {
      const next = dead()
      connections.push(next)
      return next
    })

    await expect(service.listTools(server.id)).resolves.toEqual(tools)
    expect(create).toHaveBeenCalledTimes(1)

    for (const [delay, count] of [
      [20_000, 2],
      [40_000, 3],
      [80_000, 4]
    ] as const) {
      await expect(service.listTools(server.id)).rejects.toBe(error)
      await expect(service.listTools(server.id)).rejects.toBe(error)
      expect(create).toHaveBeenCalledTimes(count - 1)
      await vi.advanceTimersByTimeAsync(delay - 1)
      await expect(service.listTools(server.id)).rejects.toBe(error)
      expect(create).toHaveBeenCalledTimes(count - 1)
      await vi.advanceTimersByTimeAsync(1)
      await expect(service.listTools(server.id)).resolves.toEqual(tools)
      expect(create).toHaveBeenCalledTimes(count)
    }

    await expect(service.listTools(server.id)).rejects.toBe(error)
    expect(MockMainCacheServiceUtils.getSharedCacheValue(`mcp.status.${server.id}`)).toMatchObject({
      state: 'error',
      lastError: 'Not connected'
    })
    const errorLogs = broadcastToType.mock.calls.filter((call) => call[2].level === 'error')
    expect(errorLogs).toHaveLength(1)
    expect(errorLogs[0][2].message).toContain('5 failed health checks')
    await vi.advanceTimersByTimeAsync(160_000)
    await expect(service.listTools(server.id)).rejects.toBe(error)
    expect(connections.at(-1)?.health).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(4)
  })

  it('lets a window-backed caller recover after background OAuth probes fail', async () => {
    const service = new McpRuntimeService()
    const error = new UnauthorizedError('sign-in required')
    const dead = () =>
      connection(async () => {
        throw error
      })
    ;(service as any).connections.set(service.getServerKey(server), dead())
    const prompt = { messages: [] }
    const authorized = { ...connection(async () => undefined), getPrompt: vi.fn().mockResolvedValue(prompt) }
    const create = vi
      .spyOn(service as any, 'createConnection')
      .mockResolvedValueOnce(dead())
      .mockResolvedValueOnce(authorized)

    await expect(service.listTools(server.id)).resolves.toEqual(tools)
    await expect(service.listTools(server.id)).rejects.toBe(error)
    await expect(service.listTools(server.id)).rejects.toBe(error)
    expect(create).toHaveBeenCalledTimes(1)

    await expect(
      service.getPrompt({ serverId: server.id, name: 'welcome', interactionContext: { windowId: 'w1' } })
    ).resolves.toEqual(prompt)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1][1]).toMatchObject({ windowId: 'w1' })
  })

  it('lets restart supersede a terminal probe waiting for close', async () => {
    const service = new McpRuntimeService()
    const error = new SdkError(SdkErrorCode.NotConnected, 'Not connected')
    const dead = () =>
      connection(async () => {
        throw error
      })
    const closed = createDeferred()
    const enteredClose = createDeferred()
    const connections = [dead()]
    ;(service as any).connections.set(service.getServerKey(server), connections[0])
    const create = vi.spyOn(service as any, 'createConnection').mockImplementation(async () => {
      const next = dead()
      connections.push(next)
      return next
    })

    await service.listTools(server.id)
    for (const delay of [20_000, 40_000, 80_000]) {
      await expect(service.listTools(server.id)).rejects.toBe(error)
      await vi.advanceTimersByTimeAsync(delay)
      await service.listTools(server.id)
    }
    connections.at(-1)!.close.mockImplementation(() => {
      enteredClose.resolve()
      return closed.promise
    })

    const pending = service.listTools(server.id)
    await enteredClose.promise
    await expect(service.restartServer(server.id)).resolves.toBeUndefined()
    expect(create).toHaveBeenCalledTimes(5)
    expect(MockMainCacheServiceUtils.getSharedCacheValue(`mcp.status.${server.id}`)).toMatchObject({
      state: 'connected'
    })
    const errorLogsBeforeClose = broadcastToType.mock.calls.filter((call) => call[2].level === 'error').length

    closed.resolve()
    await expect(pending).resolves.toEqual(tools)
    expect(MockMainCacheServiceUtils.getSharedCacheValue(`mcp.status.${server.id}`)).toMatchObject({
      state: 'connected'
    })
    expect(broadcastToType.mock.calls.filter((call) => call[2].level === 'error')).toHaveLength(errorLogsBeforeClose)
  })

  it('publishes an unavailable status during finite probe cooldown and recovers', async () => {
    const service = new McpRuntimeService()
    const error = new SdkError(SdkErrorCode.NotConnected, 'Not connected')
    const dead = () =>
      connection(async () => {
        throw error
      })
    ;(service as any).connections.set(service.getServerKey(server), dead())
    const create = vi
      .spyOn(service as any, 'createConnection')
      .mockResolvedValueOnce(dead())
      .mockResolvedValueOnce(connection(async () => undefined))
    const status = () => MockMainCacheServiceUtils.getSharedCacheValue(`mcp.status.${server.id}`)

    await expect(service.listTools(server.id)).resolves.toEqual(tools)
    expect(status()).toMatchObject({ state: 'connected' })
    await expect(service.listTools(server.id)).rejects.toBe(error)
    expect(status()).toMatchObject({ state: 'error', lastError: 'Not connected' })
    await expect(service.listTools(server.id)).rejects.toBe(error)
    expect(create).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(20_000)
    await expect(service.listTools(server.id)).resolves.toEqual(tools)
    expect(status()).toMatchObject({ state: 'connected' })
  })

  it('clears the streak after a successful probe', async () => {
    const service = new McpRuntimeService()
    const error = new SdkError(SdkErrorCode.NotConnected, 'Not connected')
    const first = connection(async () => {
      throw error
    })
    const healthy = connection(vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(error))
    ;(service as any).connections.set(service.getServerKey(server), first)
    const create = vi
      .spyOn(service as any, 'createConnection')
      .mockResolvedValueOnce(healthy)
      .mockResolvedValueOnce(connection(async () => undefined))

    await expect(service.listTools(server.id)).resolves.toEqual(tools)
    await expect(service.listTools(server.id)).resolves.toEqual(tools)
    await expect(service.listTools(server.id)).resolves.toEqual(tools)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('allows a fresh connection after stopping a settled server', async () => {
    const service = new McpRuntimeService()
    const error = new SdkError(SdkErrorCode.NotConnected, 'Not connected')
    const dead = () =>
      connection(async () => {
        throw error
      })
    ;(service as any).connections.set(service.getServerKey(server), dead())
    const create = vi.spyOn(service as any, 'createConnection').mockImplementation(async () => dead())
    await service.listTools(server.id)
    for (const delay of [20_000, 40_000, 80_000]) {
      await expect(service.listTools(server.id)).rejects.toBe(error)
      await vi.advanceTimersByTimeAsync(delay)
      await service.listTools(server.id)
    }
    await expect(service.listTools(server.id)).rejects.toBe(error)
    expect(create).toHaveBeenCalledTimes(4)

    await service.stopServer(server.id)
    await expect(service.listTools(server.id)).resolves.toEqual(tools)
    expect(create).toHaveBeenCalledTimes(5)
  })
})

describe('legacy stdio health probe wire', () => {
  it('sends ping after initialization, without a second discovery request', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-legacy-health-'))
    const entry = path.join(tempDir, 'server.cjs')
    const traceFile = path.join(tempDir, 'trace.jsonl')
    await fs.writeFile(
      entry,
      `
const fs = require('node:fs');
const traceFile = process.env.TRACE_FILE;
function send(id, body) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...body }) + '\\n'); }
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    const { method, id } = JSON.parse(line);
    if (!method) continue;
    fs.appendFileSync(traceFile, JSON.stringify({ method, id, answered: id !== undefined }) + '\\n');
    if (id === undefined) continue;
    if (method === 'server/discover') send(id, { error: { code: -32601, message: 'Method not found' } });
    else if (method === 'initialize') send(id, { result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'legacy', version: '1.0.0' } } });
    else if (method === 'ping') send(id, { result: {} });
    else if (method === 'tools/list') send(id, { result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } });
    else send(id, { error: { code: -32601, message: 'Method not found' } });
  }
});
`
    )
    const client = new ClientMcpConnection(
      { name: 'health-probe-test', version: '1.0.0' },
      {
        capabilities: { elicitation: { form: {}, url: {} }, sampling: {}, roots: {} },
        versionNegotiation: { mode: 'auto', probe: { timeoutMs: 10_000, maxRetries: 0 } }
      },
      { toolsChanged() {}, promptsChanged() {}, resourcesChanged() {}, resourceUpdated() {}, log() {} }
    )
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [entry],
          env: { ...process.env, TRACE_FILE: traceFile },
          stderr: 'pipe'
        })
      )
      expect(client.era).toBe('legacy')
      await client.health()
      await expect(client.listTools('refresh')).resolves.toEqual(tools)

      const frames = (await fs.readFile(traceFile, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { method: string; id?: number; answered: boolean })
      const methods = frames.map((frame) => frame.method)
      expect(methods.filter((method) => method === 'server/discover')).toHaveLength(1)
      expect(methods.indexOf('server/discover')).toBeLessThan(methods.indexOf('initialize'))
      expect(methods.slice(methods.indexOf('initialize') + 1)).toContain('ping')
      expect(methods.indexOf('ping')).toBeLessThan(methods.indexOf('tools/list'))
      expect(frames.find((frame) => frame.method === 'ping')).toMatchObject({ answered: true })
    } finally {
      await client.close()
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
