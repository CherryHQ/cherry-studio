import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentService } from '../../AgentService'
import { channelService } from '../../ChannelService'
import { sessionMessageService } from '../../SessionMessageService'
import { sessionService } from '../../SessionService'
import { channelMessageHandler } from '../ChannelMessageHandler'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../../security', () => ({
  wrapExternalContent: vi.fn((text: string) => text),
  sanitizeChannelOutput: vi.fn((text: string) => ({ text, redacted: false }))
}))

vi.mock('../../AgentService', () => ({
  agentService: {
    getAgent: vi.fn().mockResolvedValue({ configuration: {} })
  }
}))

vi.mock('../../SessionService', () => ({
  sessionService: {
    listSessions: vi.fn().mockResolvedValue({ sessions: [], total: 0 }),
    getSession: vi.fn(),
    createSession: vi.fn()
  }
}))

vi.mock('../../SessionMessageService', () => ({
  sessionMessageService: {
    createSessionMessage: vi.fn()
  }
}))

vi.mock('../../ChannelService', () => ({
  channelService: {
    getChannel: vi.fn().mockResolvedValue({ id: 'channel-1', sessionId: null, permissionMode: null }),
    updateChannel: vi.fn().mockResolvedValue(null),
    findBySessionId: vi.fn().mockResolvedValue(null)
  }
}))

vi.mock('../SessionStreamBus', () => ({
  sessionStreamBus: {
    publish: vi.fn(),
    subscribe: vi.fn(),
    cleanup: vi.fn(),
    hasSubscribers: vi.fn().mockReturnValue(false)
  }
}))

vi.mock('../sessionStreamIpc', () => ({
  broadcastSessionChanged: vi.fn()
}))

function createMockStream(parts: Array<{ type: string; text?: string }>) {
  const stream = new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part)
      }
      controller.close()
    }
  })
  return { stream, completion: Promise.resolve({}) }
}

