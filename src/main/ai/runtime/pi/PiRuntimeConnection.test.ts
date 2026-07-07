import type * as NodeFs from 'node:fs'

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeConnectInput, AgentRuntimeEvent, AgentRuntimeUserInput } from '../types'

const PI_ROOT = '/cherry/agents/pi'
const PI_SESSIONS = '/cherry/agents/pi/sessions'
const WORKSPACE = '/work/space'
const SESSION_ID = 'sess-1'
const SESSION_FILE = `${PI_SESSIONS}/2026-07-06T00-00-00-000Z_${SESSION_ID}.jsonl`

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  getAgent: vi.fn(),
  resolveInjection: vi.fn(),
  getPath: vi.fn(),
  loadPiSdk: vi.fn(),
  readdirSync: vi.fn(),
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
  compact: vi.fn(),
  steer: vi.fn(),
  clearQueue: vi.fn(),
  abort: vi.fn(),
  dispose: vi.fn(),
  getContextUsage: vi.fn(),
  createOpts: undefined as Record<string, unknown> | undefined,
  loaderOpts: undefined as Record<string, unknown> | undefined,
  settingsArgs: undefined as unknown[] | undefined,
  isStreaming: false,
  steeringMode: 'one-at-a-time' as 'all' | 'one-at-a-time',
  sessionId: 'sess-1' as string | undefined,
  sessionFile: '/cherry/agents/pi/sessions/2026-07-06T00-00-00-000Z_sess-1.jsonl' as string | undefined
}))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  readdirSync: mocks.readdirSync
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
  get sessionId() {
    return mocks.sessionId
  },
  subscribe: (cb: (event: AgentSessionEvent) => void) => {
    mocks.subscribeCb = cb
    return mocks.unsubscribe
  },
  get steeringMode() {
    return mocks.steeringMode
  },
  prompt: mocks.prompt,
  compact: mocks.compact,
  steer: mocks.steer,
  clearQueue: mocks.clearQueue,
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

