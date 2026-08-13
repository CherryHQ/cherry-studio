import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const registrationMocks = vi.hoisted(() => ({
  begin: vi.fn(),
  poll: vi.fn()
}))

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

vi.mock('../../../../../MainWindowService', () => ({
  windowService: {
    getMainWindow: () => null
  }
}))

vi.mock('../feishu/FeishuAppRegistration', () => ({
  registrationBegin: registrationMocks.begin,
  registrationPoll: registrationMocks.poll
}))

const mockImCreate = vi.fn().mockResolvedValue({ code: 0, data: { message_id: 'msg-1' } })
const mockImReply = vi.fn().mockResolvedValue({ code: 0, data: { message_id: 'reply-1' } })
const mockImUpdate = vi.fn().mockResolvedValue({ code: 0 })
const mockCardCreate = vi.fn().mockResolvedValue({ code: 0, data: { card_id: 'card-1' } })
const mockCardSettings = vi.fn().mockResolvedValue({ code: 0 })
const mockCardUpdate = vi.fn().mockResolvedValue({ code: 0 })
const mockElementContent = vi.fn().mockResolvedValue({ code: 0 })
const mockMessageResourceGet = vi.fn()
const mockReactionCreate = vi.fn().mockResolvedValue({ code: 0, data: { reaction_id: 'rx-1' } })
const mockReactionDelete = vi.fn().mockResolvedValue({ code: 0 })
// The SDK unwraps upload responses to the inner data object (not a {code,data} envelope).
const mockFileCreate = vi.fn().mockResolvedValue({ file_key: 'file-1' })
const mockImageCreate = vi.fn().mockResolvedValue({ image_key: 'img-1' })
const mockClientRequest = vi.fn().mockResolvedValue({
  code: 0,
  bot: { app_name: 'Cherry Bot', open_id: 'ou_bot' }
})

