import { normalizeContext } from '@earendil-works/pi-ai'
import {
  type ExtensionAPI,
  type ToolCallEvent,
  type ExtensionContext,
  SessionManager
} from '@earendil-works/pi-coding-agent'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { expect, it, vi } from 'vitest'

import type { Key, ToolDefinition } from '@cherrystudio/agent-behavior'
import { runtimeId } from '@cherrystudio/agent-runtime'

import { compactionSummarizer, conversationExtension, meterRequests } from '../src/behavior/extension'
import { PI_RUN_LIMIT_MESSAGE } from '../src/behavior/runBudget'
import { endingOf, noteMessage } from '../src/behavior/runs'
import { newConversation, type Adapter, type RunState } from '../src/behavior/state'
import { openPiHarness } from './behaviorHarness'
import { assistantReply, respondingModel, MODEL } from './sessionSupport'

const read = (pi: Awaited<ReturnType<typeof openPiHarness>>, thread: Parameters<typeof pi.harness.withCall>[0]) =>
  pi.harness.withCall(thread, (ports) => ports.ledger.read(thread))
const call = { name: 'echo', args: {} }
const tool = (run: ToolDefinition['run'] = vi.fn(async () => ({ text: 'echo', isError: false }))): ToolDefinition => ({
  name: 'echo',
  description: 'echo',
  schema: { type: 'object' },
  replay: 'safe',
  executionMode: 'sequential',
  availability: 'all',
  modelOnly: true,
  run
})

it('admits 20 calls, refuses call 21 before the policy gate, and resets next run', async () => {
  const execute = vi.fn(async () => ({ text: 'echo', isError: false }))
  const before = vi.fn(async () => ({}))
  const pi = await openPiHarness((ports) => {
    ports.tools.register(tool(execute))
    ports.toolGate.register({ before, after: async () => undefined })
  })
  const t = await pi.harness.createThread()
  pi.harness.script(t, [{ text: '', toolCalls: Array.from({ length: 21 }, () => call) }])
  await pi.harness.sendUser(t, 'go')
  await pi.harness.settle()
  expect(execute).toHaveBeenCalledTimes(20)
  expect(before).toHaveBeenCalledTimes(20)
  expect(await pi.harness.withCall(t, (ports) => ports.helpers.awaitAnswer(t, 1, 'user:1' as Key))).toMatchObject({
    outcome: 'limit_reached',
    error: PI_RUN_LIMIT_MESSAGE
  })
  pi.harness.script(t, [{ text: '', toolCalls: [call] }, { text: 'next' }])
  await pi.harness.sendUser(t, 'again')
  await pi.harness.settle()
  expect(execute).toHaveBeenCalledTimes(21)
  expect((await read(pi, t)).live.runEnd?.outcome).toBe('completed')
})

it('does not charge gate-denied calls to the admission budget', async () => {
  let seen = 0
  const execute = vi.fn(async () => ({ text: 'echo', isError: false }))
  const pi = await openPiHarness((ports) => {
    ports.tools.register(tool(execute))
    ports.toolGate.register({
      before: async () => (++seen <= 5 ? { block: 'denied' } : {}),
      after: async () => undefined
    })
  })
  const t = await pi.harness.createThread()
  pi.harness.script(t, [{ text: '', toolCalls: Array.from({ length: 25 }, () => call) }, { text: 'done' }])
  await pi.harness.sendUser(t, 'go')
  await pi.harness.settle()
  expect(execute).toHaveBeenCalledTimes(20)
  expect((await read(pi, t)).live.runEnd?.outcome).toBe('completed')
})

it('ends a denial-only loop before request 21 and carries the limit error', async () => {
  const pi = await openPiHarness((ports) => {
    ports.tools.register(tool())
    ports.toolGate.register({ before: async () => ({ block: 'denied' }), after: async () => undefined })
  })
  const t = await pi.harness.createThread()
  pi.harness.script(
    t,
    Array.from({ length: 21 }, () => ({ text: '', toolCalls: [call] }))
  )
  await pi.harness.sendUser(t, 'go')
  await pi.harness.settle()
  expect(pi.requests(t)).toHaveLength(20)
  expect(await pi.harness.withCall(t, (ports) => ports.helpers.awaitAnswer(t, 1, 'user:1' as Key))).toMatchObject({
    outcome: 'limit_reached',
    error: PI_RUN_LIMIT_MESSAGE
  })
})

const freshRun = (): RunState => ({
  run: 1,
  key: 'test',
  after: null,
  startedBy: undefined,
  pending: false,
  stopRequested: false,
  requests: 0,
  admissions: 20,
  window: [],
  done: Promise.resolve(),
  end: () => {}
})

it('returns terminate for post-limit calls but leaves nested and child calls uncounted', async () => {
  const conv = newConversation(runtimeId('test'), SessionManager.inMemory('/tmp'), { kind: 'root' }, undefined, false)
  conv.active = freshRun()
  let handler: (event: ToolCallEvent, context: ExtensionContext) => unknown
  const api = {
    registerTool: () => {},
    on: (name: string, fn: typeof handler) => {
      if (name === 'tool_call') handler = fn
    }
  } as unknown as ExtensionAPI
  const adapter = { installation: { tools: new Map() }, report: () => {} } as unknown as Adapter
  await conversationExtension(adapter, conv)(api)
  const event = { type: 'tool_call', toolName: 'echo', toolCallId: 'call', input: {} } as ToolCallEvent
  const context = { signal: new AbortController().signal } as ExtensionContext
  expect(await handler!(event, context)).toMatchObject({ block: true, terminate: true })
  expect(await handler!({ ...event, parentToolCallId: 'parent' }, context)).toBeUndefined()
  expect(conv.active.admissions).toBe(20)
  const child = newConversation(
    runtimeId('child'),
    SessionManager.inMemory('/tmp'),
    { kind: 'subagent', parent: runtimeId('test') } as typeof conv.lineage,
    undefined,
    false
  )
  child.active = freshRun()
  await conversationExtension(adapter, child)(api)
  expect(await handler!(event, context)).toBeUndefined()
  expect(child.active.admissions).toBe(20)
})

