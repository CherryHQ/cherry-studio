import net from 'node:net'
import os from 'node:os'

import type { BridgeNotificationMap } from '@cherrystudio/dsh-bridge'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeEvent } from '../../types'
import { DshBridgeServer, type DshBridgeServerOptions } from '../DshBridgeServer'

const SESSION_ID = 'dsh-bridge-test-session'

/** One host→plugin request seen by the fake plugin, with its response handles. */
interface HostRequest {
  method: string
  params: Record<string, unknown>
  respond: (result: unknown) => void
  fail: (message: string) => void
}

interface Harness {
  server: DshBridgeServer
  socket: net.Socket
  transport: JsonRpcLineTransport
  events: AgentRuntimeEvent[]
  lifecycleEdges: Array<BridgeNotificationMap['subagent/lifecycle']>
  nextRequest: () => Promise<HostRequest>
}

const harnesses: Harness[] = []

function makeServer(
  userResponse: 'stream' | 'message' | 'unavailable' = 'stream',
  onToolCall: (name: string, args: unknown, signal: AbortSignal) => Promise<{ text: string; data?: unknown }> = () =>
    Promise.reject(new Error('unexpected tool call')),
  readyTimeoutMs?: number,
  onGuardCheck: DshBridgeServerOptions['onGuardCheck'] = async () => ({ kind: 'allow' })
): { server: DshBridgeServer; events: AgentRuntimeEvent[]; lifecycleEdges: Harness['lifecycleEdges'] } {
  const events: AgentRuntimeEvent[] = []
  const lifecycleEdges: Harness['lifecycleEdges'] = []
  const server = new DshBridgeServer({
    sessionId: SESSION_ID,
    emit: (event) => events.push(event),
    getInteractionState: () => ({ userResponse }),
    onToolCall,
    onGuardCheck,
    onSubagentLifecycle: (edge) => lifecycleEdges.push(edge),
    ...(readyTimeoutMs === undefined ? {} : { readyTimeoutMs })
  })
  return { server, events, lifecycleEdges }
}

/** Connect a JSON-RPC peer that records host requests; authenticates unless a token is given. */
async function connectPlugin(
  server: DshBridgeServer,
  options: { token?: string; skipReady?: boolean } = {}
): Promise<{ socket: net.Socket; transport: JsonRpcLineTransport; nextRequest: () => Promise<HostRequest> }> {
  const queued: HostRequest[] = []
  const waiters: Array<(request: HostRequest) => void> = []
  const socket = net.connect(server.socketPath)
  socket.on('error', () => undefined)
  const transport = new JsonRpcLineTransport(socket, socket)
  transport.onRequest(
    (method, params) =>
      new Promise<unknown>((resolve, reject) => {
        const request: HostRequest = { method, params, respond: resolve, fail: (message) => reject(new Error(message)) }
        const waiter = waiters.shift()
        if (waiter) waiter(request)
        else queued.push(request)
      })
  )
  transport.start()
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  if (!options.skipReady) {
    await transport.request('ready', { pid: process.pid, token: options.token ?? server.authenticationToken })
  }
  return {
    socket,
    transport,
    nextRequest: () =>
      new Promise<HostRequest>((resolve, reject) => {
        const request = queued.shift()
        if (request) return resolve(request)
        const timer = setTimeout(() => reject(new Error('no host request within 5s')), 5_000)
        waiters.push((pending) => {
          clearTimeout(timer)
          resolve(pending)
        })
      })
  }
}

async function makeHarness(
  userResponse: 'stream' | 'message' | 'unavailable' = 'stream',
  onToolCall?: (name: string, args: unknown, signal: AbortSignal) => Promise<{ text: string; data?: unknown }>,
  onGuardCheck?: DshBridgeServerOptions['onGuardCheck']
): Promise<Harness> {
  const { server, events, lifecycleEdges } = makeServer(userResponse, onToolCall, undefined, onGuardCheck)
  await server.listen()
  const plugin = await connectPlugin(server)
  await server.whenReady()
  const harness: Harness = { server, events, lifecycleEdges, ...plugin }
  harnesses.push(harness)
  return harness
}

