import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentService } from '../../AgentService'
import { sessionMessageService } from '../../SessionMessageService'
import { sessionService } from '../../SessionService'
import { channelMessageHandler } from '../ChannelMessageHandler'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../../AgentService', () => ({
  agentService: {
    getAgent: vi.fn()
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
  adapter.sendMessage = vi.fn().mockResolvedValue(undefined)
  adapter.sendMessageDraft = vi.fn().mockResolvedValue(undefined)
  adapter.sendTypingIndicator = vi.fn().mockResolvedValue(undefined)
  return adapter
}

describe('ChannelMessageHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the default mock for listSessions after clearAllMocks
    vi.mocked(sessionService.listSessions).mockResolvedValue({ sessions: [] as any[], total: 0 })
    // Clear session tracker to ensure clean state
    channelMessageHandler.clearSessionTracker('agent-1')
  })

  it('collectStreamResponse accumulates text across turns and sends via adapter', async () => {
    const adapter = createMockAdapter()
    const session = { id: 'session-1', agent_id: 'agent-1', agent_type: 'cherry-claw' }

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

    await channelMessageHandler.handleIncoming(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'Hi'
    })

    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'Hello world!\n\nDone.')
  })

  it('sends chunked messages for long responses', async () => {
    const adapter = createMockAdapter()
    const session = { id: 'session-1', agent_id: 'agent-1', agent_type: 'cherry-claw' }

    vi.mocked(sessionService.createSession).mockResolvedValueOnce(session as any)

    const longText = 'A'.repeat(5000)
    vi.mocked(sessionMessageService.createSessionMessage).mockResolvedValueOnce(
      createMockStream([{ type: 'text-delta', text: longText }]) as any
    )

    await channelMessageHandler.handleIncoming(adapter, {
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

    expect(sessionService.createSession).toHaveBeenCalledWith('agent-1', {})
    expect(adapter.sendMessage).toHaveBeenCalledWith('chat-1', 'New session created.')
  })

  it('handleCommand /compact sends /compact as message content', async () => {
    const adapter = createMockAdapter()
    const session = { id: 'session-1', agent_id: 'agent-1', agent_type: 'cherry-claw' }

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
      expect.any(AbortController)
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
  })

  it('resolveSession tracks sessions after /new', async () => {
    const adapter = createMockAdapter()
    const newSession = { id: 'new-session', agent_id: 'agent-1', agent_type: 'cherry-claw' }

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

    await channelMessageHandler.handleIncoming(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'test'
    })

    expect(sessionService.getSession).toHaveBeenCalledWith('agent-1', 'new-session')
  })

  it('clearSessionTracker causes fresh session resolution', async () => {
    const adapter = createMockAdapter()
    const session1 = { id: 'session-1', agent_id: 'agent-1', agent_type: 'cherry-claw' }
    const session2 = { id: 'session-2', agent_id: 'agent-1', agent_type: 'cherry-claw' }

    // First interaction creates a session
    vi.mocked(sessionService.createSession).mockResolvedValueOnce(session1 as any)
    vi.mocked(sessionMessageService.createSessionMessage).mockResolvedValueOnce(
      createMockStream([{ type: 'text-delta', text: 'R1' }]) as any
    )

    await channelMessageHandler.handleIncoming(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'msg1'
    })

    // Clear session tracker
    channelMessageHandler.clearSessionTracker('agent-1')

    // Next interaction should resolve from scratch — listSessions returns session2
    vi.mocked(sessionService.listSessions).mockResolvedValueOnce({
      sessions: [session2] as any[],
      total: 1
    })
    vi.mocked(sessionService.getSession).mockResolvedValueOnce(session2 as any)
    vi.mocked(sessionMessageService.createSessionMessage).mockResolvedValueOnce(
      createMockStream([{ type: 'text-delta', text: 'R2' }]) as any
    )

    await channelMessageHandler.handleIncoming(adapter, {
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      text: 'msg2'
    })

    expect(sessionService.listSessions).toHaveBeenCalledWith('agent-1', { limit: 1 })
    expect(sessionService.getSession).toHaveBeenCalledWith('agent-1', 'session-2')
  })
})
