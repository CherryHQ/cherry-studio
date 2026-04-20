import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../../ChannelManager', () => ({
  registerAdapterFactory: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => '/mock/userData'
  }
}))

vi.mock('../../../../../WindowService', () => ({
  windowService: {
    getMainWindow: () => null
  }
}))

let messageHandler: ((msg: any) => void | Promise<void>) | null = null

const mockBot = {
  hasCredentials: vi.fn().mockResolvedValue(true),
  login: vi.fn().mockResolvedValue({ userId: 'test-user' }),
  onMessage: vi.fn().mockImplementation((handler: any) => {
    messageHandler = handler
    return mockBot
  }),
  run: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
  send: vi.fn().mockResolvedValue(undefined),
  reply: vi.fn().mockResolvedValue(undefined),
  sendTyping: vi.fn().mockResolvedValue(undefined),
  stopTyping: vi.fn().mockResolvedValue(undefined)
}

vi.mock('../wechat/WeChatProtocol', () => ({
  WeixinBot: vi.fn().mockImplementation(() => mockBot)
}))

// Import the module to trigger self-registration side effect
import '../wechat/WeChatAdapter'

import { registerAdapterFactory } from '../../ChannelManager'

function getFactory() {
  const call = vi.mocked(registerAdapterFactory).mock.calls.find((c) => c[0] === 'wechat')
  if (!call) throw new Error('registerAdapterFactory was not called for wechat')
  return call[1] as (channel: any, agentId: string) => any
}

describe('WeChatAdapter', () => {
  beforeEach(() => {
    messageHandler = null
    mockBot.hasCredentials.mockClear().mockResolvedValue(true)
    mockBot.login.mockClear().mockResolvedValue({ userId: 'test-user' })
    mockBot.onMessage.mockClear().mockImplementation((handler: any) => {
      messageHandler = handler
      return mockBot
    })
    mockBot.run.mockClear().mockResolvedValue(undefined)
    mockBot.stop.mockClear()
    mockBot.send.mockClear().mockResolvedValue(undefined)
    mockBot.reply.mockClear().mockResolvedValue(undefined)
    mockBot.sendTyping.mockClear().mockResolvedValue(undefined)
    mockBot.stopTyping.mockClear().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createAdapter(overrides: Record<string, unknown> = {}) {
    const factory = getFactory()
    return factory(
      {
        id: (overrides.channelId as string) ?? 'ch-1',
        type: 'wechat',
        enabled: true,
        config: {
          token_path: (overrides.token_path as string) ?? '',
          allowed_chat_ids: (overrides.allowed_chat_ids as string[]) ?? []
        }
      },
      (overrides.agentId as string) ?? 'agent-1'
    )
  }

  it('connect() logs in, registers message handler, and starts polling', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    expect(mockBot.login).toHaveBeenCalledTimes(1)
    expect(mockBot.onMessage).toHaveBeenCalledTimes(1)
    expect(mockBot.run).toHaveBeenCalledTimes(1)
  })

  it('disconnect() stops the bot', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.disconnect()

    expect(mockBot.stop).toHaveBeenCalledTimes(1)
  })

  it('sendMessage() sends text via bot.send()', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.sendMessage('user-123', 'Hello')

    expect(mockBot.send).toHaveBeenCalledWith('user-123', 'Hello')
  })

  it('sendMessage() chunks long messages', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    await adapter.connect()

    const longText = 'A'.repeat(3000)
    const sendPromise = adapter.sendMessage('user-123', longText)

    await vi.runAllTimersAsync()
    await sendPromise

    expect(mockBot.send).toHaveBeenCalledTimes(2)
    expect(mockBot.send.mock.calls[0][1]).toHaveLength(2000)
    expect(mockBot.send.mock.calls[1][1]).toHaveLength(1000)
  })

  it('sendTypingIndicator() calls bot.sendTyping()', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.sendTypingIndicator('user-123')

    expect(mockBot.sendTyping).toHaveBeenCalledWith('user-123')
  })

  it('message handler emits message events', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    await messageHandler!({
      userId: 'user-123',
      text: 'Hello bot',
      _contextToken: 'ctx-1'
    })

    expect(messageSpy).toHaveBeenCalledWith({
      chatId: 'user-123',
      userId: 'user-123',
      userName: 'user-123',
      text: 'Hello bot'
    })
  })

  it('message handler emits command events for /new', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const commandSpy = vi.fn()
    adapter.on('command', commandSpy)

    await messageHandler!({
      userId: 'user-123',
      text: '/new',
      _contextToken: 'ctx-1'
    })

    expect(commandSpy).toHaveBeenCalledWith({
      chatId: 'user-123',
      userId: 'user-123',
      userName: 'user-123',
      command: 'new'
    })
  })

  it('message handler filters unauthorized users when allowed_chat_ids is set', async () => {
    const adapter = createAdapter({ allowed_chat_ids: ['allowed-user'] })
    await adapter.connect()

    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    await messageHandler!({
      userId: 'unauthorized-user',
      text: 'Hello',
      _contextToken: 'ctx-1'
    })

    expect(messageSpy).not.toHaveBeenCalled()
  })

  it('message handler allows authorized users when allowed_chat_ids is set', async () => {
    const adapter = createAdapter({ allowed_chat_ids: ['allowed-user'] })
    await adapter.connect()

    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    await messageHandler!({
      userId: 'allowed-user',
      text: 'Hello',
      _contextToken: 'ctx-1'
    })

    expect(messageSpy).toHaveBeenCalledTimes(1)
  })

  it('/whoami command replies with user info', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const commandSpy = vi.fn()
    adapter.on('command', commandSpy)

    const msg = {
      userId: 'user-123',
      text: '/whoami',
      _contextToken: 'ctx-1'
    }
    await messageHandler!(msg)

    // /whoami should reply directly, not emit command
    expect(commandSpy).not.toHaveBeenCalled()
    expect(mockBot.reply).toHaveBeenCalledTimes(1)
    expect(mockBot.reply.mock.calls[0][1]).toContain('user-123')
  })
})
