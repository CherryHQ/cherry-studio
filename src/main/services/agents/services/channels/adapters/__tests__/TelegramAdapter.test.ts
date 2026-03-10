import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

// Mock registerAdapterFactory to capture the factory function
vi.mock('../../ChannelManager', () => ({
  registerAdapterFactory: vi.fn()
}))

const mockBot = {
  use: vi.fn(),
  command: vi.fn(),
  on: vi.fn(),
  api: {
    setMyCommands: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendMessageDraft: vi.fn().mockResolvedValue(true),
    sendChatAction: vi.fn().mockResolvedValue(undefined)
  },
  catch: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined)
}

vi.mock('grammy', () => ({
  Bot: vi.fn().mockImplementation(() => mockBot)
}))

// Import the module to trigger self-registration side effect
import '../TelegramAdapter'

import { registerAdapterFactory } from '../../ChannelManager'

function getFactory() {
  const call = vi.mocked(registerAdapterFactory).mock.calls[0]
  if (!call) throw new Error('registerAdapterFactory was not called')
  return call[1] as (channel: any, agentId: string) => any
}

describe('TelegramAdapter', () => {
  beforeEach(() => {
    // Reset all mock functions but preserve the factory registration
    mockBot.use.mockClear()
    mockBot.command.mockClear()
    mockBot.on.mockClear()
    mockBot.api.setMyCommands.mockClear().mockResolvedValue(undefined)
    mockBot.api.sendMessage.mockClear().mockResolvedValue(undefined)
    mockBot.api.sendMessageDraft.mockClear().mockResolvedValue(true)
    mockBot.api.sendChatAction.mockClear().mockResolvedValue(undefined)
    mockBot.catch.mockClear()
    mockBot.start.mockClear().mockResolvedValue(undefined)
    mockBot.stop.mockClear().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createAdapter(overrides: Record<string, unknown> = {}) {
    const factory = getFactory()
    return factory(
      {
        id: (overrides.channelId as string) ?? 'ch-1',
        type: 'telegram',
        enabled: true,
        config: {
          bot_token: (overrides.bot_token as string) ?? 'test-token',
          allowed_chat_ids: (overrides.allowed_chat_ids as string[]) ?? ['123']
        }
      },
      (overrides.agentId as string) ?? 'agent-1'
    )
  }

  it('connect() registers middleware, commands, message handler, and starts polling', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    expect(mockBot.use).toHaveBeenCalledTimes(1) // auth middleware
    expect(mockBot.command).toHaveBeenCalledTimes(3) // new, compact, help
    expect(mockBot.on).toHaveBeenCalledWith('message:text', expect.any(Function))
    expect(mockBot.api.setMyCommands).toHaveBeenCalledWith([
      { command: 'new', description: 'Start a new conversation' },
      { command: 'compact', description: 'Compact conversation history' },
      { command: 'help', description: 'Show help information' }
    ])
    expect(mockBot.catch).toHaveBeenCalledTimes(1)
    expect(mockBot.start).toHaveBeenCalledTimes(1)
  })

  it('disconnect() stops the bot', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.disconnect()

    expect(mockBot.stop).toHaveBeenCalledTimes(1)
  })

  it('sendMessage() sends text via bot API', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.sendMessage('123', 'Hello')

    expect(mockBot.api.sendMessage).toHaveBeenCalledWith('123', 'Hello', {})
  })

  it('sendMessage() chunks long messages', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    await adapter.connect()

    const longText = 'A'.repeat(5000)
    const sendPromise = adapter.sendMessage('123', longText)

    // Flush all pending timers (inter-chunk delays) regardless of count
    await vi.runAllTimersAsync()
    await sendPromise

    expect(mockBot.api.sendMessage).toHaveBeenCalledTimes(2)
    // Verify chunk sizes: first chunk is 4096 chars, second is the remainder
    expect(mockBot.api.sendMessage.mock.calls[0][1]).toHaveLength(4096)
    expect(mockBot.api.sendMessage.mock.calls[1][1]).toHaveLength(904)
  })

  it('sendTypingIndicator() sends typing action', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.sendTypingIndicator('123')

    expect(mockBot.api.sendChatAction).toHaveBeenCalledWith('123', 'typing')
  })

  it('auth middleware blocks unauthorized chats', async () => {
    const adapter = createAdapter({ allowed_chat_ids: ['123'] })
    await adapter.connect()

    // Extract the auth middleware
    const middleware = mockBot.use.mock.calls[0][0] as (ctx: any, next: () => Promise<void>) => Promise<void>

    const next = vi.fn()

    // Unauthorized chat
    await middleware({ chat: { id: 999 } }, next)
    expect(next).not.toHaveBeenCalled()

    // Authorized chat
    next.mockClear()
    await middleware({ chat: { id: 123 } }, next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('command handler emits command events', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const commandSpy = vi.fn()
    adapter.on('command', commandSpy)

    // Find the 'new' command handler (first bot.command call)
    const commandHandler = mockBot.command.mock.calls[0][1] as (ctx: any) => void

    commandHandler({
      chat: { id: 123 },
      from: { id: 456, first_name: 'TestUser' }
    })

    expect(commandSpy).toHaveBeenCalledWith({
      chatId: '123',
      userId: '456',
      userName: 'TestUser',
      command: 'new'
    })
  })

  it('message handler emits message events', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    // Extract the message:text handler
    const messageHandler = mockBot.on.mock.calls[0][1] as (ctx: any) => void

    messageHandler({
      chat: { id: 123 },
      from: { id: 456, first_name: 'TestUser' },
      message: { text: 'Hello bot' }
    })

    expect(messageSpy).toHaveBeenCalledWith({
      chatId: '123',
      userId: '456',
      userName: 'TestUser',
      text: 'Hello bot'
    })
  })
})
