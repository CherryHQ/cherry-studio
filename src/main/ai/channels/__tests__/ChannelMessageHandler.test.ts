import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { AgentSessionWorkspaceError } from '@main/ai/runtime/claudeCode/settingsBuilder'
import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { channelMessageHandler } from '../ChannelMessageHandler'
import { sanitizeChannelOutput } from '../security'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../security', () => ({
  wrapExternalContent: vi.fn((text: string) => text),
  sanitizeChannelOutput: vi.fn((text: string) => ({ text, redacted: false }))
}))

// The global mock (tests/main.setup.ts) wires the default service set, which omits
// AiStreamManager; the abort path reads it, so override locally with a captured spy.
const { mockStreamAbort } = vi.hoisted(() => ({ mockStreamAbort: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ AiStreamManager: { abort: mockStreamAbort } } as never)
})

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    getAgent: vi.fn().mockResolvedValue({
      id: 'agent-1',
      configuration: {},
      model: 'openai::gpt-4'
    })
  }
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    getById: vi.fn(),
    createSession: vi.fn()
  }
}))

vi.mock('@shared/data/types/model', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    createUniqueModelId: vi.fn((providerId: string, modelId: string) => `${providerId}::${modelId}`)
  }
})

const { mockStartAgentSessionRun } = vi.hoisted(() => ({ mockStartAgentSessionRun: vi.fn() }))
vi.mock('@main/ai/streamManager/api/startAgentSessionRun', () => ({
  startAgentSessionRun: (...args: unknown[]) => mockStartAgentSessionRun(...args)
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    getChannel: vi.fn().mockResolvedValue({ id: 'channel-1', sessionId: null, permissionMode: null }),
    updateChannel: vi.fn().mockResolvedValue(null),
    findBySessionId: vi.fn().mockResolvedValue(null)
  }
}))

/**
 * Helper: configure mockStartAgentSessionRun to simulate streaming chunks to ALL
 * registered listeners (both the `channel-completion:` sentinel and the
 * `ChannelAdapterListener` that owns delivery), then call onDone on each so the
 * `executionDone` promise inside `collectStreamResponse` resolves and the listener
 * finalizes delivery. `text-delta` chunks carry the payload on `delta` (AI SDK
 * `UIMessageChunk`), not `text`.
 */
function simulateStream(parts: Array<{ type: string; delta?: string }>) {
  mockStartAgentSessionRun.mockImplementationOnce(
    async ({
      listeners
    }: {
      listeners: Array<{
        id: string
        onChunk: (chunk: unknown) => void
        onDone: (result: { status: string }) => void | Promise<void>
      }>
    }) => {
      for (const listener of listeners) {
        for (const part of parts) {
          listener.onChunk(part)
        }
        await listener.onDone({ status: 'success' })
      }
    }
  )
}

function createMockAdapter(overrides: Record<string, unknown> = {}) {
  const adapter = new EventEmitter() as any
  adapter.agentId = overrides.agentId ?? 'agent-1'
  adapter.channelId = overrides.channelId ?? 'channel-1'
  adapter.channelType = overrides.channelType ?? 'telegram'
  adapter.connected = true
  adapter.sendMessage = vi.fn().mockResolvedValue(undefined)
  adapter.sendTypingIndicator = vi.fn().mockResolvedValue(undefined)
  adapter.onTextUpdate = vi.fn().mockResolvedValue(undefined)
  adapter.onStreamComplete = vi.fn().mockResolvedValue(false)
  adapter.onStreamError = vi.fn().mockResolvedValue(undefined)
  adapter.notifyChatIds = []
  return adapter
}

/**
 * Helper: call handleIncoming and advance fake timers so the debounce fires,
 * then await the returned promise to wait for processing to complete.
 */
async function handleIncomingAndFlush(
  adapter: ReturnType<typeof createMockAdapter>,
  message: { chatId: string; userId: string; userName: string; text: string }
) {
  const promise = channelMessageHandler.handleIncoming(adapter, message)
  // Advance past the MESSAGE_BATCH_DELAY_MS debounce (10 000 ms)
  await vi.advanceTimersByTimeAsync(10500)
  return promise
}

