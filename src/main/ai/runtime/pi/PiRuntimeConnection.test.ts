import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeConnectInput, AgentRuntimeEvent } from '../types'

const PI_ROOT = '/cherry/.pi/agent'
const PI_SESSIONS = '/cherry/.pi/sessions'
const WORKSPACE = '/work/space'
const SESSION_FILE = '/cherry/.pi/sessions/s.jsonl'

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  getAgent: vi.fn(),
  resolveInjection: vi.fn(),
  getPath: vi.fn(),
  loadPiSdk: vi.fn(),
  // pi fakes / captures
  subscribeCb: undefined as ((event: AgentSessionEvent) => void) | undefined,
  unsubscribe: vi.fn(),
  setRuntimeApiKey: vi.fn(),
  registerProvider: vi.fn(),
  sessionCreate: vi.fn(),
  sessionOpen: vi.fn(),
  reload: vi.fn(),
  createAgentSession: vi.fn(),
  prompt: vi.fn(),
  abort: vi.fn(),
  dispose: vi.fn(),
  getContextUsage: vi.fn(),
  createOpts: undefined as Record<string, unknown> | undefined,
  loaderOpts: undefined as Record<string, unknown> | undefined,
  settingsArgs: undefined as unknown[] | undefined,
  isStreaming: false,
  sessionFile: '/cherry/.pi/sessions/s.jsonl' as string | undefined
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('@main/core/application', () => ({ application: { getPath: mocks.getPath } }))
vi.mock('@data/services/AgentSessionService', () => ({ agentSessionService: { getById: mocks.getById } }))
vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: mocks.getAgent } }))
vi.mock('./modelInjection', () => ({ resolvePiProviderInjection: mocks.resolveInjection }))
vi.mock('./piSdk', () => ({ loadPiSdk: mocks.loadPiSdk }))
vi.mock('@main/utils/rtk', () => ({ rtkRewrite: vi.fn().mockResolvedValue(null) }))

const { PiRuntimeConnection } = await import('./PiRuntimeConnection')
const { toolApprovalRegistry } = await import('../toolApproval/ToolApprovalRegistry')

const fakeSession = {
  get isStreaming() {
    return mocks.isStreaming
  },
  get sessionFile() {
    return mocks.sessionFile
  },
  subscribe: (cb: (event: AgentSessionEvent) => void) => {
    mocks.subscribeCb = cb
    return mocks.unsubscribe
  },
  prompt: mocks.prompt,
  abort: mocks.abort,
  dispose: mocks.dispose,
  getContextUsage: mocks.getContextUsage
}

const fakePi = {
  AuthStorage: { inMemory: () => ({ setRuntimeApiKey: mocks.setRuntimeApiKey }) },
  ModelRegistry: {
    inMemory: () => ({ registerProvider: mocks.registerProvider, find: () => ({ id: 'm', provider: 'p' }) })
  },
  SettingsManager: {
    inMemory: (...args: unknown[]) => {
      mocks.settingsArgs = args
      return {}
    }
  },
  SessionManager: { create: mocks.sessionCreate, open: mocks.sessionOpen },
  DefaultResourceLoader: class {
    reload = mocks.reload
    constructor(opts: Record<string, unknown>) {
      mocks.loaderOpts = opts
    }
  },
  createAgentSession: mocks.createAgentSession
}

const input: AgentRuntimeConnectInput = {
  sessionId: 'sess-1',
  agentId: 'agent-1',
  modelId: 'p::m'
}

async function collectUntilTerminal(events: AsyncIterable<AgentRuntimeEvent>): Promise<AgentRuntimeEvent[]> {
  const out: AgentRuntimeEvent[] = []
  const iter = events[Symbol.asyncIterator]()
  for (;;) {
    const { value, done } = await iter.next()
    if (done) break
    out.push(value)
    if (value.type === 'turn-complete' || value.type === 'error') break
  }
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  toolApprovalRegistry.clear('test-reset')
  mocks.subscribeCb = undefined
  mocks.createOpts = undefined
  mocks.loaderOpts = undefined
  mocks.settingsArgs = undefined
  mocks.isStreaming = false
  mocks.sessionFile = SESSION_FILE
  delete process.env.PI_CODING_AGENT_DIR
  delete process.env.PI_CODING_AGENT_SESSION_DIR

  mocks.getById.mockResolvedValue({ id: 'sess-1', agentId: 'agent-1', workspace: { path: WORKSPACE } })
  mocks.getAgent.mockResolvedValue({ id: 'agent-1', model: 'p::m', instructions: 'Be helpful.' })
  mocks.resolveInjection.mockResolvedValue({
    providerName: 'p',
    providerConfig: { name: 'P', baseUrl: 'https://x', apiKey: 'placeholder', api: 'anthropic-messages', models: [] },
    apiKey: 'real-key',
    modelId: 'm'
  })
  mocks.getPath.mockImplementation((key: string) => (key === 'feature.agents.pi.root' ? PI_ROOT : PI_SESSIONS))
  mocks.loadPiSdk.mockResolvedValue(fakePi)
  mocks.reload.mockResolvedValue(undefined)
  mocks.sessionCreate.mockReturnValue({})
  mocks.sessionOpen.mockReturnValue({})
  mocks.prompt.mockResolvedValue(undefined)
  mocks.abort.mockResolvedValue(undefined)
  mocks.getContextUsage.mockReturnValue(undefined)
  mocks.createAgentSession.mockImplementation(async (opts: Record<string, unknown>) => {
    mocks.createOpts = opts
    return { session: fakeSession }
  })
})

