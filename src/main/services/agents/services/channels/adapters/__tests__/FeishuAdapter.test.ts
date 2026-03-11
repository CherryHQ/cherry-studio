import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../../ChannelManager', () => ({
  registerAdapterFactory: vi.fn()
}))

const mockCreate = vi.fn().mockResolvedValue({ data: { message_id: 'msg-1' } })
const mockUpdate = vi.fn().mockResolvedValue({})
const mockClient = {
  im: {
    message: {
      create: mockCreate,
      update: mockUpdate
    }
  }
}

const mockWsStart = vi.fn().mockResolvedValue(undefined)
let capturedEventHandlers: Record<string, Function> = {}

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: vi.fn().mockImplementation(() => mockClient),
  WSClient: vi.fn().mockImplementation(() => ({ start: mockWsStart })),
  EventDispatcher: vi.fn().mockImplementation(() => ({
    register: vi.fn().mockImplementation((handles: Record<string, Function>) => {
      capturedEventHandlers = handles
      return {}
    })
  })),
  AppType: { SelfBuild: 0 },
  Domain: { Feishu: 'https://open.feishu.cn', Lark: 'https://open.larksuite.com' },
  LoggerLevel: { warn: 2 }
}))

// Mock global fetch for streaming card + tenant token APIs
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import '../FeishuAdapter'

import { registerAdapterFactory } from '../../ChannelManager'

function getFactory() {
  const calls = vi.mocked(registerAdapterFactory).mock.calls
  const feishuCall = calls.find((c) => c[0] === 'feishu')
  if (!feishuCall) throw new Error('registerAdapterFactory was not called for feishu')
  return feishuCall[1] as (channel: any, agentId: string) => any
}

describe('FeishuAdapter', () => {
  beforeEach(() => {
    mockCreate.mockClear().mockResolvedValue({ data: { message_id: 'msg-1' } })
    mockUpdate.mockClear().mockResolvedValue({})
    mockWsStart.mockClear().mockResolvedValue(undefined)
    mockFetch.mockClear()
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

  it('connect() throws if app_id is missing', async () => {
    const adapter = createAdapter({ app_id: '' })
    await expect(adapter.connect()).rejects.toThrow('Feishu app_id and app_secret are required')
  })

  it('sendMessage() sends post-type message via SDK', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.sendMessage('oc_123', 'Hello Feishu')

    expect(mockCreate).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'oc_123',
        msg_type: 'post',
        content: expect.stringContaining('Hello Feishu')
      }
    })

    // Verify it's a proper post payload with md tag
    const content = JSON.parse(mockCreate.mock.calls[0][0].data.content)
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

    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('sendTypingIndicator() is a no-op (Feishu has no native typing API)', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    // Should not throw
    await adapter.sendTypingIndicator('oc_123')
  })

  it('handles incoming text messages and emits message event', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    // Simulate an incoming message via the captured event handler
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
    const adapter = createAdapter({ allowed_chat_ids: [] }) // allow all
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

  it('ignores non-text message types', async () => {
    const adapter = createAdapter({ allowed_chat_ids: [] })
    await adapter.connect()

    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-image',
        chat_id: 'oc_123',
        chat_type: 'p2p',
        message_type: 'image',
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
