import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessions'
import type { UIMessage, UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeConnectInput, AgentRuntimeEvent, AgentRuntimeUserInput } from '../types'

type StreamScript = (controller: ReadableStreamDefaultController<UIMessageChunk>, agent: FakeAgent) => void

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  getAgent: vi.fn(),
  listRuntimeHistory: vi.fn(),
  resolveAndAssert: vi.fn(),
  resolveOnly: vi.fn(),
  buildParams: vi.fn(),
  buildToolSet: vi.fn(),
  isHeadless: vi.fn(),
  agentParams: [] as unknown[],
  streamCalls: [] as Array<{ messages: UIMessage[]; signal: AbortSignal; agent: FakeAgent }>,
  streamScript: undefined as StreamScript | undefined
}))

class FakeAgent {
  readonly hooks: Record<string, Array<(arg: unknown) => void>> = {}

  constructor(readonly params: Record<string, unknown>) {
    mocks.agentParams.push(params)
  }

  on(key: string, fn: (arg: unknown) => void): () => void {
    ;(this.hooks[key] ??= []).push(fn)
    return () => {}
  }

  fire(key: string, arg: unknown): void {
    for (const fn of this.hooks[key] ?? []) fn(arg)
  }

  stream(messages: UIMessage[], signal: AbortSignal): ReadableStream<UIMessageChunk> {
    mocks.streamCalls.push({ messages, signal, agent: this })
    const script = mocks.streamScript ?? defaultScript
    return new ReadableStream<UIMessageChunk>({
      start: (controller) => script(controller, this)
    })
  }
}

const defaultScript: StreamScript = (controller) => {
  controller.enqueue({ type: 'start', messageId: 'inner-random' } as UIMessageChunk)
  controller.enqueue({ type: 'text-start', id: 't1' })
  controller.enqueue({ type: 'text-delta', id: 't1', delta: 'hello' })
  controller.enqueue({ type: 'text-end', id: 't1' })
  controller.enqueue({ type: 'finish' } as UIMessageChunk)
  controller.close()
}

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('@data/services/AgentSessionService', () => ({ agentSessionService: { getById: mocks.getById } }))
vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: mocks.getAgent } }))
vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { listRuntimeHistory: mocks.listRuntimeHistory }
}))
vi.mock('./validateModel', () => ({
  resolveAndAssertAiSdkAgentModel: mocks.resolveAndAssert,
  resolveAiSdkAgentModel: mocks.resolveOnly
}))
vi.mock('./buildAiSdkAgentParams', () => ({ buildAiSdkAgentParams: mocks.buildParams }))
vi.mock('./tools/buildAgentToolSet', () => ({ buildAgentToolSet: mocks.buildToolSet }))
vi.mock('../aiSdk', () => ({ Agent: FakeAgent }))
vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'AgentSessionRuntimeService') return { isCurrentTurnHeadless: mocks.isHeadless }
      throw new Error(`unexpected service ${name}`)
    }
  }
}))

const { AiSdkRuntimeConnection } = await import('./AiSdkRuntimeConnection')
const { toModelMessages } = await import('@main/ai/messages/messageRules')
const { toolApprovalRegistry } = await import('../toolApproval/ToolApprovalRegistry')

const SESSION_ID = 'sess-1'
const AGENT_ID = 'agent-1'
const MODEL_ID = 'openai::gpt-4o' as const

const input: AgentRuntimeConnectInput = { sessionId: SESSION_ID, agentId: AGENT_ID, modelId: MODEL_ID }

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    type: 'ai-sdk',
    name: 'A',
    model: MODEL_ID,
    modelName: 'gpt-4o',
    instructions: 'Be terse.',
    mcps: [],
    disabledTools: [],
    configuration: { permission_mode: 'default' },
    createdAt: 't0',
    updatedAt: 't0',
    orderKey: 'a0',
    ...overrides
  }
}

function makeRow(overrides: Partial<AgentSessionMessageEntity>): AgentSessionMessageEntity {
  return {
    id: 'row',
    sessionId: SESSION_ID,
    role: 'user',
    data: { parts: [{ type: 'text', text: 'hi' }] },
    status: 'success',
    searchableText: '',
    modelId: null,
    messageSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    ...overrides
  } as AgentSessionMessageEntity
}

function userInput(id: string, text: string, systemReminder = false): AgentRuntimeUserInput {
  return { message: makeRow({ id, data: { parts: [{ type: 'text', text }] } }), systemReminder }
}

/** Drain runtime events until (and including) the first terminal, with a hard cap. */
async function collectUntilTerminal(connection: InstanceType<typeof AiSdkRuntimeConnection>) {
  const events: AgentRuntimeEvent[] = []
  for await (const event of connection.events) {
    events.push(event)
    if (event.type === 'turn-complete' || event.type === 'error') break
  }
  return events
}

