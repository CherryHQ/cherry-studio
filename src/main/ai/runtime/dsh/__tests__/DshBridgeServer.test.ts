import net from 'node:net'

import { createBridgeFrameDecoder, encodeBridgeMessage } from '@cherrystudio/dsh-bridge'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { toolApprovalRegistry } from '../../toolApproval/ToolApprovalRegistry'
import type { AgentRuntimeEvent } from '../../types'
import { DshBridgeServer } from '../DshBridgeServer'

const SESSION_ID = 'dsh-bridge-test-session'

interface Harness {
  server: DshBridgeServer
  socket: net.Socket
  /** Frames the fake plugin received from the host, in order. */
  received: Record<string, unknown>[]
  events: AgentRuntimeEvent[]
  nextFrame: () => Promise<Record<string, unknown>>
}

const harnesses: Harness[] = []

async function makeHarness(
  userResponse: 'stream' | 'message' | 'unavailable' = 'stream',
  onToolCall: (
    name: string,
    args: unknown,
    signal: AbortSignal
  ) => Promise<{ text: string; data?: unknown }> = async () => {
    throw new Error('unexpected tool call')
  }
): Promise<Harness> {
  const events: AgentRuntimeEvent[] = []
  const server = new DshBridgeServer({
    sessionId: SESSION_ID,
    emit: (event) => events.push(event),
    getInteractionState: () => ({ userResponse }),
    onToolCall
  })
  await server.listen()

  const received: Record<string, unknown>[] = []
  const waiters: Array<(frame: Record<string, unknown>) => void> = []
  const socket = net.connect(server.socketPath)
  socket.on(
    'data',
    createBridgeFrameDecoder((message) => {
      const frame = message as Record<string, unknown>
      const waiter = waiters.shift()
      if (waiter) waiter(frame)
      else received.push(frame)
    })
  )
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  socket.write(encodeBridgeMessage({ type: 'ready', pid: process.pid, token: server.authenticationToken }))
  await server.whenReady()

  const harness: Harness = {
    server,
    socket,
    received,
    events,
    nextFrame: () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const queued = received.shift()
        if (queued) return resolve(queued)
        const timer = setTimeout(() => reject(new Error('no frame within 5s')), 5_000)
        waiters.push((frame) => {
          clearTimeout(timer)
          resolve(frame)
        })
      })
  }
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