const mockClient = {
  request: mockClientRequest,
  im: {
    message: {
      create: mockImCreate,
      reply: mockImReply,
      update: mockImUpdate
    },
    file: {
      create: mockFileCreate
    },
    image: {
      create: mockImageCreate
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
const mockWsClose = vi.fn()
let autoWsHealthy = true
let capturedWsLoggers: Array<Record<string, (...args: unknown[]) => void>> = []
let capturedEventHandlers: Record<string, (...args: unknown[]) => unknown> = {}

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: vi.fn().mockImplementation(() => mockClient),
  WSClient: vi.fn().mockImplementation((options: { logger: Record<string, (...args: unknown[]) => void> }) => {
    capturedWsLoggers.push(options.logger)
    return {
      start: async (...args: unknown[]) => {
        await mockWsStart(...args)
        if (autoWsHealthy) {
          options.logger.debug(['[ws]', 'ws connect success'])
          options.logger.trace(['[ws]', 'receive pong'])
        }
      },
      close: mockWsClose
    }
  }),
  EventDispatcher: vi.fn().mockImplementation(() => ({
    register: vi.fn().mockImplementation((handles: Record<string, (...args: unknown[]) => unknown>) => {
      capturedEventHandlers = handles
      return {}
    })
  })),
  AppType: { SelfBuild: 0 },
  Domain: { Feishu: 'https://open.feishu.cn', Lark: 'https://open.larksuite.com' },
  LoggerLevel: { warn: 2, trace: 5 }
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
    mockImReply.mockClear().mockResolvedValue({ code: 0, data: { message_id: 'reply-1' } })
    mockImUpdate.mockClear().mockResolvedValue({ code: 0 })
    mockCardCreate.mockClear().mockResolvedValue({ code: 0, data: { card_id: 'card-1' } })
    mockCardSettings.mockClear().mockResolvedValue({ code: 0 })
    mockCardUpdate.mockClear().mockResolvedValue({ code: 0 })
    mockElementContent.mockClear().mockResolvedValue({ code: 0 })
    mockMessageResourceGet.mockReset()
    mockReactionCreate.mockClear().mockResolvedValue({ code: 0, data: { reaction_id: 'rx-1' } })
    mockReactionDelete.mockClear().mockResolvedValue({ code: 0 })
    mockFileCreate.mockClear().mockResolvedValue({ file_key: 'file-1' })
    mockImageCreate.mockClear().mockResolvedValue({ image_key: 'img-1' })
    mockClientRequest.mockClear().mockResolvedValue({
      code: 0,
      bot: { app_name: 'Cherry Bot', open_id: 'ou_bot' }
    })
    mockWsStart.mockClear().mockResolvedValue(undefined)
    mockWsClose.mockClear()
    autoWsHealthy = true
    capturedWsLoggers = []
    registrationMocks.begin.mockReset().mockRejectedValue(new Error('Registration unavailable'))
    registrationMocks.poll.mockReset()
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

  it('reports connected only after the WebSocket proves liveness', async () => {
    autoWsHealthy = false
    const adapter = createAdapter()
    const statusSpy = vi.fn()
    adapter.on('statusChange', statusSpy)

    await adapter.connect()

    expect(adapter.connected).toBe(false)
    expect(statusSpy).toHaveBeenLastCalledWith({ channelId: 'ch-1', connected: false, state: 'connecting' })

    capturedWsLoggers[0].debug(['[ws]', 'ws connect success'])
    expect(adapter.connected).toBe(false)

    capturedWsLoggers[0].trace(['[ws]', 'receive pong'])
    expect(adapter.connected).toBe(true)
    expect(statusSpy).toHaveBeenLastCalledWith({ channelId: 'ch-1', connected: true, state: 'connected' })
  })

  it('reconnects with backoff when heartbeat activity becomes stale', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    const statusSpy = vi.fn()
    adapter.on('statusChange', statusSpy)
    await adapter.connect()

    await vi.advanceTimersByTimeAsync(330_000)

    expect(adapter.connected).toBe(false)
    expect(mockWsClose).toHaveBeenCalledWith({ force: true })
    expect(statusSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ connected: false, state: 'reconnecting', error: expect.stringContaining('stale') })
    )

    await vi.advanceTimersByTimeAsync(1_000)
    expect(mockWsStart).toHaveBeenCalledTimes(2)
    expect(capturedWsLoggers).toHaveLength(2)
    expect(adapter.connected).toBe(true)
  })

  it('ignores a late failure log from the previous WebSocket generation', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    const statusSpy = vi.fn()
    adapter.on('statusChange', statusSpy)
    await adapter.connect()

    const firstLogger = capturedWsLoggers[0]
    firstLogger.error(['[ws]', 'ws error'])
    expect(mockWsClose).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(capturedWsLoggers).toHaveLength(2)
    expect(adapter.connected).toBe(true)

    firstLogger.error(['[ws]', 'client closed'])

    expect(mockWsClose).toHaveBeenCalledTimes(1)
    expect(adapter.connected).toBe(true)
    expect(statusSpy).toHaveBeenLastCalledWith({ channelId: 'ch-1', connected: true, state: 'connected' })
  })

  it('connect() with missing app_id starts background registration instead of WebSocket', async () => {
    const adapter = createAdapter({ app_id: '' })
    await adapter.connect()
    // checkReady() returns false → performConnect runs in background,
    // starts registration flow instead of WebSocket
    expect(mockWsStart).not.toHaveBeenCalled()
  })

  it('emits a QR code and credentials when registration completes', async () => {
    registrationMocks.begin.mockResolvedValue({
      deviceCode: 'device-code',
      verificationUri: 'https://accounts.feishu.cn/device/qr',
      interval: 1,
      expiresIn: 600
    })
    registrationMocks.poll.mockResolvedValue({
      appId: 'new-app-id',
      appSecret: 'new-app-secret'
    })
    const adapter = createAdapter({ app_id: '', app_secret: '' })
    const onQr = vi.fn()
    const onCredentials = vi.fn()
    adapter.on('qr', onQr)
    adapter.on('credentials', onCredentials)

    await adapter.connect()

    await vi.waitFor(() => {
      expect(onQr).toHaveBeenCalledWith('https://accounts.feishu.cn/device/qr')
      expect(onCredentials).toHaveBeenCalledWith({
        appId: 'new-app-id',
        appSecret: 'new-app-secret'
      })
    })
  })

  it('does not emit a QR code when disconnected before registration begins', async () => {
    let resolveBegin!: (value: {
      deviceCode: string
      verificationUri: string
      interval: number
      expiresIn: number
    }) => void
    registrationMocks.begin.mockReturnValue(
      new Promise((resolve) => {
        resolveBegin = resolve
      })
    )
    const adapter = createAdapter({ app_id: '', app_secret: '' })
    const onQr = vi.fn()
    adapter.on('qr', onQr)

    await adapter.connect()
    await adapter.disconnect()
    resolveBegin({
      deviceCode: 'device-code',
      verificationUri: 'https://accounts.feishu.cn/device/qr',
      interval: 1,
      expiresIn: 600
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(onQr).not.toHaveBeenCalled()
    expect(registrationMocks.poll).not.toHaveBeenCalled()
  })

  it('does not emit credentials when disconnected during registration polling', async () => {
    let resolvePoll!: (value: { appId: string; appSecret: string }) => void
    registrationMocks.begin.mockResolvedValue({
      deviceCode: 'device-code',
      verificationUri: 'https://accounts.feishu.cn/device/qr',
      interval: 1,
      expiresIn: 600
    })
    registrationMocks.poll.mockReturnValue(
      new Promise((resolve) => {
        resolvePoll = resolve
      })
    )
    const adapter = createAdapter({ app_id: '', app_secret: '' })
    const onCredentials = vi.fn()
    adapter.on('credentials', onCredentials)

    await adapter.connect()
    await vi.waitFor(() => expect(registrationMocks.poll).toHaveBeenCalledOnce())
    await adapter.disconnect()
    resolvePoll({ appId: 'new-app-id', appSecret: 'new-app-secret' })
    await Promise.resolve()
    await Promise.resolve()

    expect(onCredentials).not.toHaveBeenCalled()
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

  it('sendMessage() replies against the inbound Feishu message when provided', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    await adapter.sendMessage('oc_123', 'Threaded reply', { replyToMessageId: 'msg-inbound' })

    expect(mockImReply).toHaveBeenCalledWith({
      path: { message_id: 'msg-inbound' },
      data: {
        msg_type: 'post',
        content: expect.stringContaining('Threaded reply')
      }
    })
    expect(mockImCreate).not.toHaveBeenCalled()
  })

  it('sendMessage() chunks long messages', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    await adapter.connect()

    const longText = 'A'.repeat(5000)
    const sendPromise = adapter.sendMessage('oc_123', longText)

    await vi.advanceTimersByTimeAsync(100)
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

  it('sendFile() uploads a generic file then posts a file message', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const data = Buffer.from('pdf-bytes').toString('base64')
    await adapter.sendFile('oc_123', {
      filename: 'report.pdf',
      data,
      media_type: 'application/pdf',
      size: 9
    })

    expect(mockFileCreate).toHaveBeenCalledWith({
      data: { file_type: 'stream', file_name: 'report.pdf', file: expect.any(Buffer) }
    })
    expect(mockImCreate).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: 'oc_123', msg_type: 'file', content: JSON.stringify({ file_key: 'file-1' }) }
    })
  })

  it('sendFile() uploads images via the image API and posts an image message', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    const data = Buffer.from('png-bytes').toString('base64')
    await adapter.sendFile('oc_123', { filename: 'chart.png', data, media_type: 'image/png', size: 9 })

    expect(mockImageCreate).toHaveBeenCalledWith({ data: { image_type: 'message', image: expect.any(Buffer) } })
    expect(mockFileCreate).not.toHaveBeenCalled()
    expect(mockImCreate).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: 'oc_123', msg_type: 'image', content: JSON.stringify({ image_key: 'img-1' }) }
    })
  })

  it('sendFile() throws when the upload returns no file_key', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    mockFileCreate.mockResolvedValueOnce(null)

    await expect(
      adapter.sendFile('oc_123', { filename: 'a.bin', data: '', media_type: 'application/octet-stream', size: 0 })
    ).rejects.toThrow('(no file_key)')
    expect(mockImCreate).not.toHaveBeenCalled()
  })

  it('sendFile() throws when the image upload returns no image_key', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    mockImageCreate.mockResolvedValueOnce(null)

    const data = Buffer.from('png-bytes').toString('base64')
    await expect(
      adapter.sendFile('oc_123', { filename: 'chart.png', data, media_type: 'image/png', size: 9 })
    ).rejects.toThrow('(no image_key)')
    expect(mockImCreate).not.toHaveBeenCalled()
  })

  it('sendFile() propagates a failure when the message post fails after a successful upload', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    mockImCreate.mockRejectedValueOnce(new Error('permission denied'))

    const data = Buffer.from('pdf-bytes').toString('base64')
    await expect(
      adapter.sendFile('oc_123', { filename: 'report.pdf', data, media_type: 'application/pdf', size: 9 })
    ).rejects.toThrow('permission denied')
    // Upload succeeded; the failure is on the message post, so the upload was still attempted.
    expect(mockFileCreate).toHaveBeenCalled()
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

  it('onTextUpdate() replies the streaming card to the inbound message', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    await adapter.onTextUpdate('oc_123', 'partial text...', { replyToMessageId: 'msg-inbound' })

    expect(mockImReply).toHaveBeenCalledWith({
      path: { message_id: 'msg-inbound' },
      data: {
        msg_type: 'interactive',
        content: expect.stringContaining('card-1')
      }
    })
    expect(mockImCreate).not.toHaveBeenCalled()
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

  it('isolates streaming cards and reply targets for two p2p senders sharing a chat', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    await adapter.connect()
    mockCardCreate
      .mockResolvedValueOnce({ code: 0, data: { card_id: 'card-user-1' } })
      .mockResolvedValueOnce({ code: 0, data: { card_id: 'card-user-2' } })

    await adapter.onTextUpdate('oc_123', 'first partial', {
      conversationKey: 'ou_user1',
      replyToMessageId: 'msg-user-1'
    })
    await adapter.onTextUpdate('oc_123', 'second partial', {
      conversationKey: 'ou_user2',
      replyToMessageId: 'msg-user-2'
    })

    expect(mockCardCreate).toHaveBeenCalledTimes(2)
    expect(mockImReply.mock.calls.map(([input]) => input.path.message_id)).toEqual(['msg-user-1', 'msg-user-2'])

    await vi.advanceTimersByTimeAsync(500)
    await adapter.onStreamComplete('oc_123', 'first final', { conversationKey: 'ou_user1' })
    await adapter.onStreamComplete('oc_123', 'second final', { conversationKey: 'ou_user2' })

    expect(mockCardSettings.mock.calls.map(([input]) => input.path.card_id)).toEqual(['card-user-1', 'card-user-2'])
  })

  it('sendTypingIndicator() is a no-op when no user message has been seen', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.sendTypingIndicator('oc_123')
    expect(mockReactionCreate).not.toHaveBeenCalled()
  })

  async function deliverIncomingTextMessage(messageId = 'msg-in-1', chatId = 'oc_123', openId = 'ou_user1') {
    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: openId } },
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

    await adapter.sendTypingIndicator('oc_123', { conversationKey: 'ou_user1' })
    await adapter.sendTypingIndicator('oc_123', { conversationKey: 'ou_user1' })

    expect(mockReactionCreate).toHaveBeenCalledTimes(1)
    expect(mockReactionCreate).toHaveBeenCalledWith({
      path: { message_id: 'msg-in-1' },
      data: { reaction_type: { emoji_type: 'Typing' } }
    })
  })

  it('isolates status reactions for two p2p senders sharing a chat', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await deliverIncomingTextMessage('msg-user-1', 'oc_123', 'ou_user1')
    await deliverIncomingTextMessage('msg-user-2', 'oc_123', 'ou_user2')
    mockReactionCreate
      .mockResolvedValueOnce({ code: 0, data: { reaction_id: 'rx-user-1' } })
      .mockResolvedValueOnce({ code: 0, data: { reaction_id: 'rx-user-2' } })

    await adapter.sendTypingIndicator('oc_123', { conversationKey: 'ou_user1' })
    await adapter.sendTypingIndicator('oc_123', { conversationKey: 'ou_user2' })

    expect(mockReactionCreate.mock.calls.map(([input]) => input.path.message_id)).toEqual(['msg-user-1', 'msg-user-2'])
  })

  it('sendMessage() promotes the typing reaction from INHALE to OK_HAND', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    await deliverIncomingTextMessage()
    mockReactionCreate.mockResolvedValueOnce({ code: 0, data: { reaction_id: 'rx-thinking' } })
    await adapter.sendTypingIndicator('oc_123', { conversationKey: 'ou_user1' })

    mockReactionCreate.mockResolvedValueOnce({ code: 0, data: { reaction_id: 'rx-done' } })
    await adapter.sendMessage('oc_123', 'reply', { conversationKey: 'ou_user1' })

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

  it('onStreamError() swaps the reaction to CRY and posts the error to chat', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    await deliverIncomingTextMessage()
    mockReactionCreate.mockResolvedValueOnce({ code: 0, data: { reaction_id: 'rx-thinking' } })
    await adapter.sendTypingIndicator('oc_123', { conversationKey: 'ou_user1' })

    mockReactionCreate.mockResolvedValueOnce({ code: 0, data: { reaction_id: 'rx-error' } })
    mockImCreate.mockClear()
    await adapter.onStreamError('oc_123', 'boom', { conversationKey: 'ou_user1' })

    expect(mockReactionDelete).toHaveBeenCalledWith({
      path: { message_id: 'msg-in-1', reaction_id: 'rx-thinking' }
    })
    expect(mockReactionCreate).toHaveBeenLastCalledWith({
      path: { message_id: 'msg-in-1' },
      data: { reaction_type: { emoji_type: 'CRY' } }
    })
    // No streaming controller exists, so the error must be sent as a plain message
    expect(mockImCreate).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'oc_123',
        msg_type: 'post',
        content: expect.stringContaining('boom')
      }
    })
  })

  it('onStreamError() defers to the streaming card when one exists (no extra message)', async () => {
    vi.useFakeTimers()
    const adapter = createAdapter()
    await adapter.connect()

    await deliverIncomingTextMessage()
    mockReactionCreate.mockResolvedValueOnce({ code: 0, data: { reaction_id: 'rx-thinking' } })
    await adapter.sendTypingIndicator('oc_123', { conversationKey: 'ou_user1' })
    await adapter.onTextUpdate('oc_123', 'partial...', { conversationKey: 'ou_user1' })
    await vi.advanceTimersByTimeAsync(500)

    mockImCreate.mockClear()
    mockReactionCreate.mockResolvedValueOnce({ code: 0, data: { reaction_id: 'rx-error' } })

    await adapter.onStreamError('oc_123', 'boom', { conversationKey: 'ou_user1' })

    // The streaming card displays the error; no plain "Error" message should be sent
    expect(mockImCreate).not.toHaveBeenCalled()
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
      text: 'Hello agent',
      conversationKey: 'ou_user1',
      messageId: 'msg-in-1'
    })
  })

  it('derives private conversation identity from each sender open_id', async () => {
    const adapter = createAdapter({ allowed_chat_ids: [] })
    await adapter.connect()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)
    const handler = capturedEventHandlers['im.message.receive_v1']

    for (const openId of ['ou_user1', 'ou_user2']) {
      await handler({
        sender: { sender_id: { open_id: openId } },
        message: {
          message_id: `msg-${openId}`,
          chat_id: 'oc_same_private_chat',
          chat_type: 'p2p',
          message_type: 'text',
          content: JSON.stringify({ text: 'Hello agent' })
        }
      })
    }

    expect(messageSpy.mock.calls.map(([message]) => message.conversationKey)).toEqual(['ou_user1', 'ou_user2'])
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
      args: undefined,
      conversationKey: 'ou_user1',
      messageId: 'msg-cmd-1'
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
      args: undefined,
      conversationKey: 'ou_user1',
      messageId: 'msg-cmd-2'
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

  it('admits another group member when they mention this bot and uses the group conversation', async () => {
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
        content: JSON.stringify({ text: '@_user_1 Hello agent' }),
        mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'Cherry Bot' }]
      }
    })

    expect(messageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello agent', conversationKey: 'oc_group1', userId: 'ou_user1' })
    )
  })

  it('ignores group messages that mention someone else even when the display name matches', async () => {
    const adapter = createAdapter({ allowed_chat_ids: [] })
    await adapter.connect()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-wrong-mention',
        chat_id: 'oc_group1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: '@_user_1 not for you' }),
        mentions: [{ key: '@_user_1', id: { open_id: 'ou_someone_else' }, name: 'Cherry Bot' }]
      }
    })

    expect(messageSpy).not.toHaveBeenCalled()
  })

  it('ignores unmentioned group messages', async () => {
    const adapter = createAdapter({ allowed_chat_ids: [] })
    await adapter.connect()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-no-mention',
        chat_id: 'oc_group1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'Hello everyone' })
      }
    })

    expect(messageSpy).not.toHaveBeenCalled()
  })

  it('checks @all only in the parsed text field', async () => {
    const adapter = createAdapter({ allowed_chat_ids: [] })
    await adapter.connect()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-json-decoy',
        chat_id: 'oc_group1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'Hello everyone', metadata: '@_all' })
      }
    })

    expect(messageSpy).not.toHaveBeenCalled()
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
      conversationKey: 'ou_user1',
      messageId: 'msg-image',
      images: [
        {
          data: pngBuffer.toString('base64'),
          media_type: 'image/png'
        }
      ]
    })
  })

  it('rejects a Feishu JSON error envelope instead of treating it as image bytes', async () => {
    const adapter = createAdapter({ allowed_chat_ids: [] })
    await adapter.connect()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)
    const errorBody = Buffer.from(JSON.stringify({ code: 234006, msg: 'resource expired' }))
    mockMessageResourceGet.mockResolvedValue({
      getReadableStream: () => {
        const { Readable } = require('node:stream')
        return Readable.from([errorBody])
      },
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })

    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-image-error',
        chat_id: 'oc_123',
        chat_type: 'p2p',
        message_type: 'image',
        content: JSON.stringify({ image_key: 'img_expired' })
      }
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(messageSpy).toHaveBeenCalledWith(expect.objectContaining({ text: '[Image — download failed]' }))
    expect(messageSpy.mock.calls[0][0]).not.toHaveProperty('images')
  })

  it('downloads incoming files and preserves reply and conversation identity', async () => {
    const adapter = createAdapter({ allowed_chat_ids: [] })
    await adapter.connect()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)
    const fileBuffer = Buffer.from('report contents')
    mockMessageResourceGet.mockResolvedValue({
      getReadableStream: () => {
        const { Readable } = require('node:stream')
        return Readable.from([fileBuffer])
      },
      headers: { 'content-type': 'application/octet-stream' }
    })

    const handler = capturedEventHandlers['im.message.receive_v1']
    await handler({
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: {
        message_id: 'msg-file',
        chat_id: 'oc_123',
        chat_type: 'p2p',
        message_type: 'file',
        content: JSON.stringify({ file_key: 'file_abc', file_name: 'report.txt' })
      }
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(messageSpy).toHaveBeenCalledWith({
      chatId: 'oc_123',
      userId: 'ou_user1',
      userName: '',
      text: '[File: report.txt]',
      conversationKey: 'ou_user1',
      messageId: 'msg-file',
      files: [
        {
          filename: 'report.txt',
          data: fileBuffer.toString('base64'),
          media_type: 'text/plain',
          size: fileBuffer.length
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