function createMockAdapter(overrides: Record<string, unknown> = {}) {
  const adapter = new EventEmitter() as any
  adapter.agentId = overrides.agentId ?? 'agent-1'
  adapter.channelId = overrides.channelId ?? 'channel-1'
  adapter.channelType = overrides.channelType ?? 'telegram'
  adapter.sendMessage = vi.fn().mockResolvedValue(undefined)
  adapter.sendTypingIndicator = vi.fn().mockResolvedValue(undefined)
  adapter.onTextUpdate = vi.fn().mockResolvedValue(undefined)
  adapter.onStreamComplete = vi.fn().mockResolvedValue(false)
  adapter.onStreamError = vi.fn().mockResolvedValue(undefined)
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
    // Reset the default mock for listSessions after clearAllMocks
    vi.mocked(sessionService.listSessions).mockResolvedValue({ sessions: [] as any[], total: 0 })
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
      agent_id: 'agent-1',
      agent_type: 'claude-code',
      accessible_paths: ['/tmp/test-workspace'],
      configuration: {}
    }

    vi.mocked(sessionService.createSession).mockResolvedValueOnce(session as any)
    vi.mocked(sessionMessageService.createSessionMessage).mockResolvedValueOnce(
      createMockStream([
        // Turn 1: cumulative text-delta within block
        { type: 'text-delta', text: 'Hello ' },
        { type: 'text-delta', text: 'Hello world!' },
        { type: 'text-end' },
        // Turn 2: new block after tool use
        { type: 'text-delta', text: 'Done.' },
        { type: 'text-end' }
      ]) as any
    )

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'Hello world!\n\nDone.')
  })

  it('skips final send when adapter handles stream completion', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agent_id: 'agent-1',
      agent_type: 'claude-code',
      accessible_paths: ['/tmp/test-workspace'],
      configuration: {}
    }

    adapter.onStreamComplete.mockResolvedValueOnce(true)
    vi.mocked(sessionService.createSession).mockResolvedValueOnce(session as any)
    vi.mocked(sessionMessageService.createSessionMessage).mockResolvedValueOnce(
      createMockStream([{ type: 'text-delta', text: 'Hello world!' }]) as any
    )

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    expect(adapter.onStreamComplete).toHaveBeenCalledWith('chat-1', 'Hello world!')
    expect(adapter.sendMessage).not.toHaveBeenCalled()
  })

  it('sends chunked messages for long responses', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agent_id: 'agent-1',
      agent_type: 'claude-code',
      accessible_paths: ['/tmp/test-workspace'],
      configuration: {}
    }

    vi.mocked(sessionService.createSession).mockResolvedValueOnce(session as any)

    const longText = 'A'.repeat(5000)
    vi.mocked(sessionMessageService.createSessionMessage).mockResolvedValueOnce(
      createMockStream([{ type: 'text-delta', text: longText }]) as any
    )

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    expect(adapter.sendMessage).toHaveBeenCalledTimes(2)
  })

  it('handleCommand /new creates a new session', async () => {
    const adapter = createMockAdapter()
    vi.mocked(sessionService.createSession).mockResolvedValueOnce({ id: 'new-session' } as any)

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'new'
    })

    expect(sessionService.createSession).toHaveBeenCalledWith('agent-1', {
      configuration: {}
    })
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'New session created.')
  })

  it('handleCommand /compact sends /compact as message content', async () => {
    const adapter = createMockAdapter()
    const session = {
      id: 'session-1',
      agent_id: 'agent-1',
      agent_type: 'claude-code',
      accessible_paths: ['/tmp/test-workspace'],
      configuration: {}
    }

    vi.mocked(sessionService.createSession).mockResolvedValueOnce(session as any)
    vi.mocked(sessionMessageService.createSessionMessage).mockResolvedValueOnce(
      createMockStream([{ type: 'text-delta', text: 'Compacted.' }]) as any
    )

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'compact'
    })

    expect(sessionMessageService.createSessionMessage).toHaveBeenCalledWith(
      session,
      { content: '/compact' },
      expect.any(AbortController),
      { persist: true }
    )
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
      agent_id: 'agent-1',
      agent_type: 'claude-code',
      accessible_paths: ['/tmp/test-workspace'],
      configuration: {}
    }

    vi.mocked(sessionService.createSession).mockResolvedValueOnce(newSession as any)

    await channelMessageHandler.handleCommand(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      command: 'new'
    })

    // Now send a message — should use the tracked session
    vi.mocked(sessionService.getSession).mockResolvedValueOnce(newSession as any)
    vi.mocked(sessionMessageService.createSessionMessage).mockResolvedValueOnce(
      createMockStream([{ type: 'text-delta', text: 'OK' }]) as any
    )

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'test'
    })

    expect(sessionService.getSession).toHaveBeenCalledWith('agent-1', 'new-session')
  })

  it('clearSessionTracker causes fresh session resolution', async () => {
    const adapter = createMockAdapter()
    const session1 = {
      id: 'session-1',
      agent_id: 'agent-1',
      agent_type: 'claude-code',
      accessible_paths: ['/tmp/test-workspace'],
      configuration: {}
    }

    // First interaction creates a session
    vi.mocked(sessionService.createSession).mockResolvedValueOnce(session1 as any)
    vi.mocked(sessionMessageService.createSessionMessage).mockResolvedValueOnce(
      createMockStream([{ type: 'text-delta', text: 'R1' }]) as any
    )

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
    vi.mocked(sessionService.getSession).mockResolvedValueOnce(session1 as any)
    vi.mocked(sessionMessageService.createSessionMessage).mockResolvedValueOnce(
      createMockStream([{ type: 'text-delta', text: 'R2' }]) as any
    )

    await handleIncomingAndFlush(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'msg2'
    })

    // After clearing tracker, should look up channel then getSession instead of creating new session
    expect(channelService.getChannel).toHaveBeenCalledWith('channel-1')
    // Only 1 createSession call (the first one), not 2
    expect(sessionService.createSession).toHaveBeenCalledTimes(1)
  })
})
