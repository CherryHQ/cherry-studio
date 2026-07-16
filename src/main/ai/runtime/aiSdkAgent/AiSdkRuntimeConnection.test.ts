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
vi.mock('../aiSdk', () => ({ Agent: FakeAgent }))

const { AiSdkRuntimeConnection } = await import('./AiSdkRuntimeConnection')
const { toModelMessages } = await import('@main/ai/messages/messageRules')

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
  mocks.agentParams.length = 0
  mocks.streamCalls.length = 0
  mocks.streamScript = undefined
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
