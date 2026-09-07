import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { UserQuestionProvider } from '@deepseek-ai/dsh-user-questions'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apply } from '../src/plugin'
import { BRIDGE_SOCKET_ENV, BRIDGE_TOKEN_ENV } from '../src/protocol'

type PreExecuteHandler = (
  exec: { agent?: Agent; name: string; arguments: unknown; signal?: AbortSignal },
  next: () => unknown
) => Promise<unknown>

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
async function startHost(
  respond: (method: string, params: Record<string, unknown>) => unknown | Promise<unknown> = () => ({})
) {
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
      return respond(method, params)
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

function textOf(message: unknown): string | undefined {
  const content = (message as { content?: Array<{ type: string; text?: string }> }).content
  return content?.find((block) => block.type === 'text')?.text
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
    approvalRequiredTools: [],
    nonBypassableApprovalTools: []
  },
  tools: []
}

describe('cherry bridge plugin', () => {
  it('checks root and delegated native tool calls with Main before local permission policy', async () => {
    const host = await startHost((method) =>
      method === 'guard/check' ? { kind: 'deny', ruleId: 'user-data-sqlite-write', reason: 'protected SQLite' } : {}
    )
    const rootAgent = { id: 'session-1', session: { header: { cwd: '/root-workspace' } } } as Agent
    const childAgent = {
      id: 'child-1',
      session: { header: { cwd: '/child-workspace', parentSession: 'session-1' } }
    } as Agent
    let preExecute: PreExecuteHandler | undefined
    const on = vi.fn((event: string, handler: unknown) => {
      if (event === 'tools/pre-execute') preExecute = handler as PreExecuteHandler
      return () => undefined
    })
    const get = vi.fn((id: string) => (id === 'session-1' ? rootAgent : undefined))
    const ctx = makeContext({ agents: { resume: vi.fn(), create: vi.fn(), get }, on })
    process.env[BRIDGE_SOCKET_ENV] = host.socketPath
    process.env[BRIDGE_TOKEN_ENV] = 'one-time-token'

    apply(ctx)
    await expect.poll(() => host.requests[0]?.method).toBe('ready')
    if (!preExecute) throw new Error('tools/pre-execute handler was not registered')

    const next = vi.fn()
    for (const agent of [rootAgent, childAgent]) {
      await expect(
        preExecute({ agent, name: 'write', arguments: { file_path: '/user-data/app.sqlite' } }, next)
      ).resolves.toEqual({
        kind: 'deny',
        ruleId: 'user-data-sqlite-write',
        reason: 'protected SQLite'
      })
    }
    expect(next).not.toHaveBeenCalled()
    expect(host.requests.filter((request) => request.method === 'guard/check')).toEqual([
      {
        method: 'guard/check',
        params: {
          sessionId: 'session-1',
          toolName: 'write',
          args: { file_path: '/user-data/app.sqlite' },
          cwd: '/root-workspace'
        }
      },
      {
        method: 'guard/check',
        params: {
          sessionId: 'session-1',
          toolName: 'write',
          args: { file_path: '/user-data/app.sqlite' },
          cwd: '/child-workspace'
        }
      }
    ])
  })

  it('fails closed when Main cannot complete guard/check', async () => {
    const host = await startHost((method) => {
      if (method === 'guard/check') throw new Error('guard unavailable')
      return {}
    })
    const agent = { id: 'session-1', session: { header: { cwd: '/workspace' } } } as Agent
    let preExecute: PreExecuteHandler | undefined
    const on = vi.fn((event: string, handler: unknown) => {
      if (event === 'tools/pre-execute') preExecute = handler as PreExecuteHandler
      return () => undefined
    })
    const ctx = makeContext({ on })
    process.env[BRIDGE_SOCKET_ENV] = host.socketPath
    process.env[BRIDGE_TOKEN_ENV] = 'one-time-token'

    apply(ctx)
    await expect.poll(() => host.requests[0]?.method).toBe('ready')
    if (!preExecute) throw new Error('tools/pre-execute handler was not registered')

    await expect(preExecute({ agent, name: 'bash', arguments: { command: 'echo ok' } }, vi.fn())).resolves.toEqual({
      kind: 'deny',
      reason: 'The Cherry Studio safety guard could not verify this tool call.'
    })
  })

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
    const rootAgent = {
      id: 'session-1',
      session: { header: { cwd: '/new-workspace' } },
      ctx: { on: vi.fn(), systemPrompt: { section: vi.fn() } }
    }
    const get = vi.fn((id: string) => (id === 'session-1' ? rootAgent : undefined))
    const ctx = makeContext({
      agents: { resume: vi.fn(), create: vi.fn().mockResolvedValue({ agent: rootAgent }), get },
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

  it('correlates a plan review with the newest matching exit_plan_mode call', async () => {
    const host = await startHost()
    const plan = '# Revised plan'
    const agent = {
      id: 'session-1',
      session: {
        events: [
          {
            type: 'tool/call',
            data: { callId: 'exit-plan-call-1', name: 'exit_plan_mode', arguments: JSON.stringify({ plan }) }
          },
          {
            type: 'tool/call',
            data: { callId: 'exit-plan-call-2', name: 'exit_plan_mode', arguments: JSON.stringify({ plan }) }
          }
        ]
      }
    } as unknown as Agent
    let provider: UserQuestionProvider | undefined
    const registerProvider = vi.fn((candidate: UserQuestionProvider) => {
      provider = candidate
      return () => undefined
    })
    const effect = vi.fn((factory: () => unknown) => {
      const disposer = factory()
      if (typeof disposer === 'function') cleanup.push(disposer as () => void)
      return () => undefined
    })
    const ctx = makeContext({
      agents: { resume: vi.fn(), create: vi.fn(), get: vi.fn(() => agent) },
      userQuestions: { registerProvider },
      effect
    })
    process.env[BRIDGE_SOCKET_ENV] = host.socketPath
    process.env[BRIDGE_TOKEN_ENV] = 'one-time-token'

    apply(ctx)
    await expect.poll(() => host.requests[0]?.method).toBe('ready')
    if (!provider) throw new Error('user-questions provider was not registered')

    const answer = provider.ask({
      agent,
      questions: [
        {
          id: 'plan-review',
          question: 'Approve?',
          detail: plan,
          options: [{ label: 'Approve' }],
          intent: { kind: 'plan-review', approve: 'Approve' }
        }
      ]
    })
    await expect
      .poll(() => host.requests.find((request) => request.method === 'question/ask'))
      .toMatchObject({
        params: { sessionId: 'session-1', callId: 'exit-plan-call-2' }
      })
    await expect(answer).resolves.toEqual({})
  })

  it('delivers rejected approval feedback to the same agent after settling the outcome', async () => {
    const host = await startHost((method) =>
      method === 'approval/ask' ? { outcome: 'rejected', rejectionReason: 'use a copy instead' } : {}
    )
    const followup = vi.fn()
    const agent = { id: 'session-1', followup, session: { events: [] } } as unknown as Agent
    let approvalHandler: ((request: ApprovalRequest) => Promise<ApprovalOutcome>) | undefined
    const on = vi.fn((event: string, handler: unknown) => {
      if (event === 'approval/request') {
        approvalHandler = handler as (request: ApprovalRequest) => Promise<ApprovalOutcome>
      }
      return () => undefined
    })
    const ctx = makeContext({ on })
    process.env[BRIDGE_SOCKET_ENV] = host.socketPath
    process.env[BRIDGE_TOKEN_ENV] = 'one-time-token'

    apply(ctx)
    await expect.poll(() => host.requests[0]?.method).toBe('ready')
    if (!approvalHandler) throw new Error('approval handler was not registered')

    await expect(
      approvalHandler({
        agent,
        toolName: 'bash',
        callId: 'call-with-feedback',
        reason: 'needs approval'
      } as ApprovalRequest)
    ).resolves.toBe('rejected')
    expect(followup).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(followup).toHaveBeenCalledOnce())
    expect(followup).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        source: { kind: 'user' },
        content: [
          {
            type: 'text',
            text: 'Tool approval feedback for "bash":\nuse a copy instead'
          }
        ]
      })
    )
  })

  it('keeps the latest turn context in an agent-scoped system section without persisting it as user text', async () => {
    const host = await startHost()
    const followup = vi.fn()
    const listeners = new Map<string, (payload: { message: unknown; turn: number }) => void>()
    let section: { text: () => string } | undefined
    const registerSection = vi.fn((candidate: { text: () => string }) => {
      section = candidate
      return () => undefined
    })
    const agent = {
      id: 'session-1',
      followup,
      session: { header: { cwd: '/new-workspace' } },
      ctx: {
        on: vi.fn((event: string, listener: (payload: { message: unknown; turn: number }) => void) => {
          listeners.set(event, listener)
        }),
        systemPrompt: { section: registerSection }
      }
    } as unknown as Agent
    const get = vi.fn(() => agent)
    const ctx = makeContext({
      agents: { resume: vi.fn(), create: vi.fn().mockResolvedValue({ agent }), get },
      systemPrompt: {}
    })
    process.env[BRIDGE_SOCKET_ENV] = host.socketPath
    process.env[BRIDGE_TOKEN_ENV] = 'one-time-token'

    apply(ctx)
    await expect.poll(() => host.requests[0]?.method).toBe('ready')
    await host.request('session/open', { ...openParams, resume: false })
    await expect(host.request('session/open', { ...openParams, resume: false })).rejects.toThrow(
      'session "session-1" is already open'
    )

    await host.request('session/prompt', {
      sessionId: 'session-1',
      contentBlocks: [{ type: 'text', text: 'first user message' }],
      systemPromptAppend: 'Runtime one'
    })
    await host.request('session/prompt', {
      sessionId: 'session-1',
      contentBlocks: [{ type: 'text', text: 'second user message' }],
      systemPromptAppend: 'Runtime two'
    })

    expect(section?.text()).toBe('')
    listeners.get('agent/inbox/claimed')?.({ message: followup.mock.calls[0][0], turn: 1 })
    expect(section?.text()).toBe('Runtime one')
    expect(section?.text()).toBe('Runtime one')
    listeners.get('agent/inbox/claimed')?.({ message: followup.mock.calls[1][0], turn: 2 })
    expect(registerSection).toHaveBeenCalledOnce()
    expect(section?.text()).toBe('Runtime two')

    await host.request('session/prompt', {
      sessionId: 'session-1',
      contentBlocks: [{ type: 'text', text: 'third user message' }]
    })

    listeners.get('agent/inbox/claimed')?.({ message: followup.mock.calls[2][0], turn: 3 })
    expect(section?.text()).toBe('')
    expect(followup.mock.calls.map(([message]) => textOf(message))).toEqual([
      'first user message',
      'second user message',
      'third user message'
    ])
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