describe('PiRuntimeConnection', () => {
  it('forces Cherry-owned pi dirs and creates a fresh session (no resume)', async () => {
    await new PiRuntimeConnection(input).start()

    expect(process.env.PI_CODING_AGENT_DIR).toBe(PI_ROOT)
    expect(process.env.PI_CODING_AGENT_SESSION_DIR).toBe(PI_SESSIONS)
    expect(mocks.createOpts?.agentDir).toBe(PI_ROOT)
    expect(mocks.setRuntimeApiKey).toHaveBeenCalledWith('p', 'real-key')
    expect(mocks.registerProvider).toHaveBeenCalledWith('p', expect.objectContaining({ apiKey: 'placeholder' }))
    expect(mocks.sessionCreate).toHaveBeenCalledWith(WORKSPACE, PI_SESSIONS)
    expect(mocks.sessionOpen).not.toHaveBeenCalled()
    // agent.instructions become the pi system prompt override; disk SYSTEM.md discovery is suppressed.
    expect(mocks.loaderOpts).toMatchObject({ systemPrompt: '', appendSystemPrompt: [] })
    expect(typeof (mocks.loaderOpts as { systemPromptOverride?: () => string }).systemPromptOverride).toBe('function')
    expect((mocks.loaderOpts as { systemPromptOverride: () => string }).systemPromptOverride()).toBe('Be helpful.')
  })

  it('reopens the session file on resume', async () => {
    await new PiRuntimeConnection({ ...input, resumeToken: `${PI_SESSIONS}/prev/s.jsonl` }).start()
    expect(mocks.sessionOpen).toHaveBeenCalledWith(`${PI_SESSIONS}/prev/s.jsonl`, PI_SESSIONS, WORKSPACE)
    expect(mocks.sessionCreate).not.toHaveBeenCalled()
  })

  it('rejects resume tokens outside the Cherry-owned pi session dir', async () => {
    await expect(new PiRuntimeConnection({ ...input, resumeToken: '/tmp/evil.jsonl' }).start()).rejects.toThrow(
      'outside Cherry-owned session dir'
    )
    expect(mocks.sessionOpen).not.toHaveBeenCalled()
    expect(mocks.createAgentSession).not.toHaveBeenCalled()
  })

  it('emits turn-complete only on agent_end, not per turn_end, plus a resume token', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    const cb = mocks.subscribeCb!

    const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }
    cb({ type: 'message_start', message: {} } as unknown as AgentSessionEvent)
    cb({
      type: 'message_update',
      message: {} as never,
      assistantMessageEvent: { type: 'text_start', contentIndex: 0 }
    } as unknown as AgentSessionEvent)
    cb({
      type: 'turn_end',
      message: { role: 'assistant', stopReason: 'toolUse', usage },
      toolResults: []
    } as unknown as AgentSessionEvent)
    cb({
      type: 'turn_end',
      message: { role: 'assistant', stopReason: 'stop', usage },
      toolResults: []
    } as unknown as AgentSessionEvent)
    cb({ type: 'agent_end', messages: [], willRetry: false } as unknown as AgentSessionEvent)

    const events = await collectUntilTerminal(conn.events)
    const terminal = events.filter((e) => e.type === 'turn-complete')
    expect(terminal).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('turn-complete')
    expect(events.some((e) => e.type === 'resume-token' && e.token === SESSION_FILE)).toBe(true)
  })

  it('reports context usage projected from pi accounting', async () => {
    mocks.getContextUsage.mockReturnValue({ tokens: 1234, contextWindow: 200000, percent: 42 })
    const conn = await new PiRuntimeConnection(input).start()
    await expect(conn.getContextUsage()).resolves.toEqual({
      categories: [],
      totalTokens: 1234,
      maxTokens: 200000,
      percentage: 42,
      model: 'm'
    })
  })

  it('returns null context usage before pi can estimate occupancy', async () => {
    mocks.getContextUsage.mockReturnValue(undefined)
    const conn = await new PiRuntimeConnection(input).start()
    await expect(conn.getContextUsage()).resolves.toBeNull()
  })

  it('emits a context-usage event on turn completion', async () => {
    mocks.getContextUsage.mockReturnValue({ tokens: 500, contextWindow: 1000, percent: 50 })
    const conn = await new PiRuntimeConnection(input).start()
    const cb = mocks.subscribeCb!
    cb({ type: 'agent_end', messages: [], willRetry: false } as unknown as AgentSessionEvent)

    const events = await collectUntilTerminal(conn.events)
    const usage = events.find((e) => e.type === 'context-usage')
    expect(usage).toBeTruthy()
    expect((usage as Extract<AgentRuntimeEvent, { type: 'context-usage' }>).usage).toMatchObject({
      totalTokens: 500,
      maxTokens: 1000,
      percentage: 50,
      categories: []
    })
    // The usage event precedes turn-complete so the host caches it before closing the turn.
    expect(events.findIndex((e) => e.type === 'context-usage')).toBeLessThan(
      events.findIndex((e) => e.type === 'turn-complete')
    )
  })

  it('maps pi compaction events to Cherry compaction lifecycle events', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    const cb = mocks.subscribeCb!
    cb({ type: 'compaction_start', reason: 'threshold' } as unknown as AgentSessionEvent)
    cb({
      type: 'compaction_end',
      reason: 'threshold',
      result: { summary: 's', firstKeptEntryId: 'e', tokensBefore: 900, estimatedTokensAfter: 300 },
      aborted: false,
      willRetry: false
    } as unknown as AgentSessionEvent)
    cb({ type: 'agent_end', messages: [], willRetry: false } as unknown as AgentSessionEvent)

    const events = await collectUntilTerminal(conn.events)
    const start = events.find((e) => e.type === 'compaction-start')
    expect(start).toMatchObject({ trigger: 'auto' })
    const complete = events.find((e) => e.type === 'compaction-complete')
    expect(complete).toMatchObject({ anchor: { trigger: 'auto', preTokens: 900, postTokens: 300 } })
  })

  it('surfaces a failed compaction as a compaction-error event', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    const cb = mocks.subscribeCb!
    cb({
      type: 'compaction_end',
      reason: 'manual',
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage: 'context too large'
    } as unknown as AgentSessionEvent)
    cb({ type: 'agent_end', messages: [], willRetry: false } as unknown as AgentSessionEvent)

    const events = await collectUntilTerminal(conn.events)
    const err = events.find((e) => e.type === 'compaction-error')
    expect(err).toMatchObject({ error: 'context too large' })
    expect(events.some((e) => e.type === 'compaction-complete')).toBe(false)
  })

  it('holds the turn open while an auto-retry is pending', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    const cb = mocks.subscribeCb!
    cb({ type: 'agent_end', messages: [], willRetry: true } as unknown as AgentSessionEvent)
    cb({ type: 'agent_end', messages: [], willRetry: false } as unknown as AgentSessionEvent)
    const events = await collectUntilTerminal(conn.events)
    expect(events.filter((e) => e.type === 'turn-complete')).toHaveLength(1)
  })

  it('surfaces an errored turn as a runtime error event', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    const cb = mocks.subscribeCb!
    cb({
      type: 'turn_end',
      message: { role: 'assistant', stopReason: 'error', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      toolResults: []
    } as unknown as AgentSessionEvent)
    cb({
      type: 'agent_end',
      messages: [{ role: 'assistant', errorMessage: 'kaboom' }],
      willRetry: false
    } as unknown as AgentSessionEvent)
    const events = await collectUntilTerminal(conn.events)
    const err = events.find((e) => e.type === 'error')
    expect(err).toBeTruthy()
    expect(String((err as { error: Error }).error)).toContain('kaboom')
  })

  it('close() aborts, unsubscribes, disposes, and completes the event stream', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    await conn.close()
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
    expect(mocks.abort).toHaveBeenCalledOnce()
    expect(mocks.dispose).toHaveBeenCalledOnce()
    // The stream drains any buffered events (e.g. the initial resume-token) then completes.
    const iter = conn.events[Symbol.asyncIterator]()
    let done = false
    for (let i = 0; i < 10 && !done; i += 1) done = (await iter.next()).done ?? false
    expect(done).toBe(true)
  })

  it('disables pi project/user resources until Cherry has a trust prompt/import model', async () => {
    await new PiRuntimeConnection(input).start()
    expect(mocks.settingsArgs).toEqual([{}, { projectTrusted: false }])
    expect(mocks.loaderOpts).toMatchObject({
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true
    })
    expect(mocks.reload).toHaveBeenCalledWith()
  })

  it('wires both the provider and approval extensions and bakes disabledTools into excludeTools', async () => {
    mocks.getAgent.mockResolvedValue({ id: 'agent-1', model: 'p::m', disabledTools: ['bash', 'write'] })
    await new PiRuntimeConnection(input).start()

    const factories = (mocks.loaderOpts as { extensionFactories: unknown[] }).extensionFactories
    expect(factories).toHaveLength(2)
    expect(mocks.createOpts?.tools).toEqual(['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'])
    expect(mocks.createOpts?.excludeTools).toEqual(['bash', 'write'])
  })

  it('normalizes Claude-capitalized disabledTools to pi lowercase (bake-out + live gate)', async () => {
    mocks.getAgent.mockResolvedValue({ id: 'agent-1', model: 'p::m', disabledTools: ['Bash', 'Write'] })
    const conn = await new PiRuntimeConnection(input).start()

    // Baked-out excludeTools use pi's lowercase vocabulary, not the Claude-capitalized ids.
    expect(mocks.createOpts?.excludeTools).toEqual(['bash', 'write'])

    // The live gate blocks pi's lowercase `bash` even though the agent disabled `Bash`.
    const factories = (mocks.loaderOpts as { extensionFactories: Array<(pi: unknown) => void> }).extensionFactories
    let handler!: (event: unknown, ctx: unknown) => Promise<{ block?: boolean } | undefined>
    factories[1]({
      on: (evt: string, h: unknown) => {
        if (evt === 'tool_call') handler = h as typeof handler
      }
    })
    await expect(
      handler(
        { type: 'tool_call', toolName: 'bash', toolCallId: 'tc1', input: { command: 'ls' } },
        { signal: undefined }
      )
    ).resolves.toMatchObject({ block: true })
    void conn
  })

  it('returns null context usage when pi reports tokens as null (post-compaction)', async () => {
    mocks.getContextUsage.mockReturnValue({ tokens: null, contextWindow: 200000, percent: null })
    const conn = await new PiRuntimeConnection(input).start()
    await expect(conn.getContextUsage()).resolves.toBeNull()
  })

  it('does not mislabel a successful auto-retry as an error after a prior error turn_end', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    const cb = mocks.subscribeCb!
    cb({
      type: 'turn_end',
      message: { role: 'assistant', stopReason: 'error', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      toolResults: []
    } as unknown as AgentSessionEvent)
    // Retry pending — must clear the stale 'error' stop-reason.
    cb({ type: 'agent_end', messages: [], willRetry: true } as unknown as AgentSessionEvent)
    // Retry succeeds with no fresh turn_end.
    cb({ type: 'agent_end', messages: [], willRetry: false } as unknown as AgentSessionEvent)

    const events = await collectUntilTerminal(conn.events)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events.at(-1)?.type).toBe('turn-complete')
  })

  it('close() aborts an approval still awaiting the renderer decision', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    const factories = (mocks.loaderOpts as { extensionFactories: Array<(pi: unknown) => void> }).extensionFactories

    let handler!: (event: unknown, ctx: unknown) => Promise<{ block?: boolean; reason?: string } | undefined>
    factories[1]({
      on: (evt: string, h: unknown) => {
        if (evt === 'tool_call') handler = h as typeof handler
      }
    })
    const pending = handler(
      { type: 'tool_call', toolName: 'bash', toolCallId: 'tc1', input: { command: 'ls' } },
      { signal: undefined }
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(toolApprovalRegistry.size()).toBe(1)

    await conn.close()
    await expect(pending).resolves.toMatchObject({ block: true, reason: 'pi-session-closed' })
    expect(toolApprovalRegistry.size()).toBe(0)
  })

  it('applyPolicyUpdate flips permission mode and disabled tools', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    expect(conn.applyPolicyUpdate({ type: 'permission-mode', permissionMode: 'bypassPermissions' })).toBe(true)
    expect(
      conn.applyPolicyUpdate({ type: 'tool-policy', agent: { mcps: [], disabledTools: ['edit'], configuration: {} } })
    ).toBe(true)
  })
})
