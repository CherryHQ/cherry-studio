import { trace } from '@opentelemetry/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeConnectInput, AgentRuntimeTraceContext } from '../../types'

interface FakeSpan {
  name: string
  options: Record<string, any>
  setAttribute: ReturnType<typeof vi.fn>
  setAttributes: ReturnType<typeof vi.fn>
  setStatus: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

const spans: FakeSpan[] = []
const startSpan = vi.fn((name: string, options: Record<string, any>) => {
  const span: FakeSpan = {
    name,
    options,
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn()
  }
  spans.push(span)
  return span
})
vi.spyOn(trace, 'getTracer').mockReturnValue({ startSpan } as never)

/** Push-driven stand-in for the SDK's notification subscription. */
class FakeSubscription {
  private readonly pending: unknown[] = []
  private wake?: () => void
  private closed = false

  push(notification: unknown): void {
    this.pending.push(notification)
    this.wake?.()
  }

  close(): void {
    this.closed = true
    this.wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    while (!this.closed) {
      while (this.pending.length > 0) yield this.pending.shift()
      if (this.closed) return
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
  }
}

let subscription = new FakeSubscription()

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../dshConnectionSignature', () => ({
  DshInvalidConnectionSnapshotError: class extends Error {},
  captureDshConnectionSnapshot: vi.fn().mockResolvedValue({
    signature: 'sig-1',
    agent: { id: 'agent-1', configuration: {}, disabledTools: [] },
    session: { agentId: 'agent-1', workspace: { path: '/workspace' } },
    provider: {},
    model: {},
    enabledApiKeys: [],
    additionalSkillPaths: [],
    mcpServerSnapshots: [],
    linkedChannel: null
  })
}))
vi.mock('../modelInjection', () => ({
  resolveDshProviderInjectionFromSnapshot: vi.fn(() => ({
    providerName: 'deepseek',
    api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com',
    modelId: 'deepseek-chat',
    apiKey: 'key',
    modelConfig: { id: 'deepseek-chat', contextWindow: 128_000, maxTokens: 8192 },
    usageCapture: { owner: 'provider-calls' }
  }))
}))
vi.mock('../compositionBuilder', () => ({
  buildDshCompositionYaml: vi.fn(() => 'plugins: []'),
  resolveDshRuntimeBinPath: vi.fn(() => '/dsh/bin')
}))
vi.mock('../DshBridgeServer', () => ({
  DshBridgeServer: vi.fn(() => ({
    socketPath: '/tmp/dsh.sock',
    listen: vi.fn().mockResolvedValue(undefined),
    whenReady: vi.fn().mockResolvedValue(undefined),
    request: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  }))
}))
vi.mock('../DshCherryToolBridge', () => ({
  buildDshCherryToolBridge: vi.fn().mockResolvedValue({
    tools: [],
    callTool: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined)
  }),
  buildDshCherryToolName: (server: string, tool: string) => `mcp__${server}__${tool}`,
  warmDshMcpToolCatalogs: vi.fn().mockResolvedValue(undefined),
  DSH_AUTO_APPROVED_BRIDGED_TOOLS: new Set<string>(),
  DSH_APPROVAL_REQUIRED_BRIDGED_TOOLS: new Set<string>()
}))
vi.mock('../dshSdk', () => ({
  loadDshSdk: vi.fn().mockResolvedValue({
    HarnessClient: vi.fn(() => ({
      start: vi.fn(),
      initialize: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(() => (subscription = new FakeSubscription())),
      close: vi.fn().mockResolvedValue(undefined)
    }))
  })
}))
vi.mock('@main/ai/agents/agentDataDirectory', () => ({
  ensureAgentDataDirectory: vi.fn().mockResolvedValue('/agent-data')
}))
vi.mock('@main/ai/runtime/agentPrompt', () => ({
  buildAgentRuntimePrompt: vi.fn().mockResolvedValue({ base: { kind: 'native' }, append: '' })
}))
vi.mock('@main/ai/runtime/agentMcpServers', () => ({ buildAgentMcpServers: vi.fn(() => []) }))
vi.mock('@main/ai/runtime/citationsGuidance', () => ({ buildCitationsGuidance: vi.fn(() => '') }))
vi.mock('@main/ai/runtime/agentUserContent', () => ({ buildAgentUserContent: vi.fn(() => '') }))
vi.mock('@main/ai/steerReminder', () => ({ wrapSteerReminder: vi.fn((text: string) => text) }))

const { DshRuntimeConnection } = await import('../DshRuntimeConnection')

const traceContext: AgentRuntimeTraceContext = {
  topicId: 'topic-1',
  traceId: 'a'.repeat(32),
  rootSpanId: 'b'.repeat(16),
  sessionId: 'session-1',
  turnId: 'turn-1'
}

const connectInput = {
  sessionId: 'session-1',
  agentId: 'agent-1',
  modelId: 'deepseek::deepseek-chat',
  trace: traceContext
} as unknown as AgentRuntimeConnectInput

/** Yield until the notification pump has drained what was pushed. */
const drain = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  spans.length = 0
  startSpan.mockClear()
})

describe('DshRuntimeConnection tracing', () => {
  it('feeds runtime session events to the trace recorder', async () => {
    const connection = await new DshRuntimeConnection(connectInput).start()
    subscription.push({
      method: 'session.event',
      params: { sessionId: 'session-1', event: { type: 'step/start', seq: 1, time: 0, data: { turn: 1, step: 1 } } }
    })
    await drain()

    expect(spans.map((span) => span.name)).toEqual(['dsh.generate_content'])
    expect(spans[0].options.attributes).toMatchObject({ 'cs.agent_turn_id': 'turn-1' })
    await connection.close()
  })

  it('applies a refreshed trace context to later spans and closes stranded spans on teardown', async () => {
    const connection = await new DshRuntimeConnection(connectInput).start()
    connection.refreshTraceContext?.({ ...traceContext, turnId: 'turn-2' })
    subscription.push({
      method: 'session.event',
      params: { sessionId: 'session-1', event: { type: 'step/start', seq: 1, time: 0, data: { turn: 2, step: 1 } } }
    })
    await drain()
    expect(spans[0].options.attributes).toMatchObject({ 'cs.agent_turn_id': 'turn-2' })

    await connection.close()
    expect(spans[0].setStatus).toHaveBeenCalledWith(expect.objectContaining({ message: 'dsh connection closed' }))
    expect(spans[0].end).toHaveBeenCalledOnce()
  })
})
