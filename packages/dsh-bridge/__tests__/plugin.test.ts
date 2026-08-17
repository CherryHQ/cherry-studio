import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apply } from '../src/plugin'
import { BRIDGE_SOCKET_ENV, BRIDGE_TOKEN_ENV } from '../src/protocol'

const originalSocket = process.env[BRIDGE_SOCKET_ENV]
const originalToken = process.env[BRIDGE_TOKEN_ENV]

const cleanup: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose()
  if (originalSocket === undefined) delete process.env[BRIDGE_SOCKET_ENV]
  else process.env[BRIDGE_SOCKET_ENV] = originalSocket
  if (originalToken === undefined) delete process.env[BRIDGE_TOKEN_ENV]
  else process.env[BRIDGE_TOKEN_ENV] = originalToken
})

/** Host peer: answers the plugin's `ready` and drives host→plugin requests. */
async function startHost() {
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\cherry-dsh-plugin-${randomUUID()}`
      : path.join(os.tmpdir(), `cdp-${randomUUID().slice(0, 8)}.sock`)
  const requests: Array<{ method: string; params: Record<string, unknown> }> = []
  let peer: net.Socket | undefined
  let transport: JsonRpcLineTransport | undefined
  const server = net.createServer((socket) => {
    peer = socket
    transport = new JsonRpcLineTransport(socket, socket)
    transport.onRequest(async (method, params) => {
      requests.push({ method, params })
      return {}
    })
    transport.start()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  cleanup.push(async () => {
    peer?.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (process.platform !== 'win32') await rm(socketPath, { force: true })
  })
  return {
    socketPath,
    requests,
    request: (method: string, params: object) => {
      if (!transport) throw new Error('plugin has not connected')
      return transport.request(method, params)
    }
  }
}

function makeContext(overrides: Partial<Record<string, unknown>> = {}): Context {
  return {
    agents: { resume: vi.fn(), create: vi.fn(), get: vi.fn() },
    tools: { register: vi.fn(), guard: vi.fn() },
    tokenMeter: { measure: vi.fn() },
    effect: vi.fn(),
    on: vi.fn(),
    get: vi.fn(),
    ...overrides
  } as unknown as Context
}

const openParams = {
  sessionId: 'session-1',
  provider: 'deepseek',
  model: 'deepseek-chat',
  cwd: '/new-workspace',
  resume: true,
  policy: {
    permissionMode: 'default',
    disabledTools: [],
    allowedRoots: ['/new-workspace'],
    readTools: [],
    editTools: [],
    autoApprovedTools: [],
    approvalRequiredTools: []
  },
  tools: []
}

describe('cherry bridge plugin', () => {
  it('rejects a resumed session whose persisted cwd differs from the requested workspace', async () => {
    const host = await startHost()
    const dispose = vi.fn().mockResolvedValue(undefined)
    const resume = vi.fn().mockResolvedValue({
      agent: { session: { header: { cwd: '/old-workspace' } } },
      dispose
    })
    const ctx = makeContext({ agents: { resume, create: vi.fn(), get: vi.fn() } })
    process.env[BRIDGE_SOCKET_ENV] = host.socketPath
    process.env[BRIDGE_TOKEN_ENV] = 'one-time-token'

    apply(ctx)
    await expect
      .poll(() => host.requests[0])
      .toEqual({
        method: 'ready',
        params: { pid: process.pid, token: 'one-time-token' }
      })
    expect(process.env[BRIDGE_TOKEN_ENV]).toBeUndefined()

    await expect(host.request('session/open', openParams)).rejects.toThrow('does not match')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('routes a delegated subagent tool call through the root session', async () => {
    const host = await startHost()
    const register = vi.fn().mockReturnValue(() => {})
    const rootAgent = { id: 'session-1', session: { header: { cwd: '/new-workspace' } } }
    const get = vi.fn((id: string) => (id === 'session-1' ? rootAgent : undefined))
    const ctx = makeContext({
      agents: { resume: vi.fn(), create: vi.fn().mockResolvedValue(rootAgent), get },
      tools: { register, guard: vi.fn() }
    })
    process.env[BRIDGE_SOCKET_ENV] = host.socketPath
    process.env[BRIDGE_TOKEN_ENV] = 'one-time-token'

    apply(ctx)
    await expect.poll(() => host.requests[0]?.method).toBe('ready')

    await host.request('session/open', {
      ...openParams,
      resume: false,
      tools: [{ name: 'echo', description: 'echoes its input', inputSchema: { type: 'object' } }]
    })
    expect(register).toHaveBeenCalledOnce()

    const definition = register.mock.calls[0][0]
    const child = { id: 'child-1', session: { header: { parentSession: 'session-1' } } }
    await definition.execute({ value: 1 }, { agent: child })

    const toolCall = host.requests.find((entry) => entry.method === 'tool/call')
    expect(toolCall?.params).toMatchObject({ sessionId: 'session-1', name: 'echo', args: { value: 1 } })
  })

  it('rejects an unknown method instead of answering it', async () => {
    const host = await startHost()
    process.env[BRIDGE_SOCKET_ENV] = host.socketPath
    process.env[BRIDGE_TOKEN_ENV] = 'one-time-token'

    apply(makeContext())
    await expect.poll(() => host.requests[0]?.method).toBe('ready')

    await expect(host.request('session/teleport', { sessionId: 'session-1' })).rejects.toThrow('unknown cherry bridge')
  })
})