describe('ChannelMessageHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // Restore default agent mock after clearAllMocks
    vi.mocked(agentService.getAgent).mockResolvedValue({
      id: 'agent-1',
      configuration: {},
      model: 'openai::gpt-4'
    } as any)
    // Clear session tracker to ensure clean state
    channelMessageHandler.clearSessionTracker('agent-1')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('collectStreamResponse accumulates text across turns and sends via adapter', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }

    vi.mocked(agentSessionService.createSession).mockResolvedValueOnce(session as any)
    simulateStream([
      { type: 'text-delta', delta: 'Hello ' },
      { type: 'text-delta', delta: 'world!' },
      { type: 'text-end' },
      { type: 'text-delta', delta: '\n\nDone.' },
      { type: 'text-end' }
    ])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    // Delivery is owned by ChannelAdapterListener (the handler no longer post-sends);
    // it accumulates all text-delta chunks via `.delta`, trims, and sends once.
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'Hello world!\n\nDone.')
  })

  // channels-core-3: the streaming delivery path (real ChannelAdapterListener) must route
  // output through the OutputSanitizer before sending — otherwise secrets in the model reply
  // leak to the IM platform. simulateStream drives the real listener, so a redacting sanitizer
  // must be reflected in what the adapter sends.
  it('routes channel output through the OutputSanitizer before delivery (REGRESSION channels-core-3)', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }
    vi.mocked(agentSessionService.createSession).mockResolvedValueOnce(session as any)

    vi.mocked(sanitizeChannelOutput).mockImplementation((text: string) => ({
      text: text.replace('sk-SECRET', '<redacted>'),
      redacted: text.includes('sk-SECRET')
    }))
    simulateStream([{ type: 'text-delta', delta: 'the key is sk-SECRET' }])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    expect(sanitizeChannelOutput).toHaveBeenCalled()
    // The redacted text — not the raw secret — is what reaches the adapter.
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'the key is <redacted>')

    // Restore the identity default so later tests are unaffected.
    vi.mocked(sanitizeChannelOutput).mockImplementation((text: string) => ({ text, redacted: false }))
  })

  // stream-context-5: a workspace error is thrown before streaming starts, so onStreamError
  // (a no-op without a live controller on most adapters) can't surface it. The handler must
  // fall back to a plain sendMessage so the inbound message isn't silently dropped.
  it('surfaces a pre-stream workspace error as a plain message (REGRESSION stream-context-5)', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }
    vi.mocked(agentSessionService.createSession).mockResolvedValueOnce(session as any)
    mockStartAgentSessionRun.mockRejectedValueOnce(new AgentSessionWorkspaceError('workspace is missing'))

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'workspace is missing')
    expect(adapter.onStreamError).not.toHaveBeenCalled()
  })

  it('skips final send when adapter handles stream completion', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }

    adapter.onStreamComplete.mockResolvedValueOnce(true)
    vi.mocked(agentSessionService.createSession).mockResolvedValueOnce(session as any)
    simulateStream([{ type: 'text-delta', delta: 'Hello world!' }])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    expect(adapter.onStreamComplete).toHaveBeenCalledWith('chat-1', 'Hello world!')
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  it('delivers a long response in a single send (platform splitting is the adapter concern)', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }

    vi.mocked(agentSessionService.createSession).mockResolvedValueOnce(session as any)

    const longText = 'A'.repeat(5000)
    simulateStream([{ type: 'text-delta', delta: longText }])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    // The handler-level 4096-char chunking was dead code (post-hoc path never ran)
    // and has been removed; ChannelAdapterListener delivers the full text once and
    // each adapter splits per its own platform limit.
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', longText)
  })

  it('handleCommand /new creates a new session', async () => {
    const adapter = createMockAdapter()
    vi.mocked(agentSessionService.createSession).mockResolvedValueOnce({ id: 'new-session' } as any)

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'new'
    })

    expect(agentSessionService.createSession).toHaveBeenCalledWith({
      agentId: 'agent-1',
      name: 'Channel session'
    })
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'New session created.')
  })

  it('handleCommand /compact sends /compact as message content', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }

    vi.mocked(agentSessionService.createSession).mockResolvedValueOnce(session as any)
    simulateStream([{ type: 'text-delta', delta: 'Compacted.' }])

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'compact'
    })

    expect(mockStartAgentSessionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        userParts: [{ type: 'text', text: '/compact' }],
        listeners: expect.arrayContaining([
          expect.objectContaining({ id: expect.stringContaining('channel-completion:') })
        ])
      })
    )
    // ChannelAdapterListener delivers the compact output once; the handler no longer
    // also sends it (would have been a double-send once the `.delta` read was fixed).
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'Compacted.')
  })

  it('handleCommand /help sends help text with agent info', async () => {
    const adapter = createMockAdapter()
    vi.mocked(agentService.getAgent).mockResolvedValueOnce({
      name: 'TestAgent',
      description: 'A test agent'
    } as any)

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'help'
    })

    expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
    const helpText = adapter.sendMessage.mock.calls[0][1] as string
    expect(helpText).toContain('*TestAgent*')
    expect(helpText).toContain('_A test agent_')
    expect(helpText).toContain('/new')
    expect(helpText).toContain('/compact')
    expect(helpText).toContain('/help')
    expect(helpText).toContain('/whoami')
  })

  it('handleCommand /whoami sends the current chat ID', async () => {
    const adapter = createMockAdapter()

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'oc_123',
      userId: 'user-1',
      userName: 'User',
      command: 'whoami'
    })

    expect(adapter.sendMessage).toHaveBeenCalledWith(
      'oc_123',
      'Current chat ID: `oc_123`\n\nAdd this value to `allow_ids` in settings to receive notifications.'
    )
  })

  it('resolveSession tracks sessions after /new', async () => {
    const adapter = createMockAdapter()
    const newSession = {
      id: 'new-session',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }

    vi.mocked(agentSessionService.createSession).mockResolvedValueOnce(newSession as any)

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'new'
    })

    // Now send a message — should use the tracked session
    vi.mocked(agentSessionService.getById).mockResolvedValueOnce(newSession as any)
    simulateStream([{ type: 'text-delta', delta: 'OK' }])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'test'
    })

    expect(agentSessionService.getById).toHaveBeenCalledWith('new-session')
  })

  it('clearSessionTracker causes fresh session resolution', async () => {
    const adapter = createMockAdapter()
    const session1 = {
      id: 'session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      model: 'openai::gpt-4',
      workspace: { path: '/tmp/test-workspace' },
      configuration: {}
    }

    // First interaction creates a session
    vi.mocked(agentSessionService.createSession).mockResolvedValueOnce(session1 as any)
    simulateStream([{ type: 'text-delta', delta: 'R1' }])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'msg1'
    })

    // Clear session tracker
    channelMessageHandler.clearSessionTracker('agent-1')

    // Next interaction should find existing session via channel's session_id
    vi.mocked(channelService.getChannel).mockResolvedValueOnce({
      id: 'channel-1',
      sessionId: 'session-1',
      permissionMode: null
    } as any)
    vi.mocked(agentSessionService.getById).mockResolvedValueOnce(session1 as any)
    simulateStream([{ type: 'text-delta', delta: 'R2' }])

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'msg2'
    })

    // After clearing tracker, should look up channel then getSession instead of creating new session
    expect(channelService.getChannel).toHaveBeenCalledWith('channel-1')
    // Only 1 createSession call (the first one), not 2
    expect(agentSessionService.createSession).toHaveBeenCalledTimes(1)
  })

  // channels-core-3: discarding a pending (un-flushed) batch must settle its callers'
  // handleIncoming promises instead of leaving them hanging forever, so .catch fires.
  it('clearSessionTracker rejects pending-batch handleIncoming promises', async () => {
    const adapter = createMockAdapter()

    // Start a batch but do NOT advance timers — it stays pending in pendingBatches.
    const pending = channelMessageHandler.handleIncoming(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })
    const rejection = expect(pending).rejects.toThrow('Agent removed; batch discarded')

    // Clearing the agent's tracker discards the pending batch.
    channelMessageHandler.clearSessionTracker('agent-1')

    await rejection
    expect(mockStartAgentSessionRun).not.toHaveBeenCalled()
  })

  // channels-core-2: a local AbortController only flips a listener's isAlive() — clearing
  // a tracked session must stop the upstream agent-session turn via the manager.
  it('clearSessionTracker aborts the upstream agent-session turn via the manager', async () => {
    const adapter = createMockAdapter()
    vi.mocked(agentSessionService.createSession).mockResolvedValueOnce({ id: 'sess-x' } as any)

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'new'
    })
    mockStreamAbort.mockClear()

    channelMessageHandler.clearSessionTracker('agent-1')

    expect(mockStreamAbort).toHaveBeenCalledWith(buildAgentSessionTopicId('sess-x'), 'agent-cleared')
  })
})