beforeEach(() => {
  vi.clearAllMocks()
  toolApprovalRegistry.clear('test-reset')
  mocks.agentParams.length = 0
  mocks.streamCalls.length = 0
  mocks.streamScript = undefined
  mocks.isHeadless.mockReturnValue(false)
  mocks.getById.mockReturnValue({ id: SESSION_ID, agentId: AGENT_ID, workspace: { path: '/work' } })
  mocks.getAgent.mockReturnValue(makeAgent())
  mocks.listRuntimeHistory.mockReturnValue([])
  const resolved = {
    provider: { id: 'openai' },
    model: { id: MODEL_ID, providerId: 'openai', apiModelId: 'gpt-4o', contextWindow: 2000 }
  }
  mocks.resolveAndAssert.mockReturnValue(resolved)
  mocks.resolveOnly.mockReturnValue(resolved)
  mocks.buildParams.mockResolvedValue({
    sdkConfig: { providerId: 'openai-compatible', providerSettings: { apiKey: 'k' }, modelId: 'gpt-4o' },
    system: 'sys',
    options: { maxRetries: 0 },
    maxTurns: 100
  })
  mocks.buildToolSet.mockResolvedValue({ tools: {}, skills: [] })
})

async function startConnection() {
  return new AiSdkRuntimeConnection(input).start()
}

describe('AiSdkRuntimeConnection — start', () => {
  it('fails fast when the session has no workspace', async () => {
    mocks.getById.mockReturnValue({ id: SESSION_ID, agentId: AGENT_ID, workspace: null })
    await expect(startConnection()).rejects.toThrow(/no agent or workspace/)
  })

  it('fails fast when the model validation rejects', async () => {
    mocks.resolveAndAssert.mockImplementation(() => {
      throw new Error('unsupported')
    })
    await expect(startConnection()).rejects.toThrow('unsupported')
  })
})

describe('AiSdkRuntimeConnection — turn execution', () => {
  it('streams text chunks (inner start dropped) and settles with exactly one turn-complete', async () => {
    const connection = await startConnection()
    connection.send(userInput('u1', 'hello'))

    const events = await collectUntilTerminal(connection)

    const chunkTypes = events.filter((e) => e.type === 'chunk').map((e) => (e as { chunk: UIMessageChunk }).chunk.type)
    expect(chunkTypes).toEqual(['text-start', 'text-delta', 'text-end', 'finish'])
    expect(events.filter((e) => e.type === 'turn-complete' || e.type === 'error')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('turn-complete')
    await connection.close()
  })

  it('forwards a multi-step tool loop in order with the transport stamp', async () => {
    mocks.streamScript = (controller) => {
      controller.enqueue({ type: 'start' } as UIMessageChunk)
      controller.enqueue({ type: 'tool-input-start', toolCallId: 'c1', toolName: 'read' } as UIMessageChunk)
      controller.enqueue({
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'read',
        input: {}
      } as UIMessageChunk)
      controller.enqueue({ type: 'tool-output-available', toolCallId: 'c1', output: 'one' } as UIMessageChunk)
      controller.enqueue({ type: 'tool-input-start', toolCallId: 'c2', toolName: 'grep' } as UIMessageChunk)
      controller.enqueue({
        type: 'tool-input-available',
        toolCallId: 'c2',
        toolName: 'grep',
        input: {}
      } as UIMessageChunk)
      controller.enqueue({ type: 'tool-output-available', toolCallId: 'c2', output: 'two' } as UIMessageChunk)
      controller.enqueue({ type: 'text-start', id: 't1' })
      controller.enqueue({ type: 'text-delta', id: 't1', delta: 'done' })
      controller.enqueue({ type: 'text-end', id: 't1' })
      controller.close()
    }
    const connection = await startConnection()
    connection.send(userInput('u1', 'go'))

    const events = await collectUntilTerminal(connection)
    const chunks = events.filter((e) => e.type === 'chunk').map((e) => (e as { chunk: UIMessageChunk }).chunk)

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'tool-input-start',
      'tool-input-available',
      'tool-output-available',
      'tool-input-start',
      'tool-input-available',
      'tool-output-available',
      'text-start',
      'text-delta',
      'text-end'
    ])
    for (const chunk of chunks.filter((c) => c.type.startsWith('tool-'))) {
      const meta = (chunk as { providerMetadata?: { cherry?: { transport?: string } } }).providerMetadata
      expect(meta?.cherry?.transport).toBe('ai-sdk-agent')
    }
    expect(events.filter((e) => e.type === 'turn-complete')).toHaveLength(1)
    await connection.close()
  })

  it('surfaces a provider error as exactly one error event and no turn-complete', async () => {
    mocks.streamScript = (controller) => {
      controller.enqueue({ type: 'text-start', id: 't1' })
      controller.error(new Error('provider exploded'))
    }
    const connection = await startConnection()
    connection.send(userInput('u1', 'boom'))

    const events = await collectUntilTerminal(connection)

    const terminals = events.filter((e) => e.type === 'turn-complete' || e.type === 'error')
    expect(terminals).toEqual([{ type: 'error', error: expect.objectContaining({ message: 'provider exploded' }) }])
    await connection.close()
  })

  it('fails the turn when the incoming user row is not durable (no synthetic fallback)', async () => {
    mocks.listRuntimeHistory.mockImplementation(() => {
      throw new Error('Message not found')
    })
    const connection = await startConnection()
    connection.send(userInput('ghost', 'hi'))

    const events = await collectUntilTerminal(connection)

    expect(events.at(-1)).toEqual({ type: 'error', error: expect.objectContaining({ message: 'Message not found' }) })
    expect(mocks.streamCalls).toHaveLength(0)
    await connection.close()
  })

  it('close() aborts the in-flight execution and closes the event queue with no late terminal', async () => {
    let held: ReadableStreamDefaultController<UIMessageChunk> | undefined
    mocks.streamScript = (controller) => {
      controller.enqueue({ type: 'text-start', id: 't1' })
      held = controller
    }
    const connection = await startConnection()
    connection.send(userInput('u1', 'hang'))

    await vi.waitFor(() => expect(mocks.streamCalls).toHaveLength(1))
    const { signal } = mocks.streamCalls[0]
    expect(signal.aborted).toBe(false)

    await connection.close()
    expect(signal.aborted).toBe(true)
    held?.close()

    const events: AgentRuntimeEvent[] = []
    for await (const event of connection.events) events.push(event)
    expect(events.filter((e) => e.type === 'turn-complete' || e.type === 'error')).toHaveLength(0)
  })
})

