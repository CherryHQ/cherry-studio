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
  app: { getPath: () => '/mock/userData' },
  nativeTheme: { themeSource: '', shouldUseDarkColors: false },
  net: { fetch: vi.fn() }
}))

vi.mock('../../../../../WindowService', () => ({
  windowService: {
    getMainWindow: () => null
  }
}))

const mockImCreate = vi.fn().mockResolvedValue({ code: 0, data: { message_id: 'msg-1' } })
const mockImUpdate = vi.fn().mockResolvedValue({ code: 0 })
const mockCardCreate = vi.fn().mockResolvedValue({ code: 0, data: { card_id: 'card-1' } })
const mockCardSettings = vi.fn().mockResolvedValue({ code: 0 })
const mockCardUpdate = vi.fn().mockResolvedValue({ code: 0 })
const mockElementContent = vi.fn().mockResolvedValue({ code: 0 })
const mockMessageResourceGet = vi.fn()
const mockReactionCreate = vi.fn().mockResolvedValue({ code: 0, data: { reaction_id: 'rx-1' } })
const mockReactionDelete = vi.fn().mockResolvedValue({ code: 0 })

const mockClient = {
  im: {
    message: {
      create: mockImCreate,
      update: mockImUpdate
    },
    messageResource: {
      get: mockMessageResourceGet
    },
    messageReaction: {
      create: mockReactionCreate,
      delete: mockReactionDelete
    }
  },
  cardkit: {
    v1: {
      card: { create: mockCardCreate, settings: mockCardSettings, update: mockCardUpdate },
      cardElement: { content: mockElementContent }
    }
  }
}

const mockWsStart = vi.fn().mockResolvedValue(undefined)
let capturedEventHandlers: Record<string, (...args: unknown[]) => unknown> = {}

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: vi.fn().mockImplementation(() => mockClient),
  WSClient: vi.fn().mockImplementation(() => ({ start: mockWsStart })),
  EventDispatcher: vi.fn().mockImplementation(() => ({
    register: vi.fn().mockImplementation((handles: Record<string, (...args: unknown[]) => unknown>) => {
      capturedEventHandlers = handles
      return {}
    })
  })),
  AppType: { SelfBuild: 0 },
  Domain: { Feishu: 'https://open.feishu.cn', Lark: 'https://open.larksuite.com' },
  LoggerLevel: { warn: 2 }
}))

import '../feishu/FeishuAdapter'

import { registerAdapterFactory } from '../../ChannelManager'

function getFactory() {
  const calls = vi.mocked(registerAdapterFactory).mock.calls
  const feishuCall = calls.find((c) => c[0] === 'feishu')
  if (!feishuCall) throw new Error('registerAdapterFactory was not called for feishu')
  return feishuCall[1] as (channel: any, agentId: string) => any
}