it('composes the root meter before installation policy without shrinking child policy', async () => {
  const conv = newConversation(runtimeId('test'), SessionManager.inMemory('/tmp'), { kind: 'root' }, undefined, false)
  conv.active = freshRun()
  conv.active.requests = 20
  const allow = vi.fn((_thread: unknown, count: number) =>
    count >= 200 ? { ok: false as const, text: 'child cap' } : { ok: true as const }
  )
  const adapter = { installation: { meter: { allow } } } as unknown as Adapter
  const provider = respondingModel(() => assistantReply('done'))
  const session = { agent: { streamFunction: provider.model } } as unknown as AgentSession
  meterRequests(adapter, conv, session)
  const result = await (await session.agent.streamFunction(MODEL, normalizeContext({ messages: [] }))).result()
  expect(result.errorMessage).toContain(PI_RUN_LIMIT_MESSAGE)
  expect(allow).not.toHaveBeenCalled()
  const child = newConversation(
    runtimeId('child'),
    SessionManager.inMemory('/tmp'),
    { kind: 'subagent', parent: runtimeId('test') } as typeof conv.lineage,
    undefined,
    false
  )
  child.active = freshRun()
  child.active.requests = 199
  const childSession = { agent: { streamFunction: provider.model } } as unknown as AgentSession
  meterRequests(adapter, child, childSession)
  await (await childSession.agent.streamFunction(MODEL, normalizeContext({ messages: [] }))).result()
  expect(allow).toHaveBeenLastCalledWith(child.thread, 199, 'child')
  expect(child.active.requests).toBe(200)
  const refused = await (await childSession.agent.streamFunction(MODEL, normalizeContext({ messages: [] }))).result()
  expect(refused.errorMessage).toContain('child cap')
})

it('keeps a compaction allowance refusal as the terminal run limit', async () => {
  const conv = newConversation(runtimeId('test'), SessionManager.inMemory('/tmp'), { kind: 'root' }, undefined, false)
  conv.active = freshRun()
  conv.active.requests = 20
  const adapter = { installation: {} } as unknown as Adapter
  await expect(compactionSummarizer(adapter, conv)({ reason: 'threshold' } as never)).rejects.toThrow(
    PI_RUN_LIMIT_MESSAGE
  )
  expect(endingOf(conv.active, false).answer).toMatchObject({ outcome: 'limit_reached', error: PI_RUN_LIMIT_MESSAGE })
})

it('resets a native follow-up before its automatic compaction is metered', async () => {
  let release!: () => void
  let entered!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const reached = new Promise<void>((resolve) => {
    entered = resolve
  })
  let calls = 0
  let summaries = 0
  const pi = await openPiHarness(
    (ports) => {
      ports.tools.register(
        tool(async () => {
          if (++calls === 1) {
            entered()
            await held
          }
          return { text: 'echo', isError: false }
        })
      )
      ports.lifecycle.register({
        onOpen: async () => {},
        onClose: async () => {},
        onCompacted: async () => {},
        onCompacting: async () => {
          summaries++
          return { summary: 'summary' }
        }
      })
    },
    [],
    (request, open) =>
      open(request, {
        compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 1, summarize: request.summarize }
      })
  )
  const t = await pi.harness.createThread()
  const usage = (tokens: number) => ({
    input: tokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: tokens,
    costUsd: 0
  })
  pi.harness.script(t, [
    ...Array.from({ length: 19 }, () => ({ text: '', toolCalls: [call], usage: usage(1) })),
    { text: 'first done', usage: usage(32000) },
    { text: '', toolCalls: [call], usage: usage(1) },
    { text: 'next done', usage: usage(1) }
  ])
  const first = pi.behavior.prompt(t, 'first')
  await reached
  try {
    await pi.behavior.prompt(t, 'follow', { streamingBehavior: 'followUp' })
  } finally {
    release()
  }
  await first
  await pi.harness.settle()
  expect(calls).toBe(20)
  expect(summaries).toBe(1)
  expect(pi.requests(t)).toHaveLength(22)
  expect((await read(pi, t)).live.runEnd?.outcome).toBe('completed')
})

it('keeps steering and child follow-on inputs on their existing budget', () => {
  for (const kind of ['root', 'subagent'] as const) {
    const conv = newConversation(
      runtimeId(kind),
      SessionManager.inMemory('/tmp'),
      kind === 'root' ? { kind: 'root' } : ({ kind: 'subagent', parent: runtimeId('parent') } as never),
      undefined,
      false
    )
    conv.active = freshRun()
    conv.active.requests = 12
    conv.active.lastReply =
      kind === 'root'
        ? assistantReply([{ type: 'toolCall', id: 'c', name: 'echo', arguments: {} }], 'toolUse')
        : assistantReply('child done')
    noteMessage(conv, { role: 'user', content: 'more', timestamp: Date.now() })
    expect(conv.active.requests).toBe(12)
    expect(conv.active.admissions).toBe(20)
  }
})
