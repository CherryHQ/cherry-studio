import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as fileTools from '@deepseek-ai/dsh-tool-fs'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apply } from '../src/plugin'
import { BRIDGE_SOCKET_ENV, BRIDGE_TOKEN_ENV, type BridgePermissionMode } from '../src/protocol'

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
  it('executes fork file tools while a source SDK write holds its target lock', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'cherry-dsh-fork-io-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const sourceCwd = path.join(directory, 'source')
    const childCwd = path.join(directory, 'child')
    await Promise.all([mkdir(sourceCwd), mkdir(childCwd)])
    await writeFile(path.join(childCwd, 'test.txt'), 'copied before parent write')
    const sourceContext = new Context()
    const childContext = new Context()
    let releaseWrite!: () => void
    let enteredWrite!: () => void
    const writeEntered = new Promise<void>((resolve) => {
      enteredWrite = resolve
    })
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    let pendingWrite: Promise<unknown> | undefined
    let writeFinished = false
    try {
      await sourceContext.plugin(LocalFileSystem, { cwd: sourceCwd })
      await childContext.plugin(SystemPrompt)
      await childContext.plugin(ToolRuntime)
      await childContext.plugin(LocalFileSystem, { cwd: childCwd })
      await childContext.plugin(fileTools)
      const child = {
        id: SessionId('child'),
        session: Session.create(
          SessionId('child'),
          [],
          {
            id: SessionId('child'),
            version: 0,
            createdAt: Date.now(),
            cwd: childCwd,
            parentSession: SessionId('source'),
            isSeeded: true
          },
          SessionLogOffset(0)
        )
      } as Agent
      const host = await startHost((method, params) => {
        if (method === 'ready') return {}
        if (params.sessionId !== child.id) throw new Error('wrong session')
        if (method === 'guard/check') return { kind: 'allow' }
        throw new Error(`unexpected request ${method}`)
      })
      process.env[BRIDGE_SOCKET_ENV] = host.socketPath
      process.env[BRIDGE_TOKEN_ENV] = 'one-time-token'
      apply(
        makeContext({
          agents: {
            resume: async () => ({ agent: child }),
            get: (id: string) => (id === child.id ? child : undefined)
          },
          tools: childContext.tools,
          on: childContext.on.bind(childContext),
          effect: childContext.effect.bind(childContext),
          get: childContext.get.bind(childContext)
        })
      )
      await expect.poll(() => host.requests[0]?.method).toBe('ready')
      await host.request('session/open', {
        ...openParams,
        sessionId: child.id,
        cwd: childCwd,
        policy: {
          ...openParams.policy,
          permissionMode: 'acceptEdits',
          allowedRoots: [childCwd],
          readTools: ['read'],
          editTools: ['write']
        }
      })
      ;(sourceContext.fs as LocalFileSystem).internals.inspectTemp = async () => {
        enteredWrite()
        await writeReleased
      }
      const target = await sourceContext.fs.resolve('parent-writing.txt')
      pendingWrite = sourceContext.fs.writeText(target, 'parent completed').then(() => {
        writeFinished = true
      })
      await Promise.race([writeEntered, pendingWrite])
      const signal = AbortSignal.timeout(3000)
      const read = await childContext.tools.execute({
        callId: ToolCallId('read-child'),
        name: 'read',
        arguments: { file_path: 'test.txt' },
        agent: child,
        signal
      })
      expect(read.isError).toBe(false)
      expect(JSON.stringify(read.content)).toContain('copied before parent write')
      const write = await childContext.tools.execute({
        callId: ToolCallId('write-child'),
        name: 'write',
        arguments: { file_path: 'test2.txt', content: 'child created' },
        agent: child,
        signal
      })
      expect(write.isError).toBe(false)
      expect(await readFile(path.join(childCwd, 'test2.txt'), 'utf8')).toBe('child created')
      expect(writeFinished).toBe(false)
      releaseWrite()
      await pendingWrite
      expect(await readFile(path.join(sourceCwd, 'parent-writing.txt'), 'utf8')).toBe('parent completed')
      expect(await readFile(path.join(childCwd, 'test.txt'), 'utf8')).toBe('copied before parent write')
    } finally {
      releaseWrite()
      try {
        await pendingWrite
      } finally {
        await Promise.all([sourceContext.fiber.dispose(), childContext.fiber.dispose()])
      }
    }
  })

  it.each([true, false])('keeps fork tools and approvals local when the source is live: %s', async (sourceIsLive) => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'cherry-dsh-fork-policy-'))
    cleanup.push(() => rm(cwd, { recursive: true, force: true }))
    await writeFile(path.join(cwd, 'test.txt'), 'child copy')
    let expectedSessionId = 'session-1'
    const host = await startHost((method, params) => {
      if (method === 'ready') return {}
      if (params.sessionId !== expectedSessionId) throw new Error('wrong session')
      if (method === 'guard/check') return { kind: 'allow' }
      if (method === 'tool/call') return { text: 'child tool result' }
      if (method === 'approval/ask') return { outcome: 'allowed-once' }
      throw new Error(`unexpected request ${method}`)
    })
    const source = { id: 'source', session: { header: { cwd: '/source' } } } as Agent
    const fork = {
      id: 'session-1',
      session: { header: { cwd, parentSession: 'source', isSeeded: true }, snapshotEvents: () => [{ seq: 10 }] }
    } as unknown as Agent
    const grandchild = {
      id: 'grandchild',
      session: { header: { cwd, parentSession: 'session-1', isSeeded: true } }
    } as Agent
    const delegated = {
      id: 'delegated',
      session: { header: { cwd, parentSession: 'session-1', origin: 'subagent' } }
    } as Agent
    const agents = new Map([
      ['session-1', fork],
      ['grandchild', grandchild],
      ['delegated', delegated]
    ])
    if (sourceIsLive) agents.set('source', source)
    let preExecute: PreExecuteHandler | undefined
    let approve: ((request: ApprovalRequest) => Promise<ApprovalOutcome>) | undefined
    const register = vi.fn().mockReturnValue(() => {})
    const ctx = makeContext({
      agents: {
        resume: async ({ resumeSessionId }: { resumeSessionId: string }) => ({ agent: agents.get(resumeSessionId) }),
        get: (id: string) => agents.get(id)
      },
      tools: { register, guard: vi.fn() },
      on: (event: string, handler: unknown) => {
        if (event === 'tools/pre-execute') preExecute = handler as PreExecuteHandler
        if (event === 'approval/request') approve = handler as typeof approve
      }
    })
    process.env[BRIDGE_SOCKET_ENV] = host.socketPath
    process.env[BRIDGE_TOKEN_ENV] = 'one-time-token'
    apply(ctx)
    await expect.poll(() => host.requests[0]?.method).toBe('ready')
    const policy = {
      ...openParams.policy,
      allowedRoots: [cwd],
      readTools: ['read'],
      editTools: ['write'],
      planSafeTools: ['list_agents'],
      autoApprovedTools: ['list_agents', 'echo']
    }
    await host.request('session/open', {
      ...openParams,
      cwd,
      policy,
      tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' } }]
    })
    if (!preExecute || !approve) throw new Error('missing bridge handlers')
    for (const mode of ['default', 'acceptEdits', 'bypassPermissions', 'plan'] satisfies BridgePermissionMode[]) {
      await host.request('policy/update', { sessionId: fork.id, policy: { ...policy, permissionMode: mode } })
      for (const name of ['read', 'list_agents']) {
        await expect(preExecute({ agent: fork, name, arguments: { file_path: 'test.txt' } }, vi.fn())).resolves.toEqual(
          { kind: 'allow' }
        )
      }
      await expect(
        preExecute({ agent: fork, name: 'write', arguments: { file_path: 'test2.txt' } }, vi.fn())
      ).resolves.toMatchObject({ kind: mode === 'default' ? 'ask' : mode === 'plan' ? 'deny' : 'allow' })
    }
    await host.request('policy/update', { sessionId: fork.id, policy })
    await expect(
      preExecute({ agent: delegated, name: 'write', arguments: { file_path: 'test2.txt' } }, vi.fn())
    ).resolves.toMatchObject({ kind: 'deny', reason: expect.stringContaining('delegated subagent') })
    await expect(approve({ agent: fork, toolName: 'write', reason: 'needs approval' })).resolves.toBe('allowed-once')
    const definition = register.mock.calls[0][0]
    for (const agent of [fork, delegated]) {
      await expect(definition.execute({}, { agent })).resolves.toEqual({ text: 'child tool result' })
    }
    expect(
      host.requests.filter(({ method }) => method === 'guard/check').every(({ params }) => params.sessionId === fork.id)
    ).toBe(true)

    // A second-generation fork is another execution root, not a delegated child.
    await host.request('session/open', { ...openParams, sessionId: grandchild.id, cwd, policy })
    expectedSessionId = grandchild.id
    agents.delete('source')
    agents.delete(fork.id)
    await expect(
      preExecute({ agent: grandchild, name: 'read', arguments: { file_path: 'test.txt' } }, vi.fn())
    ).resolves.toEqual({ kind: 'allow' })
    expect(host.requests.at(-1)).toMatchObject({ method: 'guard/check', params: { sessionId: grandchild.id } })
  })

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

  it.each([undefined, ''])('denies native tools when the session cwd is %s', async (cwd) => {
    const host = await startHost()
    const agent = { id: 'session-1', session: { header: { cwd } } } as Agent
    let preExecute: PreExecuteHandler | undefined
    const ctx = makeContext({
      on: (event: string, handler: unknown) => {
        if (event === 'tools/pre-execute') preExecute = handler as PreExecuteHandler
        return () => undefined
      }
    })
    process.env[BRIDGE_SOCKET_ENV] = host.socketPath
    process.env[BRIDGE_TOKEN_ENV] = 'one-time-token'
    apply(ctx)
    await expect.poll(() => host.requests[0]?.method).toBe('ready')
    if (!preExecute) throw new Error('tools/pre-execute handler was not registered')

    await expect(
      preExecute({ agent, name: 'bash', arguments: { command: 'echo ok' } }, async () => {
        throw new Error('An unscoped native tool must never execute')
      })
    ).resolves.toEqual({ kind: 'deny', reason: 'The tool caller has no verified workspace directory.' })
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

  it('correlates a plan review with the newest matching exit_plan_mode call', async () => {
    const host = await startHost()
    const plan = '# Revised plan'
    const agent = {
      id: 'session-1',
      session: {
        snapshotEvents: () => [
          {
            type: 'tool/call',
            seq: 7,
            data: { callId: 'exit-plan-call-1', name: 'exit_plan_mode', arguments: JSON.stringify({ plan }) }
          },
          {
            type: 'tool/call',
            seq: 9,
            data: { callId: 'exit-plan-call-2', name: 'exit_plan_mode', arguments: JSON.stringify({ plan }) }
          }
        ]
      }
    } as unknown as Agent
    let ask: ((request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>) | undefined
    const on = vi.fn((event: string, handler: unknown) => {
      if (event === 'user-questions/request') ask = handler as typeof ask
      return () => undefined
    })
    const ctx = makeContext({
      agents: { resume: vi.fn(), create: vi.fn(), get: vi.fn(() => agent) },
      on
    })
    process.env[BRIDGE_SOCKET_ENV] = host.socketPath
    process.env[BRIDGE_TOKEN_ENV] = 'one-time-token'

    apply(ctx)
    await expect.poll(() => host.requests[0]?.method).toBe('ready')
    if (!ask) throw new Error('user-questions listener was not registered')

    const answer = ask({
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
        params: { sessionId: 'session-1', callId: 'exit-plan-call-2', sessionEventSeq: 9 }
      })
    await expect(answer).resolves.toEqual({})
  })

  it('correlates approval requests with the durable session event', async () => {
    const host = await startHost((method) => (method === 'approval/ask' ? { outcome: 'rejected' } : {}))
    const agent = {
      id: 'session-1',
      session: { snapshotEvents: () => [{ type: 'approval/asked', seq: 12, data: { id: 'ask-1', toolName: 'bash' } }] }
    } as unknown as Agent
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
    expect(host.requests.find((request) => request.method === 'approval/ask')?.params).toMatchObject({
      sessionId: 'session-1',
      sessionEventSeq: 12
    })
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