describe('FeishuAdapter', () => {
  beforeEach(() => {
    mockImCreate.mockClear().mockResolvedValue({ code: 0, data: { message_id: 'msg-1' } })
    mockImUpdate.mockClear().mockResolvedValue({ code: 0 })
    mockCardCreate.mockClear().mockResolvedValue({ code: 0, data: { card_id: 'card-1' } })
    mockCardSettings.mockClear().mockResolvedValue({ code: 0 })
    mockCardUpdate.mockClear().mockResolvedValue({ code: 0 })
    mockElementContent.mockClear().mockResolvedValue({ code: 0 })
    mockMessageResourceGet.mockReset()
    mockReactionCreate.mockClear().mockResolvedValue({ code: 0, data: { reaction_id: 'rx-1' } })
    mockReactionDelete.mockClear().mockResolvedValue({ code: 0 })
    mockWsStart.mockClear().mockResolvedValue(undefined)
    capturedEventHandlers = {}
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createAdapter(overrides: Record<string, unknown> = {}) {
    const factory = getFactory()
    return factory(
      {
        id: (overrides.channelId as string) ?? 'ch-1',
        type: 'feishu',
        enabled: true,
        config: {
          app_id: (overrides.app_id as string) ?? 'test-app-id',
          app_secret: (overrides.app_secret as string) ?? 'test-app-secret',
          allowed_chat_ids: (overrides.allowed_chat_ids as string[]) ?? ['oc_123'],
          domain: (overrides.domain as string) ?? 'feishu'
        }
      },
      (overrides.agentId as string) ?? 'agent-1'
    )
  }

  it('connect() creates client, event dispatcher, and starts WebSocket', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    expect(mockWsStart).toHaveBeenCalledWith({ eventDispatcher: expect.anything() })
  })

  it('connect() with missing app_id starts background registration instead of WebSocket', async () => {
    const adapter = createAdapter({ app_id: '' })
    await adapter.connect()
    // checkReady() returns false → performConnect runs in background,
    // starts registration flow instead of WebSocket
    expect(mockWsStart).not.toHaveBeenCalled()
  })

  it('sendMessage() sends post-type message via SDK', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.sendMessage('oc_123', 'Hello Feishu')

    expect(mockImCreate).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'oc_123',
        msg_type: 'post',
        content: expect.stringContaining('Hello Feishu')
      }
    })

    // Verify it's a proper post payload with md tag
    const content = JSON.parse(mockImCreate.mock.calls[0][0].data.content)
    expect(content.zh_cn.content[0][0]).toEqual({ tag: 'md', text: 'Hello Feishu' })
  })

  it('sendMessage() chunks long messages', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    await adapter.connect()

    const longText = 'A'.repeat(5000)
    const sendPromise = adapter.sendMessage('oc_123', longText)

    await vi.runAllTimersAsync()
    await sendPromise

    expect(mockImCreate).toHaveBeenCalledTimes(2)
  })

  it('sendMessage() throws when Feishu returns an API error', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    mockImCreate.mockResolvedValueOnce({ code: 99991663, msg: 'permission denied' })

    await expect(adapter.sendMessage('oc_123', 'Hello Feishu')).rejects.toThrow(
      'Send Feishu message failed: permission denied'
    )
  })

  it('onTextUpdate() creates streaming card and updates content via CardKit', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    await adapter.connect()

    await adapter.onTextUpdate('oc_123', 'partial text...')

    // Card is created eagerly (before throttle)
    expect(mockCardCreate).toHaveBeenCalledWith({
      data: {
        type: 'card_json',
        data: expect.stringContaining('streaming_mode')
      }
    })

    expect(mockImCreate).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'oc_123',
        msg_type: 'interactive',
        content: expect.stringContaining('card-1')
      }
    })

    // Flush is deferred (long-gap batching) — advance timers to trigger it
    await vi.advanceTimersByTimeAsync(500)

    expect(mockElementContent).toHaveBeenCalledWith({
      path: { card_id: 'card-1', element_id: 'streaming_content' },
      data: {
        content: 'partial text...',
        sequence: expect.any(Number)
      }
    })
  })

  it('onStreamComplete() closes streaming mode and returns true', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    await adapter.connect()

    await adapter.onTextUpdate('oc_123', 'partial text...')
    // Advance past the long-gap batch delay so the flush completes
    await vi.advanceTimersByTimeAsync(500)

    await expect(adapter.onStreamComplete('oc_123', 'final text')).resolves.toBe(true)

    expect(mockCardSettings).toHaveBeenCalledWith({
      path: { card_id: 'card-1' },
      data: {
        settings: expect.stringContaining('streaming_mode'),
        sequence: expect.any(Number)
      }
    })
  })

  it('sendTypingIndicator() is a no-op when no user message has been seen', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.sendTypingIndicator('oc_123')
    expect(mockReactionCreate).not.toHaveBeenCalled()
  })

  async function deliverIncomingTextMessage(messageId = 'msg-in-1', chatId = 'oc_123') {
    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: messageId,
        chat_id: chatId,
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: 'Hello agent' })
      }
    })
  }

  it('sendTypingIndicator() reacts to the latest user message with INHALE and is idempotent', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    await deliverIncomingTextMessage()

    await adapter.sendTypingIndicator('oc_123')
    await adapter.sendTypingIndicator('oc_123')

    expect(mockReactionCreate).toHaveBeenCalledTimes(1)
    expect(mockReactionCreate).toHaveBeenCalledWith({
      path: { message_id: 'msg-in-1' },
      data: { reaction_type: { emoji_type: 'THINKING' } }
    })
  })

  it('sendMessage() promotes the typing reaction from INHALE to OK_HAND', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    await deliverIncomingTextMessage()
    mockReactionCreate.mockResolvedValueOnce({ code: 0, data: { reaction_id: 'rx-thinking' } })
    await adapter.sendTypingIndicator('oc_123')

    mockReactionCreate.mockResolvedValueOnce({ code: 0, data: { reaction_id: 'rx-done' } })
    await adapter.sendMessage('oc_123', 'reply')

    expect(mockReactionDelete).toHaveBeenCalledWith({
      path: { message_id: 'msg-in-1', reaction_id: 'rx-thinking' }
    })
    expect(mockReactionCreate).toHaveBeenLastCalledWith({
      path: { message_id: 'msg-in-1' },
      data: { reaction_type: { emoji_type: 'OK' } }
    })
  })

  it('sendMessage() does not add OK_HAND when there was no prior typing reaction', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    // /new style ack — no incoming user message tracked, no typing indicator first
    await adapter.sendMessage('oc_123', 'New session created.')

    expect(mockReactionCreate).not.toHaveBeenCalled()
    expect(mockReactionDelete).not.toHaveBeenCalled()
  })

  it('onStreamError() swaps the reaction to CRY', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    await deliverIncomingTextMessage()
    mockReactionCreate.mockResolvedValueOnce({ code: 0, data: { reaction_id: 'rx-thinking' } })
    await adapter.sendTypingIndicator('oc_123')

    mockReactionCreate.mockResolvedValueOnce({ code: 0, data: { reaction_id: 'rx-error' } })
    await adapter.onStreamError('oc_123', 'boom')

    expect(mockReactionDelete).toHaveBeenCalledWith({
      path: { message_id: 'msg-in-1', reaction_id: 'rx-thinking' }
    })
    expect(mockReactionCreate).toHaveBeenLastCalledWith({
      path: { message_id: 'msg-in-1' },
      data: { reaction_type: { emoji_type: 'CRY' } }
    })
  })

  it('handles incoming text messages and emits message event', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    const handler = capturedEventHandlers['im.message.receive_v1']
    expect(handler).toBeDefined()

    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-in-1',
        chat_id: 'oc_123',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: 'Hello agent' })
      }
    })

    expect(messageSpy).toHaveBeenCalledWith({
      chatId: 'oc_123',
      userId: 'ou_user1',
      userName: '',
      text: 'Hello agent'
    })
  })

  it('handles slash commands from text messages', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const commandSpy = vi.fn()
    adapter.on('command', commandSpy)

    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-cmd-1',
        chat_id: 'oc_123',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: '/new' })
      }
    })

    expect(commandSpy).toHaveBeenCalledWith({
      chatId: 'oc_123',
      userId: 'ou_user1',
      userName: '',
      command: 'new',
      args: undefined
    })
  })

  it('handles /whoami from text messages', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const commandSpy = vi.fn()
    adapter.on('command', commandSpy)

    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-cmd-2',
        chat_id: 'oc_123',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: '/whoami' })
      }
    })

    expect(commandSpy).toHaveBeenCalledWith({
      chatId: 'oc_123',
      userId: 'ou_user1',
      userName: '',
      command: 'whoami',
      args: undefined
    })
  })

  it('auth guard blocks unauthorized chat IDs', async () => {
    const adapter = createAdapter({ allowed_chat_ids: ['oc_123'] })
    await adapter.connect()

    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-blocked',
        chat_id: 'oc_unauthorized',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: 'Should be blocked' })
      }
    })

    expect(messageSpy).not.toHaveBeenCalled()
  })

  it('strips @mention tags from group messages', async () => {
    const adapter = createAdapter({ allowed_chat_ids: [] })
    await adapter.connect()

    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-mention',
        chat_id: 'oc_group1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: '@_user_1 Hello agent' })
      }
    })

    expect(messageSpy).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello agent' }))
  })

  it('handles incoming image messages and emits message event with attachment', async () => {
    const adapter = createAdapter({ allowed_chat_ids: [] })
    await adapter.connect()

    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03])
    mockMessageResourceGet.mockResolvedValue({
      getReadableStream: () => {
        const { Readable } = require('node:stream')
        return Readable.from([pngBuffer])
      },
      headers: { 'content-type': 'image/png' }
    })

    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-image',
        chat_id: 'oc_123',
        chat_type: 'p2p',
        message_type: 'image',
        content: JSON.stringify({ image_key: 'img_abc' })
      }
    })

    // Downloader is fire-and-forget — flush microtasks
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockMessageResourceGet).toHaveBeenCalledWith({
      params: { type: 'image' },
      path: { message_id: 'msg-image', file_key: 'img_abc' }
    })
    expect(messageSpy).toHaveBeenCalledWith({
      chatId: 'oc_123',
      userId: 'ou_user1',
      userName: '',
      text: '',
      images: [
        {
          data: pngBuffer.toString('base64'),
          media_type: 'image/png'
        }
      ]
    })
  })

  it('emits fallback message when image content has no image_key', async () => {
    const adapter = createAdapter({ allowed_chat_ids: [] })
    await adapter.connect()

    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-image-bad',
        chat_id: 'oc_123',
        chat_type: 'p2p',
        message_type: 'image',
        content: '{}'
      }
    })

    expect(mockMessageResourceGet).not.toHaveBeenCalled()
    expect(messageSpy).not.toHaveBeenCalled()
  })

  it('ignores unsupported message types (e.g. sticker)', async () => {
    const adapter = createAdapter({ allowed_chat_ids: [] })
    await adapter.connect()

    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-sticker',
        chat_id: 'oc_123',
        chat_type: 'p2p',
        message_type: 'sticker',
        content: '{}'
      }
    })

    expect(messageSpy).not.toHaveBeenCalled()
  })

  it('sets notifyChatIds from allowed_chat_ids', () => {
    const adapter = createAdapter({ allowed_chat_ids: ['oc_a', 'oc_b'] })
    expect(adapter.notifyChatIds).toEqual(['oc_a', 'oc_b'])
  })
})