function userInput(text: string, systemReminder = false): AgentRuntimeUserInput {
  return {
    message: {
      id: `msg-${text}`,
      data: { parts: [{ type: 'text' as const, text }] }
    } as AgentRuntimeUserInput['message'],
    systemReminder
  }
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

async function nextEventWithin(events: AsyncIterable<AgentRuntimeEvent>): Promise<AgentRuntimeEvent | undefined> {
  const iter = events[Symbol.asyncIterator]()
  return Promise.race([
    iter.next().then(({ value, done }) => (done ? undefined : value)),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 20))
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  toolApprovalRegistry.clear('test-reset')
  mocks.subscribeCb = undefined
  mocks.createOpts = undefined
  mocks.loaderOpts = undefined
  mocks.settingsArgs = undefined
  mocks.isStreaming = false
  mocks.steeringMode = 'one-at-a-time'
  mocks.sessionId = SESSION_ID
  mocks.sessionFile = SESSION_FILE
  mocks.readdirSync.mockReturnValue([])
  delete process.env.PI_CODING_AGENT_DIR
  delete process.env.PI_CODING_AGENT_SESSION_DIR

  mocks.getById.mockReturnValue({ id: 'sess-1', agentId: 'agent-1', workspace: { path: WORKSPACE } })
  mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'p::m', instructions: 'Be helpful.' })
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
  mocks.compact.mockResolvedValue({})
  mocks.steer.mockResolvedValue(undefined)
  mocks.clearQueue.mockReturnValue({ steering: [], followUp: [] })
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
    expect(mocks.sessionCreate).toHaveBeenCalledWith(WORKSPACE, PI_SESSIONS, { id: SESSION_ID })
    expect(mocks.sessionOpen).not.toHaveBeenCalled()
    // agent.instructions become the pi system prompt override; disk SYSTEM.md discovery is suppressed.
    expect(mocks.loaderOpts).toMatchObject({ systemPrompt: '', appendSystemPrompt: [] })
    expect(typeof (mocks.loaderOpts as { systemPromptOverride?: () => string }).systemPromptOverride).toBe('function')
    expect((mocks.loaderOpts as { systemPromptOverride: () => string }).systemPromptOverride()).toBe('Be helpful.')
  })

  it('reopens the session file by scanning for the resume session id', async () => {
    mocks.readdirSync.mockReturnValue(['2026-07-06T00-00-00-000Z_sess-1.jsonl'])

    await new PiRuntimeConnection({ ...input, resumeToken: SESSION_ID }).start()
    expect(mocks.sessionOpen).toHaveBeenCalledWith(
      `${PI_SESSIONS}/2026-07-06T00-00-00-000Z_sess-1.jsonl`,
      PI_SESSIONS,
      WORKSPACE
    )
    expect(mocks.sessionCreate).not.toHaveBeenCalled()
  })

  it('opens the newest matching session file when a resume id has multiple files', async () => {
    mocks.readdirSync.mockReturnValue([
      '2026-07-06T00-00-00-000Z_sess-1.jsonl',
      '2026-07-06T01-00-00-000Z_sess-1.jsonl'
    ])

    await new PiRuntimeConnection({ ...input, resumeToken: SESSION_ID }).start()
    expect(mocks.sessionOpen).toHaveBeenCalledWith(
      `${PI_SESSIONS}/2026-07-06T01-00-00-000Z_sess-1.jsonl`,
      PI_SESSIONS,
      WORKSPACE
    )
  })

  it('rejects a malformed resume token (path separators / traversal / illegal chars)', async () => {
    await expect(new PiRuntimeConnection({ ...input, resumeToken: '/tmp/evil.jsonl' }).start()).rejects.toThrow(
      'valid session id inside Cherry-owned session dir'
    )
    await expect(new PiRuntimeConnection({ ...input, resumeToken: '../evil' }).start()).rejects.toThrow(
      'valid session id inside Cherry-owned session dir'
    )
    await expect(new PiRuntimeConnection({ ...input, resumeToken: 'foo/bar' }).start()).rejects.toThrow(
      'valid session id inside Cherry-owned session dir'
    )
    expect(mocks.sessionOpen).not.toHaveBeenCalled()
    expect(mocks.createAgentSession).not.toHaveBeenCalled()
  })

  it('falls back to a fresh session with the same id when a valid token has no file on disk', async () => {
    // pi flushes the JSONL lazily, so a token can point at a session that never persisted. That must
    // degrade to a new empty session (same id) instead of bricking every future turn.
    mocks.readdirSync.mockReturnValue([])

    await new PiRuntimeConnection({ ...input, resumeToken: 'missing-id' }).start()
    expect(mocks.sessionOpen).not.toHaveBeenCalled()
    expect(mocks.sessionCreate).toHaveBeenCalledWith(WORKSPACE, PI_SESSIONS, { id: SESSION_ID })
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
    expect(events.some((e) => e.type === 'resume-token' && e.token === SESSION_ID)).toBe(true)
  })

  it('send routes normal messages to prompt', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    conn.send(userInput('hello'))
    await Promise.resolve()

    expect(mocks.prompt).toHaveBeenCalledWith('hello', undefined)
    expect(mocks.compact).not.toHaveBeenCalled()
  })

  it('send routes /compact to compact without prompting', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    conn.send(userInput('/compact'))
    await Promise.resolve()

    expect(mocks.compact).toHaveBeenCalledWith(undefined)
    expect(mocks.prompt).not.toHaveBeenCalled()
  })

  it('send passes /compact instructions to compact', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    conn.send(userInput('/compact focus on the API changes'))
    await Promise.resolve()

    expect(mocks.compact).toHaveBeenCalledWith('focus on the API changes')
    expect(mocks.prompt).not.toHaveBeenCalled()
  })

  it('wraps a systemReminder send as a steer reminder and never treats it as /compact', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    conn.send(userInput('/compact', true))
    await Promise.resolve()

    expect(mocks.compact).not.toHaveBeenCalled()
    expect(mocks.prompt).toHaveBeenCalledWith(
      [
        '<system-reminder>',
        'The user sent the following message:',
        '/compact',
        '',
        'Please address this message and continue with your tasks.',
        '</system-reminder>'
      ].join('\n'),
      undefined
    )
  })

  it('completes the host turn after a manual compact succeeds', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    conn.send(userInput('/compact'))
    mocks.subscribeCb!({ type: 'compaction_start', reason: 'manual' } as unknown as AgentSessionEvent)
    mocks.subscribeCb!({
      type: 'compaction_end',
      reason: 'manual',
      result: { summary: 's', firstKeptEntryId: 'e' },
      aborted: false,
      willRetry: false
    } as unknown as AgentSessionEvent)

    const events = await collectUntilTerminal(conn.events)
    const completeIndex = events.findIndex((e) => e.type === 'compaction-complete')
    const turnIndex = events.findIndex((e) => e.type === 'turn-complete')
    expect(completeIndex).toBeGreaterThanOrEqual(0)
    expect(turnIndex).toBe(completeIndex + 1)
  })

  it('does not complete the host turn after an auto compaction ends', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    mocks.subscribeCb!({
      type: 'compaction_end',
      reason: 'threshold',
      result: { summary: 's', firstKeptEntryId: 'e' },
      aborted: false,
      willRetry: false
    } as unknown as AgentSessionEvent)

    expect(await nextEventWithin(conn.events)).toMatchObject({ type: 'resume-token' })
    expect(await nextEventWithin(conn.events)).toMatchObject({ type: 'compaction-complete' })
    expect(await nextEventWithin(conn.events)).toBeUndefined()
  })

  it('settles a failed manual compact with exactly one error terminal (no turn-complete)', async () => {
    // Real pi emits compaction_end (with the error) synchronously BEFORE compact() rejects, so the
    // failure must settle once via that event; the later rejection is a guarded no-op.
    mocks.compact.mockRejectedValueOnce(new Error('compact rejected'))
    const conn = await new PiRuntimeConnection(input).start()
    conn.send(userInput('/compact'))
    mocks.subscribeCb!({
      type: 'compaction_end',
      reason: 'manual',
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage: 'context too large'
    } as unknown as AgentSessionEvent)

    const events = await collectUntilTerminal(conn.events)
    const terminals = events.filter((e) => e.type === 'error' || e.type === 'turn-complete')
    expect(terminals).toHaveLength(1)
    expect(terminals[0]).toMatchObject({ type: 'error' })
    expect(String((terminals[0] as { error: Error }).error)).toContain('context too large')
    // The late compact() rejection must not push a second terminal.
    expect(await nextEventWithin(conn.events)).toBeUndefined()
  })

  it('settles a successful manual compact with exactly one turn-complete terminal', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    conn.send(userInput('/compact'))
    mocks.subscribeCb!({
      type: 'compaction_end',
      reason: 'manual',
      result: { summary: 's', firstKeptEntryId: 'e' },
      aborted: false,
      willRetry: false
    } as unknown as AgentSessionEvent)

    const events = await collectUntilTerminal(conn.events)
    const terminals = events.filter((e) => e.type === 'error' || e.type === 'turn-complete')
    expect(terminals).toHaveLength(1)
    expect(terminals[0]).toMatchObject({ type: 'turn-complete' })
    // The compact() resolve is a no-op once compaction_end already settled the turn.
    expect(await nextEventWithin(conn.events)).toBeUndefined()
  })

  it('redirect returns false when no live turn', async () => {
    const conn = await new PiRuntimeConnection(input).start()
    expect(conn.redirect(userInput('change course'))).toBe(false)
    expect(mocks.steer).not.toHaveBeenCalled()
  })

  it('redirect stashes a live steer and sends system-reminder-wrapped text to pi', async () => {
    mocks.isStreaming = true
    const conn = await new PiRuntimeConnection(input).start()
    const steer = userInput('change course')

    expect(conn.redirect(steer)).toBe(true)

    expect(mocks.steer).toHaveBeenCalledWith(
      [
        '<system-reminder>',
        'The user sent the following message:',
        'change course',
        '',
        'Please address this message and continue with your tasks.',
        '</system-reminder>'
      ].join('\n')
    )
  })

  it('emits steer-boundary for a delivered steer before later assistant chunks', async () => {
    mocks.isStreaming = true
    const conn = await new PiRuntimeConnection(input).start()
    const steer = userInput('new direction')
    expect(conn.redirect(steer)).toBe(true)
    const cb = mocks.subscribeCb!

    cb({ type: 'message_start', message: { role: 'user' } } as unknown as AgentSessionEvent)
    cb({ type: 'message_start', message: { role: 'assistant' } } as unknown as AgentSessionEvent)
    cb({
      type: 'message_update',
      message: {} as never,
      assistantMessageEvent: { type: 'text_start', contentIndex: 0 }
    } as unknown as AgentSessionEvent)
    cb({ type: 'agent_end', messages: [], willRetry: false } as unknown as AgentSessionEvent)

    const events = await collectUntilTerminal(conn.events)
    const boundaryIndex = events.findIndex((e) => e.type === 'steer-boundary')
    const chunkIndex = events.findIndex((e) => e.type === 'chunk')
    expect(events[boundaryIndex]).toMatchObject({ type: 'steer-boundary', inputs: [steer] })
    expect(boundaryIndex).toBeGreaterThanOrEqual(0)
    expect(boundaryIndex).toBeLessThan(chunkIndex)
  })

  it('emits undelivered steers before turn-complete when the turn ends first', async () => {
    mocks.isStreaming = true
    const conn = await new PiRuntimeConnection(input).start()
    const steer = userInput('too late')
    expect(conn.redirect(steer)).toBe(true)

    mocks.isStreaming = false
    mocks.subscribeCb!({ type: 'agent_end', messages: [], willRetry: false } as unknown as AgentSessionEvent)

    const events = await collectUntilTerminal(conn.events)
    const undeliveredIndex = events.findIndex((e) => e.type === 'steer-undelivered')
    const completeIndex = events.findIndex((e) => e.type === 'turn-complete')
    expect(events[undeliveredIndex]).toMatchObject({ type: 'steer-undelivered', inputs: [steer] })
    expect(undeliveredIndex).toBeLessThan(completeIndex)
  })

  it('clears pi steering queue on an errored turn with an undelivered steer (no duplicate re-inject)', async () => {
    mocks.isStreaming = true
    const conn = await new PiRuntimeConnection(input).start()
    const steer = userInput('too late on error')
    expect(conn.redirect(steer)).toBe(true)

    mocks.isStreaming = false
    const cb = mocks.subscribeCb!
    cb({
      type: 'turn_end',
      message: { role: 'assistant', stopReason: 'error', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      toolResults: []
    } as unknown as AgentSessionEvent)
    cb({ type: 'agent_end', messages: [{ role: 'assistant', errorMessage: 'boom' }], willRetry: false } as never)

    const events = await collectUntilTerminal(conn.events)
    expect(events.find((e) => e.type === 'steer-undelivered')).toMatchObject({ inputs: [steer] })
    expect(mocks.clearQueue).toHaveBeenCalledOnce()
    // The turn still surfaces the error terminal; steer-undelivered precedes it.
    expect(events.at(-1)?.type).toBe('error')
  })

  it('surfaces steer rejection as an error and un-stashes the input', async () => {
    mocks.isStreaming = true
    mocks.steer.mockRejectedValueOnce(new Error('steer rejected'))
    const conn = await new PiRuntimeConnection(input).start()
    const steer = userInput('bad steer')
    expect(conn.redirect(steer)).toBe(true)

    const events = await collectUntilTerminal(conn.events)
    expect(events.find((e) => e.type === 'error')).toMatchObject({ error: new Error('steer rejected') })

    mocks.subscribeCb!({ type: 'agent_end', messages: [], willRetry: false } as unknown as AgentSessionEvent)
    const iter = conn.events[Symbol.asyncIterator]()
    const next = await iter.next()
    expect(next.value?.type).not.toBe('steer-undelivered')
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
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'p::m', disabledTools: ['bash', 'write'] })
    await new PiRuntimeConnection(input).start()

    const factories = (mocks.loaderOpts as { extensionFactories: unknown[] }).extensionFactories
    expect(factories).toHaveLength(2)
    expect(mocks.createOpts?.tools).toEqual(['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'])
    expect(mocks.createOpts?.excludeTools).toEqual(['bash', 'write'])
  })

  it('normalizes Claude-capitalized disabledTools to pi lowercase (bake-out + live gate)', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: 'p::m', disabledTools: ['Bash', 'Write'] })
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