afterEach(async () => {
  toolApprovalRegistry.abort(SESSION_ID, 'test-cleanup')
  for (const harness of harnesses.splice(0)) {
    harness.socket.destroy()
    await harness.server.close()
  }
})

describe('DshBridgeServer authentication gate', () => {
  it('destroys a socket whose ready token is wrong, without blocking the expected plugin', async () => {
    const { server } = makeServer('unavailable')
    await server.listen()
    try {
      const ready = server.whenReady(2_000)
      const bad = await connectPlugin(server, { skipReady: true })
      await expect(bad.transport.request('ready', { pid: process.pid, token: 'wrong-token' })).rejects.toThrow()
      await new Promise<void>((resolve) => bad.socket.once('close', () => resolve()))

      const good = await connectPlugin(server)
      await expect(ready).resolves.toBeUndefined()
      good.socket.destroy()
    } finally {
      await server.close()
    }
  })

  it('destroys a socket whose first request is not ready', async () => {
    const { server } = makeServer('unavailable')
    await server.listen()
    try {
      const plugin = await connectPlugin(server, { skipReady: true })
      await expect(plugin.transport.request('tool/call', { sessionId: SESSION_ID, callId: 'c1' })).rejects.toThrow()
      await new Promise<void>((resolve) => plugin.socket.once('close', () => resolve()))
      expect(plugin.socket.destroyed).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('destroys a socket that never authenticates, and spares one that did', async () => {
    const { server } = makeServer('unavailable', undefined, 150)
    await server.listen()
    try {
      const silent = await connectPlugin(server, { skipReady: true })
      await new Promise<void>((resolve) => silent.socket.once('close', () => resolve()))
      expect(silent.socket.destroyed).toBe(true)

      const plugin = await connectPlugin(server)
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(plugin.socket.destroyed).toBe(false)
      plugin.socket.destroy()
    } finally {
      await server.close()
    }
  })

  it('destroys a second connection while one is authenticated', async () => {
    const harness = await makeHarness()
    const second = net.connect(harness.server.socketPath)
    second.on('error', () => undefined)
    await new Promise<void>((resolve) => second.once('close', () => resolve()))
    expect(second.destroyed).toBe(true)
    expect(harness.socket.destroyed).toBe(false)
  })
})

describe('DshBridgeServer', () => {
  it('round-trips a context usage query and surfaces error responses', async () => {
    const harness = await makeHarness()
    const query = harness.server.requestContextUsage(SESSION_ID, { timeoutMs: 2_000 })
    const request = await harness.nextRequest()
    expect(request.method).toBe('context/usage')
    expect(request.params).toEqual({ sessionId: SESSION_ID })
    request.respond({ totalTokens: 1234, systemTokens: 100, toolsTokens: 200, messageTokens: 934 })
    await expect(query).resolves.toEqual({ totalTokens: 1234, systemTokens: 100, toolsTokens: 200, messageTokens: 934 })

    const failing = harness.server.requestContextUsage(SESSION_ID, { timeoutMs: 2_000 })
    ;(await harness.nextRequest()).fail('no live agent')
    await expect(failing).rejects.toThrow('no live agent')
  })

  it('times out a context usage query the plugin never answers', async () => {
    const harness = await makeHarness()
    const query = harness.server.requestContextUsage(SESSION_ID, { timeoutMs: 100 })
    await harness.nextRequest()
    await expect(query).rejects.toThrow('timed out after 100ms')
  })

  it('round-trips a slash command dispatch, including the admission miss', async () => {
    const harness = await makeHarness()
    const handled = harness.server.requestCommand(SESSION_ID, '/compact')
    const request = await harness.nextRequest()
    expect(request.method).toBe('command/execute')
    expect(request.params).toEqual({ sessionId: SESSION_ID, line: '/compact' })
    request.respond({ handled: true, kind: 'success', text: 'Compacted 12 history items (~42000 tokens).' })
    await expect(handled).resolves.toEqual({
      handled: true,
      kind: 'success',
      text: 'Compacted 12 history items (~42000 tokens).'
    })

    // Admission miss: a SUCCESS the host answers by prompting the line as prose.
    const miss = harness.server.requestCommand(SESSION_ID, '/unknown')
    ;(await harness.nextRequest()).respond({ handled: false })
    await expect(miss).resolves.toEqual({ handled: false })

    const failing = harness.server.requestCommand(SESSION_ID, '/compact')
    ;(await harness.nextRequest()).fail('no live agent')
    await expect(failing).rejects.toThrow('no live agent')
  })

  it('sends session/open with the declared parameters and resolves on the plugin result', async () => {
    const harness = await makeHarness()
    const opened = harness.server.request('session/open', {
      sessionId: SESSION_ID,
      provider: 'deepseek',
      model: 'deepseek-chat',
      cwd: '/tmp/ws',
      resume: false,
      policy: {
        permissionMode: 'default',
        disabledTools: [],
        allowedRoots: ['/tmp/ws'],
        readTools: ['read'],
        editTools: ['edit', 'write'],
        autoApprovedTools: [],
        approvalRequiredTools: [],
        nonBypassableApprovalTools: [],
        planSafeTools: []
      },
      tools: []
    })
    const request = await harness.nextRequest()
    expect(request.method).toBe('session/open')
    expect(request.params).toMatchObject({ sessionId: SESSION_ID, resume: false, cwd: '/tmp/ws' })
    request.respond({})
    await expect(opened).resolves.toEqual({})
  })

  it('rejects a request the plugin answers with an error', async () => {
    const harness = await makeHarness()
    const prompt = harness.server.request('session/prompt', { sessionId: SESSION_ID, contentBlocks: [] })
    ;(await harness.nextRequest()).fail('no live agent')
    await expect(prompt).rejects.toThrow('no live agent')
  })

  it('dispatches tool/call to the host bridge and returns success or failure', async () => {
    const onToolCall = vi.fn(async (name: string, args: unknown) => ({ text: `${name}:ok`, data: args }))
    const harness = await makeHarness('stream', onToolCall)

    await expect(
      harness.transport.request('tool/call', {
        sessionId: SESSION_ID,
        callId: 'tool-1',
        name: 'mcp__cherry-tools__web_search',
        args: { query: 'Cherry Studio' }
      })
    ).resolves.toEqual({ text: 'mcp__cherry-tools__web_search:ok', data: { query: 'Cherry Studio' } })
    expect(onToolCall).toHaveBeenCalledWith(
      'mcp__cherry-tools__web_search',
      { query: 'Cherry Studio' },
      expect.any(AbortSignal)
    )

    onToolCall.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(
      harness.transport.request('tool/call', {
        sessionId: SESSION_ID,
        callId: 'tool-2',
        name: 'mcp__cherry-tools__web_search',
        args: {}
      })
    ).rejects.toThrow('provider unavailable')
  })

  it('authenticates and validates guard/check before dispatching to the Main policy', async () => {
    const onGuardCheck = vi.fn<DshBridgeServerOptions['onGuardCheck']>(async () => ({
      kind: 'deny',
      ruleId: 'user-data-sqlite-write',
      reason: 'protected'
    }))
    const harness = await makeHarness('stream', undefined, onGuardCheck)

    await expect(
      harness.transport.request('guard/check', {
        sessionId: SESSION_ID,
        toolName: 'write',
        args: { file_path: '/tmp/user-data/app.sqlite' },
        cwd: os.tmpdir()
      })
    ).resolves.toEqual({ kind: 'deny', ruleId: 'user-data-sqlite-write', reason: 'protected' })
    expect(onGuardCheck).toHaveBeenCalledWith('write', { file_path: '/tmp/user-data/app.sqlite' }, os.tmpdir())

    await expect(
      harness.transport.request('guard/check', {
        sessionId: 'other-session',
        toolName: 'write',
        args: {},
        cwd: os.tmpdir()
      })
    ).rejects.toThrow('wrong session')
    await expect(
      harness.transport.request('guard/check', {
        sessionId: SESSION_ID,
        toolName: 'write',
        args: {},
        cwd: 'relative-workspace'
      })
    ).rejects.toThrow('not absolute')
  })

  it('rejects a tool call addressed to another session', async () => {
    const harness = await makeHarness('stream', async () => ({ text: 'unused' }))
    await expect(
      harness.transport.request('tool/call', {
        sessionId: 'someone-else',
        callId: 'tool-1',
        name: 'whatever',
        args: {}
      })
    ).rejects.toThrow('wrong session')
  })

  it('aborts active host tools on a tool/cancel notification, plugin disconnect, and server close', async () => {
    const signals: AbortSignal[] = []
    const onToolCall = vi.fn(
      (_name: string, _args: unknown, signal: AbortSignal) =>
        new Promise<{ text: string }>((_resolve, reject) => {
          signals.push(signal)
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
    )
    const cancelled = await makeHarness('stream', onToolCall)
    const call = { sessionId: SESSION_ID, callId: 'cancel-me', name: 'slow', args: {} }
    void cancelled.transport.request('tool/call', call).catch(() => undefined)
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    cancelled.transport.notify('tool/cancel', { sessionId: SESSION_ID, callId: 'cancel-me' })
    await vi.waitFor(() => expect(signals[0].aborted).toBe(true))

    void cancelled.transport.request('tool/call', { ...call, callId: 'disconnect-me' }).catch(() => undefined)
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    cancelled.socket.destroy()
    await vi.waitFor(() => expect(signals[1].aborted).toBe(true))

    const closed = await makeHarness('stream', onToolCall)
    void closed.transport.request('tool/call', { ...call, callId: 'close-me' }).catch(() => undefined)
    await vi.waitFor(() => expect(signals).toHaveLength(3))
    await closed.server.close()
    expect(signals[2].aborted).toBe(true)
  })

  it('round-trips approval/ask through the registry to allowed-once', async () => {
    const harness = await makeHarness()
    const ask = harness.transport.request('approval/ask', {
      sessionId: SESSION_ID,
      toolName: 'bash',
      callId: 'call-9',
      args: { command: 'echo hi' }
    })

    await vi.waitFor(() => expect(harness.events).toHaveLength(1))
    const event = harness.events[0]
    expect(event.type).toBe('tool-approval-request')
    if (event.type !== 'tool-approval-request') throw new Error('unreachable')
    expect(event.request).toMatchObject({
      toolCallId: 'call-9',
      toolName: 'bash',
      input: { command: 'echo hi' },
      presentation: 'stream'
    })

    toolApprovalRegistry.dispatch(event.request.approvalId, { approved: true })
    await expect(ask).resolves.toEqual({ outcome: 'allowed-once' })
  })

  it('rejects an approval whose decision edited the tool input (unsupported by dsh)', async () => {
    const harness = await makeHarness()
    const ask = harness.transport.request('approval/ask', { sessionId: SESSION_ID, toolName: 'bash' })
    await vi.waitFor(() => expect(harness.events).toHaveLength(1))
    const event = harness.events[0]
    if (event.type !== 'tool-approval-request') throw new Error('unreachable')

    toolApprovalRegistry.dispatch(event.request.approvalId, {
      approved: true,
      updatedInput: { command: 'echo edited' }
    })
    await expect(ask).resolves.toEqual({ outcome: 'rejected' })
  })

  it('returns a trimmed rejection reason for the plugin to deliver to the agent', async () => {
    const harness = await makeHarness()
    const ask = harness.transport.request('approval/ask', {
      sessionId: SESSION_ID,
      toolName: 'bash',
      callId: 'call-with-feedback'
    })
    await vi.waitFor(() => expect(harness.events).toHaveLength(1))
    const event = harness.events[0]
    if (event.type !== 'tool-approval-request') throw new Error('unreachable')

    toolApprovalRegistry.dispatch(event.request.approvalId, {
      approved: false,
      reason: '  use a copy instead  '
    })

    await expect(ask).resolves.toEqual({
      outcome: 'rejected',
      rejectionReason: 'use a copy instead'
    })
  })

  it('does not attach feedback to approvals, blank denials, or edited-input fallbacks', async () => {
    const harness = await makeHarness()

    for (const decision of [
      { approved: true, reason: 'ignored' },
      { approved: false, reason: '   ' },
      { approved: true, reason: 'rewritten', updatedInput: { command: 'echo edited' } }
    ]) {
      const ask = harness.transport.request('approval/ask', { sessionId: SESSION_ID, toolName: 'bash' })
      await vi.waitFor(() => expect(harness.events).toHaveLength(1))
      const event = harness.events.shift()
      if (event?.type !== 'tool-approval-request') throw new Error('unreachable')
      toolApprovalRegistry.dispatch(event.request.approvalId, decision)
      await expect(ask).resolves.toEqual({
        outcome: decision.approved && !decision.updatedInput ? 'allowed-once' : 'rejected'
      })
    }
  })

  it('answers rejected immediately when no responder is available, without surfacing a card', async () => {
    const harness = await makeHarness('unavailable')
    await expect(
      harness.transport.request('approval/ask', { sessionId: SESSION_ID, toolName: 'bash' })
    ).resolves.toEqual({ outcome: 'rejected' })
    expect(harness.events).toHaveLength(0)
  })

  it('answers a plan review with the byte-strict approve shape (label only, no custom)', async () => {
    const harness = await makeHarness()
    const ask = harness.transport.request('question/ask', {
      sessionId: SESSION_ID,
      callId: 'exit-plan-call-1',
      questions: [
        {
          id: 'plan-review',
          header: 'Plan review',
          question: 'Approve this plan and leave plan mode?',
          detail: '# Ship it\n\n1. do the thing',
          options: [{ label: 'Approve' }, { label: 'Keep planning' }],
          intent: { kind: 'plan-review', approve: 'Approve' }
        }
      ]
    })

    await vi.waitFor(() => expect(harness.events).toHaveLength(1))
    const event = harness.events[0]
    if (event.type !== 'tool-approval-request') throw new Error('unreachable')
    // Anchored to the streamed exit_plan_mode call so the card lands on its tool row.
    expect(event.request).toMatchObject({
      toolCallId: 'exit-plan-call-1',
      toolName: 'exit_plan_mode',
      input: { plan: '# Ship it\n\n1. do the thing' }
    })

    toolApprovalRegistry.dispatch(event.request.approvalId, { approved: true })
    // dsh treats ANY custom text (even empty) as keep-planning, so approve must omit it.
    await expect(ask).resolves.toEqual({ answers: [{ id: 'plan-review', selected: ['Approve'] }] })
  })

  it('anchors a rejected plan review retry to its new call id and carries the rejection feedback', async () => {
    const harness = await makeHarness()
    const ask = harness.transport.request('question/ask', {
      sessionId: SESSION_ID,
      callId: 'exit-plan-call-1',
      questions: [
        {
          id: 'plan-review',
          question: 'Approve this plan and leave plan mode?',
          detail: '# Nope',
          options: [{ label: 'Approve' }, { label: 'Keep planning' }],
          intent: { kind: 'plan-review', approve: 'Approve' }
        }
      ]
    })
    await vi.waitFor(() => expect(harness.events).toHaveLength(1))
    const event = harness.events[0]
    if (event.type !== 'tool-approval-request') throw new Error('unreachable')

    toolApprovalRegistry.dispatch(event.request.approvalId, { approved: false, reason: 'missing tests' })
    await expect(ask).resolves.toEqual({
      answers: [{ id: 'plan-review', selected: [], custom: 'missing tests' }]
    })

    const retry = harness.transport.request('question/ask', {
      sessionId: SESSION_ID,
      callId: 'exit-plan-call-2',
      questions: [
        {
          id: 'plan-review',
          question: 'Approve this revised plan and leave plan mode?',
          detail: '# Revised',
          options: [{ label: 'Approve' }, { label: 'Keep planning' }],
          intent: { kind: 'plan-review', approve: 'Approve' }
        }
      ]
    })
    await vi.waitFor(() => expect(harness.events).toHaveLength(2))
    const retryEvent = harness.events[1]
    if (retryEvent.type !== 'tool-approval-request') throw new Error('unreachable')
    expect(retryEvent.request).toMatchObject({
      toolCallId: 'exit-plan-call-2',
      input: { plan: '# Revised' }
    })

    toolApprovalRegistry.dispatch(retryEvent.request.approvalId, { approved: true })
    await expect(retry).resolves.toEqual({ answers: [{ id: 'plan-review', selected: ['Approve'] }] })
  })

  it('rejects non-plan-review questions and asks without a responder', async () => {
    const harness = await makeHarness()
    await expect(
      harness.transport.request('question/ask', {
        sessionId: SESSION_ID,
        callId: 'question-call-1',
        questions: [{ id: 'q1', question: 'Pick one', options: [{ label: 'A' }] }]
      })
    ).rejects.toThrow('plan-review')

    await expect(
      harness.transport.request('question/ask', {
        sessionId: SESSION_ID,
        callId: '',
        questions: [
          {
            id: 'plan-review',
            question: 'Approve?',
            detail: '# P',
            options: [{ label: 'Approve' }],
            intent: { kind: 'plan-review', approve: 'Approve' }
          }
        ]
      })
    ).rejects.toThrow('tool call id')

    const unattended = await makeHarness('unavailable')
    await expect(
      unattended.transport.request('question/ask', {
        sessionId: SESSION_ID,
        callId: 'exit-plan-call-1',
        questions: [
          {
            id: 'plan-review',
            question: 'Approve?',
            detail: '# P',
            options: [{ label: 'Approve' }],
            intent: { kind: 'plan-review', approve: 'Approve' }
          }
        ]
      })
    ).rejects.toThrow('no user is available')
    expect(unattended.events).toHaveLength(0)
  })

  it('relays subagent lifecycle notifications to the host callback', async () => {
    const harness = await makeHarness()
    harness.transport.notify('subagent/lifecycle', {
      phase: 'start',
      runId: 'run-1',
      childSessionId: 'child-1',
      parentSessionId: SESSION_ID,
      provider: 'spawn'
    })
    harness.transport.notify('subagent/lifecycle', {
      phase: 'end',
      runId: 'run-1',
      childSessionId: 'child-1',
      parentSessionId: SESSION_ID,
      provider: 'spawn',
      stopReason: 'completed'
    })
    await vi.waitFor(() => expect(harness.lifecycleEdges).toHaveLength(2))
    expect(harness.lifecycleEdges[0]).toMatchObject({ phase: 'start', childSessionId: 'child-1' })
    expect(harness.lifecycleEdges[1]).toMatchObject({ phase: 'end', stopReason: 'completed' })
  })

  it('rejects pending requests when the plugin disconnects', async () => {
    const harness = await makeHarness()
    const pending = harness.server.request('session/cancel', { sessionId: SESSION_ID })
    await harness.nextRequest()
    harness.socket.destroy()
    await expect(pending).rejects.toThrow()
    // Once the host observes the close, later requests fail closed instead of queueing.
    await vi.waitFor(async () => {
      await expect(harness.server.request('session/cancel', { sessionId: SESSION_ID })).rejects.toThrow('not connected')
    })
  })
})