describe('AiSdkRuntimeConnection — durable replay', () => {
  it('a fresh connection replays prior user/assistant/tool history into the next model request, no resume token', async () => {
    const toolPart = {
      type: 'dynamic-tool',
      toolName: 'read',
      toolCallId: 'c1',
      state: 'output-available',
      input: { path: 'a.txt' },
      output: 'contents'
    }
    mocks.listRuntimeHistory.mockReturnValue([
      makeRow({ id: 'u1', role: 'user', data: { parts: [{ type: 'text', text: 'first ask' }] } }),
      makeRow({
        id: 'a1',
        role: 'assistant',
        data: {
          parts: [toolPart, { type: 'text', text: 'earlier answer' }]
        } as AgentSessionMessageEntity['data']
      })
    ])

    const connection = await startConnection()
    connection.send(userInput('u2', 'follow up'))
    const events = await collectUntilTerminal(connection)

    expect(mocks.listRuntimeHistory).toHaveBeenCalledWith(SESSION_ID, { beforeMessageId: 'u2' })
    expect(events.some((e) => e.type === 'resume-token')).toBe(false)

    const { messages } = mocks.streamCalls[0]
    expect(messages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2'])

    // Prove the replay survives the actual model conversion (tool call + result included).
    const modelMessages = await toModelMessages(messages)
    const flattened = JSON.stringify(modelMessages)
    expect(flattened).toContain('first ask')
    expect(flattened).toContain('earlier answer')
    expect(flattened).toContain('tool-call')
    expect(flattened).toContain('tool-result')
    expect(flattened.match(/follow up/g)).toHaveLength(1)
    await connection.close()
  })

  it('two queued follow-ups: current prompt not duplicated, next prompt not leaked, steer reminder applied', async () => {
    // The bounded query returns only rows strictly before u2 — u2 itself and the
    // later-queued u3 are excluded by the data layer (proven against the real DB
    // in AgentSessionMessageService.test.ts); here we prove the connection passes
    // the right boundary and appends the incoming row exactly once.
    mocks.listRuntimeHistory.mockReturnValue([
      makeRow({ id: 'u1', role: 'user', data: { parts: [{ type: 'text', text: 'original task' }] } }),
      makeRow({ id: 'a1', role: 'assistant', data: { parts: [{ type: 'text', text: 'working on it' }] } })
    ])

    const connection = await startConnection()
    // No native steer: the optional contract member is not implemented at all,
    // so the host always queues follow-ups as the next turn.
    expect('redirect' in connection).toBe(false)

    connection.send(userInput('u2', 'queued follow-up', true))
    const events = await collectUntilTerminal(connection)

    expect(mocks.listRuntimeHistory).toHaveBeenCalledWith(SESSION_ID, { beforeMessageId: 'u2' })
    const { messages } = mocks.streamCalls[0]
    expect(messages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2'])
    expect(messages.filter((message) => message.id === 'u2')).toHaveLength(1)
    expect(messages.some((message) => message.id === 'u3')).toBe(false)

    const lastText = (messages.at(-1)?.parts[0] as { text: string }).text
    expect(lastText).toContain('<system-reminder>')
    expect(lastText).toContain('queued follow-up')
    expect(events.at(-1)?.type).toBe('turn-complete')
    await connection.close()
  })
})

describe('AiSdkRuntimeConnection — reconcile', () => {
  it('hot-patches live policy (permission mode / disabled tools) and reports patched', async () => {
    const connection = await startConnection()

    mocks.getAgent.mockReturnValue(makeAgent({ configuration: { permission_mode: 'acceptEdits' } }))
    expect(await connection.reconcile({ modelId: MODEL_ID })).toBe('patched')

    mocks.getAgent.mockReturnValue(
      makeAgent({ configuration: { permission_mode: 'acceptEdits' }, disabledTools: ['bash'] })
    )
    expect(await connection.reconcile({ modelId: MODEL_ID })).toBe('patched')

    // Unchanged snapshot → current.
    expect(await connection.reconcile({ modelId: MODEL_ID })).toBe('current')
    await connection.close()
  })

  it('reports rebuild when a spawn-frozen input changes (instructions, model)', async () => {
    const connection = await startConnection()

    mocks.getAgent.mockReturnValue(makeAgent({ instructions: 'Be verbose.' }))
    expect(await connection.reconcile({ modelId: MODEL_ID })).toBe('rebuild')

    mocks.getAgent.mockReturnValue(makeAgent())
    expect(await connection.reconcile({ modelId: 'anthropic::claude' })).toBe('rebuild')
    await connection.close()
  })

  it('reports invalid when agent, session, or model/provider rows can no longer be derived', async () => {
    const connection = await startConnection()

    mocks.getAgent.mockReturnValue(undefined)
    expect(await connection.reconcile({ modelId: MODEL_ID })).toBe('invalid')

    mocks.getAgent.mockReturnValue(makeAgent({ model: null }))
    expect(await connection.reconcile({ modelId: MODEL_ID })).toBe('invalid')

    mocks.getAgent.mockReturnValue(makeAgent())
    mocks.getById.mockReturnValue(undefined)
    expect(await connection.reconcile({ modelId: MODEL_ID })).toBe('invalid')

    mocks.getById.mockReturnValue({ id: SESSION_ID, agentId: AGENT_ID, workspace: { path: '/work' } })
    mocks.resolveOnly.mockImplementation(() => {
      throw new Error('Model not found')
    })
    expect(await connection.reconcile({ modelId: MODEL_ID })).toBe('invalid')
    await connection.close()
  })

  it('applies a policy tighten even when the same reconcile reports rebuild (security-first)', async () => {
    const connection = await startConnection()

    mocks.getAgent.mockReturnValue(
      makeAgent({ instructions: 'Changed.', configuration: { permission_mode: 'default' }, disabledTools: ['bash'] })
    )
    expect(await connection.reconcile({ modelId: MODEL_ID })).toBe('rebuild')

    // The live policy snapshot took the tighten: reconciling back to the same
    // facts (minus the frozen change) reports current, not patched.
    mocks.getAgent.mockReturnValue(
      makeAgent({ configuration: { permission_mode: 'default' }, disabledTools: ['bash'] })
    )
    expect(await connection.reconcile({ modelId: MODEL_ID })).toBe('current')
    await connection.close()
  })
})

/** Segment-1 script: one approval-gated `write` call, then the SDK-terminated frame. */
function approvalSegmentOne(controller: ReadableStreamDefaultController<UIMessageChunk>) {
  controller.enqueue({ type: 'start', messageId: 'seg-1' } as UIMessageChunk)
  controller.enqueue({ type: 'tool-input-start', toolCallId: 'c1', toolName: 'write' } as UIMessageChunk)
  controller.enqueue({
    type: 'tool-input-available',
    toolCallId: 'c1',
    toolName: 'write',
    input: { path: 'a.txt' }
  } as UIMessageChunk)
  controller.enqueue({ type: 'tool-approval-request', approvalId: 'appr-1', toolCallId: 'c1' } as UIMessageChunk)
  controller.enqueue({ type: 'finish' } as UIMessageChunk)
  controller.close()
}

function findToolPart(message: UIMessage, toolCallId: string) {
  return message.parts.find((part) => (part as { toolCallId?: string }).toolCallId === toolCallId) as
    | { state: string; input: unknown; approval?: { id: string; approved: boolean; reason?: string } }
    | undefined
}

describe('AiSdkRuntimeConnection — approval continuation', () => {
  it('approve: continuation restarts in the same turn, one outer frame, stamped card, stable ids', async () => {
    mocks.streamScript = (controller) => {
      if (mocks.streamCalls.length === 1) return approvalSegmentOne(controller)
      controller.enqueue({ type: 'start', messageId: 'seg-2' } as UIMessageChunk)
      controller.enqueue({ type: 'tool-output-available', toolCallId: 'c1', output: 'wrote' } as UIMessageChunk)
      controller.enqueue({ type: 'text-start', id: 't1' })
      controller.enqueue({ type: 'text-delta', id: 't1', delta: 'done' })
      controller.enqueue({ type: 'text-end', id: 't1' })
      controller.enqueue({ type: 'finish' } as UIMessageChunk)
      controller.close()
    }
    const connection = await startConnection()
    connection.send(userInput('u1', 'write it'))
    const eventsPromise = collectUntilTerminal(connection)

    await vi.waitFor(() => expect(toolApprovalRegistry.size()).toBe(1))
    expect(toolApprovalRegistry.dispatch('appr-1', { approved: true })).toBe(true)
    const events = await eventsPromise

    // One continuation segment, no third execution.
    expect(mocks.streamCalls).toHaveLength(2)

    // One outer frame: no inner start forwarded, exactly one finish (the final segment's).
    const chunks = events.filter((e) => e.type === 'chunk').map((e) => (e as { chunk: UIMessageChunk }).chunk)
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'tool-input-start',
      'tool-input-available',
      'tool-approval-request',
      'tool-output-available',
      'text-start',
      'text-delta',
      'text-end',
      'finish'
    ])

    // The card chunk is stamped for the renderer's generic approval card.
    const card = chunks.find((chunk) => chunk.type === 'tool-approval-request') as unknown as {
      approvalId: string
      toolCallId: string
      providerMetadata?: { cherry?: { transport?: string; toolName?: string } }
    }
    expect(card.approvalId).toBe('appr-1')
    expect(card.providerMetadata?.cherry).toEqual({ transport: 'ai-sdk-agent', toolName: 'write' })

    // Continuation history: same tool/approval ids, approval-responded state.
    const continuation = mocks.streamCalls[1].messages
    const assistant = continuation.at(-1)!
    const part = findToolPart(assistant, 'c1')
    expect(part?.state).toBe('approval-responded')
    expect(part?.approval).toEqual({ id: 'appr-1', approved: true, reason: undefined })

    // The real model conversion emits the approval response pair the SDK's
    // collectToolApprovals consumes — approved tools execute exactly once, on
    // the continuation side, never on ours.
    const flattened = JSON.stringify(await toModelMessages(continuation))
    expect(flattened).toContain('tool-approval-request')
    expect(flattened).toContain('tool-approval-response')
    expect(flattened).toContain('appr-1')

    expect(events.filter((e) => e.type === 'turn-complete')).toHaveLength(1)
    // Stale/duplicate decision: the settled id is gone from the registry.
    expect(toolApprovalRegistry.dispatch('appr-1', { approved: false })).toBe(false)
    await connection.close()
  })

  it('deny: the decision reaches the continuation as approved:false and the tool output is a denial', async () => {
    mocks.streamScript = (controller) => {
      if (mocks.streamCalls.length === 1) return approvalSegmentOne(controller)
      controller.enqueue({ type: 'start', messageId: 'seg-2' } as UIMessageChunk)
      controller.enqueue({ type: 'tool-output-denied', toolCallId: 'c1' } as UIMessageChunk)
      controller.enqueue({ type: 'finish' } as UIMessageChunk)
      controller.close()
    }
    const connection = await startConnection()
    connection.send(userInput('u1', 'write it'))
    const eventsPromise = collectUntilTerminal(connection)

    await vi.waitFor(() => expect(toolApprovalRegistry.size()).toBe(1))
    toolApprovalRegistry.dispatch('appr-1', { approved: false, reason: 'not on my watch' })
    const events = await eventsPromise

    expect(mocks.streamCalls).toHaveLength(2)
    const part = findToolPart(mocks.streamCalls[1].messages.at(-1)!, 'c1')
    expect(part?.approval).toEqual({ id: 'appr-1', approved: false, reason: 'not on my watch' })

    const chunkTypes = events.filter((e) => e.type === 'chunk').map((e) => (e as { chunk: UIMessageChunk }).chunk.type)
    expect(chunkTypes).toContain('tool-output-denied')
    expect(chunkTypes.filter((type) => type === 'finish')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'turn-complete')).toHaveLength(1)
    await connection.close()
  })

  it('updated input becomes the executed input in the continuation history', async () => {
    mocks.streamScript = (controller) => {
      if (mocks.streamCalls.length === 1) return approvalSegmentOne(controller)
      controller.enqueue({ type: 'tool-output-available', toolCallId: 'c1', output: 'wrote' } as UIMessageChunk)
      controller.enqueue({ type: 'finish' } as UIMessageChunk)
      controller.close()
    }
    const connection = await startConnection()
    connection.send(userInput('u1', 'write it'))
    const eventsPromise = collectUntilTerminal(connection)

    await vi.waitFor(() => expect(toolApprovalRegistry.size()).toBe(1))
    toolApprovalRegistry.dispatch('appr-1', { approved: true, updatedInput: { path: 'safer.txt' } })
    await eventsPromise

    const part = findToolPart(mocks.streamCalls[1].messages.at(-1)!, 'c1')
    expect(part?.input).toEqual({ path: 'safer.txt' })
    const flattened = JSON.stringify(await toModelMessages(mocks.streamCalls[1].messages))
    expect(flattened).toContain('safer.txt')
    expect(flattened).not.toContain('a.txt')
    await connection.close()
  })

  it('multiple approvals in one step settle as a group before the continuation starts', async () => {
    mocks.streamScript = (controller) => {
      if (mocks.streamCalls.length === 1) {
        controller.enqueue({ type: 'start', messageId: 'seg-1' } as UIMessageChunk)
        controller.enqueue({ type: 'tool-input-start', toolCallId: 'c1', toolName: 'write' } as UIMessageChunk)
        controller.enqueue({
          type: 'tool-input-available',
          toolCallId: 'c1',
          toolName: 'write',
          input: { path: 'a' }
        } as UIMessageChunk)
        controller.enqueue({ type: 'tool-input-start', toolCallId: 'c2', toolName: 'bash' } as UIMessageChunk)
        controller.enqueue({
          type: 'tool-input-available',
          toolCallId: 'c2',
          toolName: 'bash',
          input: { command: 'ls' }
        } as UIMessageChunk)
        controller.enqueue({ type: 'tool-approval-request', approvalId: 'appr-1', toolCallId: 'c1' } as UIMessageChunk)
        controller.enqueue({ type: 'tool-approval-request', approvalId: 'appr-2', toolCallId: 'c2' } as UIMessageChunk)
        controller.enqueue({ type: 'finish' } as UIMessageChunk)
        controller.close()
        return
      }
      controller.enqueue({ type: 'finish' } as UIMessageChunk)
      controller.close()
    }
    const connection = await startConnection()
    connection.send(userInput('u1', 'both'))
    const eventsPromise = collectUntilTerminal(connection)

    await vi.waitFor(() => expect(toolApprovalRegistry.size()).toBe(2))
    toolApprovalRegistry.dispatch('appr-1', { approved: true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mocks.streamCalls).toHaveLength(1) // half-settled group must not continue

    toolApprovalRegistry.dispatch('appr-2', { approved: false, reason: 'no shell' })
    const events = await eventsPromise

    expect(mocks.streamCalls).toHaveLength(2)
    const assistant = mocks.streamCalls[1].messages.at(-1)!
    expect(findToolPart(assistant, 'c1')?.approval?.approved).toBe(true)
    expect(findToolPart(assistant, 'c2')?.approval?.approved).toBe(false)
    expect(events.filter((e) => e.type === 'turn-complete')).toHaveLength(1)
    await connection.close()
  })

  it('a second approval round merges onto the same assistant message (three segments, one frame)', async () => {
    mocks.streamScript = (controller) => {
      if (mocks.streamCalls.length === 1) return approvalSegmentOne(controller)
      if (mocks.streamCalls.length === 2) {
        // Continuation executes c1, then gates a NEW tool — its input chunks
        // live in this segment while c1's live in the previous one.
        controller.enqueue({ type: 'start', messageId: 'seg-2' } as UIMessageChunk)
        controller.enqueue({ type: 'tool-output-available', toolCallId: 'c1', output: 'wrote' } as UIMessageChunk)
        controller.enqueue({ type: 'tool-input-start', toolCallId: 'c2', toolName: 'bash' } as UIMessageChunk)
        controller.enqueue({
          type: 'tool-input-available',
          toolCallId: 'c2',
          toolName: 'bash',
          input: { command: 'ls' }
        } as UIMessageChunk)
        controller.enqueue({ type: 'tool-approval-request', approvalId: 'appr-2', toolCallId: 'c2' } as UIMessageChunk)
        controller.enqueue({ type: 'finish' } as UIMessageChunk)
        controller.close()
        return
      }
      controller.enqueue({ type: 'tool-output-available', toolCallId: 'c2', output: 'listed' } as UIMessageChunk)
      controller.enqueue({ type: 'finish' } as UIMessageChunk)
      controller.close()
    }
    const connection = await startConnection()
    connection.send(userInput('u1', 'chain'))
    const eventsPromise = collectUntilTerminal(connection)

    await vi.waitFor(() => expect(toolApprovalRegistry.size()).toBe(1))
    toolApprovalRegistry.dispatch('appr-1', { approved: true })
    await vi.waitFor(() => expect(mocks.streamCalls).toHaveLength(2))
    await vi.waitFor(() => expect(toolApprovalRegistry.size()).toBe(1))
    toolApprovalRegistry.dispatch('appr-2', { approved: true })
    const events = await eventsPromise

    expect(mocks.streamCalls).toHaveLength(3)
    // Every continuation carries exactly ONE trailing assistant message that
    // accumulates all prior segments' parts.
    const secondHistory = mocks.streamCalls[1].messages
    const thirdHistory = mocks.streamCalls[2].messages
    expect(secondHistory.filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(thirdHistory.filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(thirdHistory).toHaveLength(secondHistory.length)
    const merged = thirdHistory.at(-1)!
    expect(findToolPart(merged, 'c1')?.state).toBe('output-available')
    expect(findToolPart(merged, 'c2')?.state).toBe('approval-responded')

    const chunkTypes = events.filter((e) => e.type === 'chunk').map((e) => (e as { chunk: UIMessageChunk }).chunk.type)
    expect(chunkTypes.filter((type) => type === 'finish')).toHaveLength(1)
    expect(chunkTypes.filter((type) => type === 'start')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'turn-complete')).toHaveLength(1)
    await connection.close()
  })

  it('headless turn: denies synchronously, emits no card, never touches the registry', async () => {
    mocks.isHeadless.mockReturnValue(true)
    const register = vi.spyOn(toolApprovalRegistry, 'register')
    mocks.streamScript = (controller) => {
      if (mocks.streamCalls.length === 1) return approvalSegmentOne(controller)
      controller.enqueue({ type: 'tool-output-denied', toolCallId: 'c1' } as UIMessageChunk)
      controller.enqueue({ type: 'finish' } as UIMessageChunk)
      controller.close()
    }
    const connection = await startConnection()
    connection.send(userInput('u1', 'scheduled'))
    const events = await collectUntilTerminal(connection)

    expect(register).not.toHaveBeenCalled()
    expect(toolApprovalRegistry.size()).toBe(0)
    const chunkTypes = events.filter((e) => e.type === 'chunk').map((e) => (e as { chunk: UIMessageChunk }).chunk.type)
    expect(chunkTypes).not.toContain('tool-approval-request')

    const part = findToolPart(mocks.streamCalls[1].messages.at(-1)!, 'c1')
    expect(part?.approval?.approved).toBe(false)
    expect(part?.approval?.reason).toContain('Headless')
    expect(events.filter((e) => e.type === 'turn-complete')).toHaveLength(1)
    await connection.close()
    register.mockRestore()
  })

  it('close() while awaiting a decision resolves the pending approval and ends without a terminal', async () => {
    mocks.streamScript = (controller) => approvalSegmentOne(controller)
    const connection = await startConnection()
    connection.send(userInput('u1', 'write it'))

    await vi.waitFor(() => expect(toolApprovalRegistry.size()).toBe(1))
    await connection.close()

    expect(toolApprovalRegistry.size()).toBe(0)
    const events: AgentRuntimeEvent[] = []
    for await (const event of connection.events) events.push(event)
    expect(events.filter((e) => e.type === 'turn-complete' || e.type === 'error')).toHaveLength(0)
    expect(mocks.streamCalls).toHaveLength(1) // no continuation after close
  })

  it('rewrites continuation message-metadata to stay turn-cumulative', async () => {
    mocks.streamScript = (controller) => {
      if (mocks.streamCalls.length === 1) {
        controller.enqueue({ type: 'start', messageId: 'seg-1' } as UIMessageChunk)
        controller.enqueue({
          type: 'message-metadata',
          messageMetadata: { totalTokens: 100, promptTokens: 80, completionTokens: 20 }
        } as UIMessageChunk)
        controller.enqueue({ type: 'tool-input-start', toolCallId: 'c1', toolName: 'write' } as UIMessageChunk)
        controller.enqueue({
          type: 'tool-input-available',
          toolCallId: 'c1',
          toolName: 'write',
          input: {}
        } as UIMessageChunk)
        controller.enqueue({ type: 'tool-approval-request', approvalId: 'appr-1', toolCallId: 'c1' } as UIMessageChunk)
        controller.enqueue({ type: 'finish' } as UIMessageChunk)
        controller.close()
        return
      }
      controller.enqueue({
        type: 'message-metadata',
        messageMetadata: { totalTokens: 50, promptTokens: 40, completionTokens: 10 }
      } as UIMessageChunk)
      controller.enqueue({ type: 'finish' } as UIMessageChunk)
      controller.close()
    }
    const connection = await startConnection()
    connection.send(userInput('u1', 'measure'))
    const eventsPromise = collectUntilTerminal(connection)

    await vi.waitFor(() => expect(toolApprovalRegistry.size()).toBe(1))
    toolApprovalRegistry.dispatch('appr-1', { approved: true })
    const events = await eventsPromise

    const metadata = events
      .filter((e) => e.type === 'chunk')
      .map((e) => (e as { chunk: UIMessageChunk }).chunk)
      .filter((chunk) => chunk.type === 'message-metadata')
      .map((chunk) => (chunk as { messageMetadata: Record<string, number> }).messageMetadata)
    expect(metadata).toEqual([
      { totalTokens: 100, promptTokens: 80, completionTokens: 20 },
      { totalTokens: 150, promptTokens: 120, completionTokens: 30 }
    ])
    await connection.close()
  })
})

describe('AiSdkRuntimeConnection — context usage', () => {
  it('returns null before any measured step, then the latest step measurement', async () => {
    const connection = await startConnection()
    expect(await connection.getContextUsage()).toBeNull()

    mocks.streamScript = (controller, agent) => {
      agent.fire('onStepFinish', { usage: { inputTokens: 800, outputTokens: 200, totalTokens: 1000 } })
      controller.enqueue({ type: 'text-start', id: 't1' })
      controller.enqueue({ type: 'text-end', id: 't1' })
      controller.close()
    }
    connection.send(userInput('u1', 'measure'))
    const events = await collectUntilTerminal(connection)

    const usageEvents = events.filter((e) => e.type === 'context-usage')
    expect(usageEvents).toHaveLength(1)
    expect(await connection.getContextUsage()).toEqual({
      categories: [],
      totalTokens: 1000,
      maxTokens: 2000,
      percentage: 50,
      model: 'gpt-4o'
    })
    await connection.close()
  })
})

describe('AiSdkRuntimeConnection — tool-set wiring', () => {
  it('threads the built tool set into every segment executor and skills into param assembly', async () => {
    const tools = { read: { description: 'r' } }
    const skills = [{ name: 'code-review', description: 'review', folderName: 'code-review' }]
    mocks.buildToolSet.mockResolvedValue({ tools, skills })

    const connection = await startConnection()
    connection.send(userInput('u1', 'hello'))
    await collectUntilTerminal(connection)

    expect((mocks.agentParams[0] as { tools: unknown }).tools).toBe(tools)
    expect(mocks.buildParams).toHaveBeenCalledWith(expect.objectContaining({ skills }))
    expect(mocks.buildToolSet).toHaveBeenCalledWith(
      expect.objectContaining({ workspacePath: '/work', agent: expect.objectContaining({ id: AGENT_ID }) })
    )
    await connection.close()
  })

  it('hands the tool builder live policy accessors that follow reconcile hot-patches', async () => {
    mocks.getAgent.mockReturnValue(makeAgent({ disabledTools: ['bash'] }))
    const connection = await startConnection()
    connection.send(userInput('u1', 'hello'))
    await collectUntilTerminal(connection)

    const { policy } = mocks.buildToolSet.mock.calls[0][0] as {
      policy: { getPermissionMode: () => string; isDisabled: (name: string) => boolean }
    }
    expect(policy.getPermissionMode()).toBe('default')
    expect(policy.isDisabled('bash')).toBe(true)
    expect(policy.isDisabled('read')).toBe(false)

    // Reconcile swaps the live policy; the SAME accessors reflect it (fire-time reads).
    mocks.getAgent.mockReturnValue(
      makeAgent({ disabledTools: ['read'], configuration: { permission_mode: 'acceptEdits' } })
    )
    await expect(connection.reconcile({ modelId: MODEL_ID })).resolves.toBe('patched')
    expect(policy.getPermissionMode()).toBe('acceptEdits')
    expect(policy.isDisabled('bash')).toBe(false)
    expect(policy.isDisabled('read')).toBe(true)
    await connection.close()
  })
})