describe('DshBridgeServer', () => {
  it('rejects an unauthenticated first client without blocking the expected plugin', async () => {
    const server = new DshBridgeServer({
      sessionId: SESSION_ID,
      emit: () => undefined,
      getInteractionState: () => ({ userResponse: 'unavailable' }),
      onToolCall: async () => ({ text: 'unused' })
    })
    await server.listen()
    const bad = net.connect(server.socketPath)
    const good = net.connect(server.socketPath)
    try {
      await Promise.all(
        [bad, good].map(
          (socket) =>
            new Promise<void>((resolve, reject) => {
              socket.once('connect', resolve)
              socket.once('error', reject)
            })
        )
      )
      const ready = server.whenReady(2_000)
      bad.write(encodeBridgeMessage({ type: 'ready', pid: process.pid, token: 'wrong-token' }))
      await new Promise<void>((resolve) => bad.once('close', () => resolve()))

      good.write(encodeBridgeMessage({ type: 'ready', pid: process.pid, token: server.authenticationToken }))
      await expect(ready).resolves.toBeUndefined()
    } finally {
      bad.destroy()
      good.destroy()
      await server.close()
    }
  })

  it('round-trips a context usage query and surfaces error frames', async () => {
    const harness = await makeHarness()
    const query = harness.server.requestContextUsage(SESSION_ID, { timeoutMs: 2_000 })
    const frame = await harness.nextFrame()
    expect(frame).toMatchObject({ type: 'contextUsage', sessionId: SESSION_ID })
    harness.socket.write(
      encodeBridgeMessage({
        type: 'contextUsageResult',
        id: frame.id,
        ok: true,
        usage: { totalTokens: 1234, systemTokens: 100, toolsTokens: 200, messageTokens: 934 }
      })
    )
    await expect(query).resolves.toEqual({ totalTokens: 1234, systemTokens: 100, toolsTokens: 200, messageTokens: 934 })

    const failing = harness.server.requestContextUsage(SESSION_ID, { timeoutMs: 2_000 })
    const errorFrame = await harness.nextFrame()
    harness.socket.write(
      encodeBridgeMessage({ type: 'contextUsageResult', id: errorFrame.id, ok: false, error: 'no live agent' })
    )
    await expect(failing).rejects.toThrow('no live agent')
  })

  it('round-trips a slash command dispatch and surfaces error frames', async () => {
    const harness = await makeHarness()
    const handled = harness.server.requestCommand(SESSION_ID, '/compact')
    const frame = await harness.nextFrame()
    expect(frame).toMatchObject({ type: 'command', sessionId: SESSION_ID, line: '/compact' })
    harness.socket.write(
      encodeBridgeMessage({
        type: 'commandResult',
        id: frame.id,
        ok: true,
        handled: true,
        kind: 'success',
        text: 'Compacted 12 history items (~42000 tokens).'
      })
    )
    await expect(handled).resolves.toEqual({
      handled: true,
      kind: 'success',
      text: 'Compacted 12 history items (~42000 tokens).'
    })

    // Admission miss: the host falls back to prompting the line as prose.
    const miss = harness.server.requestCommand(SESSION_ID, '/unknown')
    const missFrame = await harness.nextFrame()
    harness.socket.write(encodeBridgeMessage({ type: 'commandResult', id: missFrame.id, ok: true, handled: false }))
    await expect(miss).resolves.toEqual({ handled: false })

    const failing = harness.server.requestCommand(SESSION_ID, '/compact')
    const errorFrame = await harness.nextFrame()
    harness.socket.write(
      encodeBridgeMessage({ type: 'commandResult', id: errorFrame.id, ok: false, error: 'no live agent' })
    )
    await expect(failing).rejects.toThrow('no live agent')
  })

  it('resolves whenReady on the ready frame and correlates request/result', async () => {
    const harness = await makeHarness()
    await harness.server.whenReady()

    const openResult = harness.server.request({
      type: 'open',
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
        approvalRequiredTools: []
      },
      tools: []
    })
    const openFrame = await harness.nextFrame()
    expect(openFrame).toMatchObject({ type: 'open', sessionId: SESSION_ID, resume: false })
    expect(typeof openFrame.id).toBe('string')

    harness.socket.write(encodeBridgeMessage({ type: 'result', id: openFrame.id, ok: true }))
    await expect(openResult).resolves.toBeUndefined()
  })

  it('rejects a request whose result reports a failure', async () => {
    const harness = await makeHarness()
    await harness.server.whenReady()

    const prompt = harness.server.request({ type: 'prompt', sessionId: SESSION_ID, contentBlocks: [] })
    const frame = await harness.nextFrame()
    harness.socket.write(encodeBridgeMessage({ type: 'result', id: frame.id, ok: false, error: 'no live agent' }))
    await expect(prompt).rejects.toThrow('no live agent')
  })

  it('dispatches toolCall frames to the host bridge and returns success or failure', async () => {
    const onToolCall = vi.fn(async (name: string, args: unknown) => ({
      text: `${name}:ok`,
      data: args
    }))
    const harness = await makeHarness('stream', onToolCall)

    harness.socket.write(
      encodeBridgeMessage({
        type: 'toolCall',
        id: 'tool-1',
        sessionId: SESSION_ID,
        name: 'mcp__cherry-tools__web_search',
        args: { query: 'Cherry Studio' }
      })
    )
    await expect(harness.nextFrame()).resolves.toEqual({
      type: 'toolCallResult',
      id: 'tool-1',
      ok: true,
      text: 'mcp__cherry-tools__web_search:ok',
      data: { query: 'Cherry Studio' }
    })
    expect(onToolCall).toHaveBeenCalledWith(
      'mcp__cherry-tools__web_search',
      { query: 'Cherry Studio' },
      expect.any(AbortSignal)
    )

    onToolCall.mockRejectedValueOnce(new Error('provider unavailable'))
    harness.socket.write(
      encodeBridgeMessage({
        type: 'toolCall',
        id: 'tool-2',
        sessionId: SESSION_ID,
        name: 'mcp__cherry-tools__web_search',
        args: {}
      })
    )
    await expect(harness.nextFrame()).resolves.toEqual({
      type: 'toolCallResult',
      id: 'tool-2',
      ok: false,
      error: 'provider unavailable'
    })
  })

  it('aborts active host tools on a cancel frame, plugin disconnect, and server close', async () => {
    const signals: AbortSignal[] = []
    const onToolCall = vi.fn(
      async (_name: string, _args: unknown, signal?: AbortSignal) =>
        await new Promise<{ text: string }>((_resolve, reject) => {
          if (!signal) return reject(new Error('missing abort signal'))
          signals.push(signal)
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
    )
    const cancelled = await makeHarness('stream', onToolCall)
    cancelled.socket.write(
      encodeBridgeMessage({ type: 'toolCall', id: 'cancel-me', sessionId: SESSION_ID, name: 'slow', args: {} })
    )
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    cancelled.socket.write(encodeBridgeMessage({ type: 'toolCallCancel', id: 'cancel-me', sessionId: SESSION_ID }))
    await vi.waitFor(() => expect(signals[0].aborted).toBe(true))

    cancelled.socket.write(
      encodeBridgeMessage({ type: 'toolCall', id: 'disconnect-me', sessionId: SESSION_ID, name: 'slow', args: {} })
    )
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    cancelled.socket.destroy()
    await vi.waitFor(() => expect(signals[1].aborted).toBe(true))

    const closed = await makeHarness('stream', onToolCall)
    closed.socket.write(
      encodeBridgeMessage({ type: 'toolCall', id: 'close-me', sessionId: SESSION_ID, name: 'slow', args: {} })
    )
    await vi.waitFor(() => expect(signals).toHaveLength(3))
    await closed.server.close()
    expect(signals[2].aborted).toBe(true)
  })

  it('round-trips approvalAsk through the registry to allowed-once', async () => {
    const harness = await makeHarness()
    harness.socket.write(
      encodeBridgeMessage({
        type: 'approvalAsk',
        id: 'ask-1',
        sessionId: SESSION_ID,
        toolName: 'bash',
        callId: 'call-9',
        args: { command: 'echo hi' }
      })
    )

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
    const answer = await harness.nextFrame()
    expect(answer).toEqual({ type: 'approvalAnswer', id: 'ask-1', outcome: 'allowed-once' })
  })

  it('rejects an approval whose decision edited the tool input (unsupported by dsh)', async () => {
    const harness = await makeHarness()
    harness.socket.write(
      encodeBridgeMessage({ type: 'approvalAsk', id: 'ask-2', sessionId: SESSION_ID, toolName: 'bash' })
    )
    await vi.waitFor(() => expect(harness.events).toHaveLength(1))
    const event = harness.events[0]
    if (event.type !== 'tool-approval-request') throw new Error('unreachable')

    toolApprovalRegistry.dispatch(event.request.approvalId, {
      approved: true,
      updatedInput: { command: 'echo edited' }
    })
    const answer = await harness.nextFrame()
    expect(answer).toEqual({ type: 'approvalAnswer', id: 'ask-2', outcome: 'rejected' })
  })

  it('answers rejected immediately when no responder is available, without surfacing a card', async () => {
    const harness = await makeHarness('unavailable')
    harness.socket.write(
      encodeBridgeMessage({ type: 'approvalAsk', id: 'ask-3', sessionId: SESSION_ID, toolName: 'bash' })
    )

    const answer = await harness.nextFrame()
    expect(answer).toEqual({ type: 'approvalAnswer', id: 'ask-3', outcome: 'rejected' })
    expect(harness.events).toHaveLength(0)
  })

  it('rejects pending requests when the plugin disconnects', async () => {
    const harness = await makeHarness()
    await harness.server.whenReady()

    const pending = harness.server.request({ type: 'cancel', sessionId: SESSION_ID })
    await harness.nextFrame()
    harness.socket.destroy()
    await expect(pending).rejects.toThrow('disconnected')
  })
})
