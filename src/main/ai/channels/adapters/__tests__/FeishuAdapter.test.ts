import type { NormalizedMessage } from '@larksuiteoapi/node-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const registrationMocks = vi.hoisted(() => ({ begin: vi.fn(), poll: vi.fn() }))
const loggerMocks = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMocks
  }
}))

vi.mock('../../ChannelManager', () => ({ registerAdapterFactory: vi.fn() }))

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/userData' },
  nativeTheme: { themeSource: '', shouldUseDarkColors: false },
  net: { fetch: vi.fn() }
}))

vi.mock('../../../../../MainWindowService', () => ({
  windowService: { getMainWindow: () => null }
}))

vi.mock('../feishu/FeishuAppRegistration', () => ({
  registrationBegin: registrationMocks.begin,
  registrationPoll: registrationMocks.poll
}))

const mockConnect = vi.fn()
const mockDisconnect = vi.fn()
const mockSend = vi.fn()
const mockStream = vi.fn()
const mockMessageResourceGet = vi.fn()
const mockAddReaction = vi.fn()
const mockRemoveReaction = vi.fn()
const mockSetContent = vi.fn()
let channelHandlers: Record<string, (...args: any[]) => any> = {}
let channelOptions: Record<string, any> | undefined

const mockChannel = {
  connect: mockConnect,
  disconnect: mockDisconnect,
  send: mockSend,
  stream: mockStream,
  rawClient: { im: { v1: { messageResource: { get: mockMessageResourceGet } } } },
  addReaction: mockAddReaction,
  removeReaction: mockRemoveReaction,
  on: vi.fn((handlers: Record<string, (...args: any[]) => any>) => {
    channelHandlers = handlers
    return vi.fn()
  })
}

vi.mock('@larksuiteoapi/node-sdk', () => ({
  createLarkChannel: vi.fn((options) => {
    channelOptions = options
    return mockChannel
  }),
  Domain: { Feishu: 0, Lark: 1 },
  LoggerLevel: { info: 3 }
}))

import '../feishu/FeishuAdapter'

import { registerAdapterFactory } from '../../ChannelManager'

function getFactory() {
  const call = vi.mocked(registerAdapterFactory).mock.calls.find(([type]) => type === 'feishu')
  if (!call) throw new Error('registerAdapterFactory was not called for feishu')
  return call[1] as (channel: any, agentId: string) => any
}

function incomingMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: 'msg-in-1',
    chatId: 'oc_123',
    chatType: 'p2p',
    senderId: 'ou_user1',
    senderName: 'Alice',
    content: 'Hello agent',
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: Date.now(),
    ...overrides
  }
}

describe('FeishuAdapter', () => {
  beforeEach(() => {
    mockConnect.mockReset().mockResolvedValue(undefined)
    mockDisconnect.mockReset().mockResolvedValue(undefined)
    mockSend.mockReset().mockResolvedValue({ messageId: 'msg-out-1' })
    mockMessageResourceGet.mockReset()
    mockAddReaction.mockReset().mockResolvedValue('rx-1')
    mockRemoveReaction.mockReset().mockResolvedValue(undefined)
    mockSetContent.mockReset().mockResolvedValue(undefined)
    mockStream.mockReset().mockImplementation(async (_chatId, input) => {
      await input.markdown({ messageId: 'stream-1', setContent: mockSetContent, append: vi.fn() })
      return { messageId: 'stream-1' }
    })
    mockChannel.on.mockClear()
    registrationMocks.begin.mockReset().mockRejectedValue(new Error('Registration unavailable'))
    registrationMocks.poll.mockReset()
    channelHandlers = {}
    channelOptions = undefined
  })

  afterEach(() => vi.useRealTimers())

  function createAdapter(overrides: Record<string, unknown> = {}) {
    return getFactory()(
      {
        id: (overrides.channelId as string) ?? 'ch-1',
        type: 'feishu',
        enabled: true,
        config: {
          app_id: (overrides.app_id as string) ?? 'test-app-id',
          app_secret: (overrides.app_secret as string) ?? 'test-app-secret',
          encrypt_key: (overrides.encrypt_key as string) ?? '',
          verification_token: (overrides.verification_token as string) ?? '',
          allowed_chat_ids: (overrides.allowed_chat_ids as string[]) ?? ['oc_123'],
          domain: (overrides.domain as string) ?? 'feishu'
        }
      },
      (overrides.agentId as string) ?? 'agent-1'
    )
  }

  it('reports connected only after the official channel handshake completes', async () => {
    let finishConnect!: () => void
    mockConnect.mockReturnValue(new Promise<void>((resolve) => (finishConnect = resolve)))
    const adapter = createAdapter()

    const connecting = adapter.connect()
    await Promise.resolve()

    expect(adapter.connected).toBe(false)
    finishConnect()
    await connecting
    expect(adapter.connected).toBe(true)
  })

  it('configures official connection health, mention policy, and channel user agent', async () => {
    const adapter = createAdapter({ domain: 'lark' })
    await adapter.connect()

    expect(channelOptions).toMatchObject({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      domain: 1,
      source: 'cherry-studio',
      policy: { dmMode: 'open', requireMention: true, respondToMentionAll: false },
      safety: { batch: { text: { delayMs: 0 } } },
      outbound: { textChunkLimit: 4000 },
      wsConfig: { pingTimeout: 10 }
    })
  })

  it('forwards configured event security to the WebSocket dispatcher', async () => {
    const adapter = createAdapter({
      encrypt_key: 'test-encrypt-key',
      verification_token: 'test-verification-token'
    })
    await adapter.connect()

    expect(channelOptions).toMatchObject({
      transport: 'websocket',
      webhook: {
        encryptKey: 'test-encrypt-key',
        verificationToken: 'test-verification-token'
      }
    })
  })

  it('keeps active stream listeners alive while the WebSocket reconnects', async () => {
    const adapter = createAdapter()
    const statuses: Array<{ connected: boolean }> = []
    adapter.on('statusChange', (status) => statuses.push(status))
    await adapter.connect()

    channelHandlers.reconnecting()
    expect(adapter.connected).toBe(true)
    channelHandlers.reconnected()

    expect(statuses.map(({ connected }) => connected)).toEqual([true, true])
  })

  it('disconnects the official channel', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.disconnect()
    expect(mockDisconnect).toHaveBeenCalledOnce()
    expect(adapter.connected).toBe(false)
  })

  it('does not reconnect the adapter when disconnect happens during the handshake', async () => {
    let finishConnect!: () => void
    mockConnect.mockReturnValue(new Promise<void>((resolve) => (finishConnect = resolve)))
    const adapter = createAdapter()

    const connecting = adapter.connect()
    await Promise.resolve()
    await adapter.disconnect()
    finishConnect()
    await connecting

    expect(adapter.connected).toBe(false)
    expect(mockDisconnect).toHaveBeenCalledTimes(2)
  })

  it('starts QR registration when credentials are missing', async () => {
    registrationMocks.begin.mockResolvedValue({
      deviceCode: 'device-code',
      verificationUri: 'https://accounts.feishu.cn/device/qr',
      interval: 1,
      expiresIn: 600
    })
    registrationMocks.poll.mockResolvedValue({ appId: 'new-app-id', appSecret: 'new-app-secret' })
    const adapter = createAdapter({ app_id: '', app_secret: '' })
    const onQr = vi.fn()
    const onCredentials = vi.fn()
    adapter.on('qr', onQr)
    adapter.on('credentials', onCredentials)

    await adapter.connect()

    await vi.waitFor(() => {
      expect(onQr).toHaveBeenCalledWith('https://accounts.feishu.cn/device/qr')
      expect(onCredentials).toHaveBeenCalledWith({ appId: 'new-app-id', appSecret: 'new-app-secret' })
    })
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('does not finish QR registration after disconnect', async () => {
    let finishPoll!: (result: { appId: string; appSecret: string }) => void
    registrationMocks.begin.mockResolvedValue({
      deviceCode: 'device-code',
      verificationUri: 'https://accounts.feishu.cn/device/qr',
      interval: 1,
      expiresIn: 600
    })
    registrationMocks.poll.mockReturnValue(new Promise((resolve) => (finishPoll = resolve)))
    const adapter = createAdapter({ app_id: '', app_secret: '' })
    const onCredentials = vi.fn()
    adapter.on('credentials', onCredentials)

    await adapter.connect()
    await vi.waitFor(() => expect(registrationMocks.poll).toHaveBeenCalledOnce())
    await adapter.disconnect()
    finishPoll({ appId: 'new-app-id', appSecret: 'new-app-secret' })
    await Promise.resolve()

    expect(onCredentials).not.toHaveBeenCalled()
  })

  it('sends markdown through the official channel and replies to the inbound message', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.sendMessage('oc_123', 'Hello Feishu', { replyToMessageId: 'msg-in-1' })
    expect(mockSend).toHaveBeenCalledWith('oc_123', { markdown: 'Hello Feishu' }, { replyTo: 'msg-in-1' })
  })

  it('sends images and files through typed media inputs', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    await adapter.sendFile('oc_123', {
      filename: 'chart.png',
      data: Buffer.from('png').toString('base64'),
      media_type: 'image/png',
      size: 3
    })
    await adapter.sendFile('oc_123', {
      filename: 'report.pdf',
      data: Buffer.from('pdf').toString('base64'),
      media_type: 'application/pdf',
      size: 3
    })

    expect(mockSend).toHaveBeenNthCalledWith(1, 'oc_123', { image: { source: expect.any(Buffer) } })
    expect(mockSend).toHaveBeenNthCalledWith(2, 'oc_123', {
      file: { source: expect.any(Buffer), fileName: 'report.pdf' }
    })
  })

  it('bridges cumulative text updates to the official streaming API', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await channelHandlers.message(incomingMessage())

    const responseOptions = { replyToMessageId: 'msg-in-1' }
    await adapter.onTextUpdate('oc_123', 'partial', responseOptions)
    await adapter.onTextUpdate('oc_123', 'partial response', responseOptions)
    await expect(adapter.onStreamComplete('oc_123', 'final response', responseOptions)).resolves.toBe(true)

    expect(mockStream).toHaveBeenCalledWith('oc_123', expect.any(Object), { replyTo: 'msg-in-1' })
    expect(mockSetContent).toHaveBeenNthCalledWith(1, 'partial')
    expect(mockSetContent).toHaveBeenNthCalledWith(2, 'partial response')
    expect(mockSetContent).toHaveBeenNthCalledWith(3, 'final response')
  })

  it('falls back to a regular message when stream completion fails', async () => {
    mockStream.mockImplementationOnce(async (_chatId, input) => {
      await input.markdown({ messageId: 'stream-1', setContent: mockSetContent, append: vi.fn() })
      throw new Error('stream failed')
    })
    const adapter = createAdapter()
    await adapter.connect()

    await adapter.onTextUpdate('oc_123', 'partial', { replyToMessageId: 'msg-in-1' })

    await expect(adapter.onStreamComplete('oc_123', 'final', { replyToMessageId: 'msg-in-1' })).resolves.toBe(false)
  })

  it('sends proactive streams at the chat root instead of replying to the last inbound message', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await channelHandlers.message(incomingMessage())

    await adapter.onTextUpdate('oc_123', 'proactive update')

    expect(mockStream).toHaveBeenCalledWith('oc_123', expect.any(Object), undefined)
  })

  it('isolates thread events and keeps streamed replies in the originating thread', async () => {
    const adapter = createAdapter()
    const onMessage = vi.fn()
    adapter.on('message', onMessage)
    await adapter.connect()

    await channelHandlers.message(incomingMessage({ chatType: 'group', threadId: 'thread-1', rootId: 'root-1' }))
    await adapter.onTextUpdate('oc_123', 'partial', { replyToMessageId: 'msg-in-1', replyInThread: true })
    await adapter.onStreamComplete('oc_123', 'final', { replyToMessageId: 'msg-in-1', replyInThread: true })

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'oc_123',
        conversationId: 'thread:thread-1',
        replyInThread: true
      })
    )
    expect(mockStream).toHaveBeenCalledWith('oc_123', expect.any(Object), {
      replyTo: 'msg-in-1',
      replyInThread: true
    })
  })

  it('keeps ordinary quoted replies in the chat conversation', async () => {
    const adapter = createAdapter()
    const onMessage = vi.fn()
    adapter.on('message', onMessage)
    await adapter.connect()

    await channelHandlers.message(incomingMessage({ chatType: 'group', rootId: 'root-1' }))

    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'oc_123' }))
    expect(onMessage.mock.calls[0][0]).not.toHaveProperty('conversationId')
    expect(onMessage.mock.calls[0][0]).not.toHaveProperty('replyInThread')
  })

  it('preserves partial output when finalizing a failed stream', async () => {
    const adapter = createAdapter()
    await adapter.connect()

    await adapter.onTextUpdate('oc_123', 'partial response')
    await adapter.onStreamError('oc_123', 'generation failed')

    expect(mockSetContent).toHaveBeenLastCalledWith('partial response\n\n---\n**Error**: generation failed')
  })

  it('settles the stream when its best-effort error update fails', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.onTextUpdate('oc_123', 'partial response')
    mockSetContent.mockRejectedValueOnce(new Error('card update failed'))

    await expect(adapter.onStreamError('oc_123', 'generation failed')).resolves.toBeUndefined()
  })

  it('ignores late card updates after disconnecting an active stream', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await adapter.onTextUpdate('oc_123', 'partial response')
    const stream = (
      adapter as unknown as { streams: Map<string, { update: (text: string) => Promise<void> }> }
    ).streams.get('oc_123')
    expect(stream).toBeDefined()

    await adapter.disconnect()
    mockSetContent.mockClear()
    await stream!.update('late update')

    expect(mockSetContent).not.toHaveBeenCalled()
  })

  it('logs callback failures instead of leaving a rejected SDK handler promise', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    vi.spyOn(adapter, 'downloadResources').mockRejectedValueOnce(new Error('download failed'))

    expect(channelHandlers.message(incomingMessage())).toBeUndefined()
    await vi.waitFor(() => {
      expect(loggerMocks.error).toHaveBeenCalledWith(
        'Failed to handle Feishu message',
        expect.objectContaining({ chatId: 'oc_123', messageId: 'msg-in-1', error: 'download failed' })
      )
    })
  })

  it('emits normalized text, sender identity, and reply message id', async () => {
    const adapter = createAdapter()
    const onMessage = vi.fn()
    adapter.on('message', onMessage)
    await adapter.connect()

    await channelHandlers.message(incomingMessage())

    expect(onMessage).toHaveBeenCalledWith({
      chatId: 'oc_123',
      userId: 'ou_user1',
      userName: 'Alice',
      messageId: 'msg-in-1',
      text: 'Hello agent'
    })
  })

  it('routes normalized slash commands without invoking the agent', async () => {
    const adapter = createAdapter()
    const onCommand = vi.fn()
    const onMessage = vi.fn()
    adapter.on('command', onCommand)
    adapter.on('message', onMessage)
    await adapter.connect()

    await channelHandlers.message(incomingMessage({ content: '/new project' }))

    expect(onCommand).toHaveBeenCalledWith({
      chatId: 'oc_123',
      userId: 'ou_user1',
      userName: 'Alice',
      messageId: 'msg-in-1',
      command: 'new',
      args: 'project'
    })
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('retains the configured chat allowlist after SDK normalization', async () => {
    const adapter = createAdapter({ allowed_chat_ids: ['oc_allowed'] })
    const onMessage = vi.fn()
    adapter.on('message', onMessage)
    await adapter.connect()

    await channelHandlers.message(incomingMessage({ chatId: 'oc_blocked' }))

    expect(onMessage).not.toHaveBeenCalled()
  })

  it('downloads normalized image and file resources for the agent', async () => {
    const adapter = createAdapter()
    const onMessage = vi.fn()
    adapter.on('message', onMessage)
    await adapter.connect()
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    const pdf = Buffer.from('%PDF-1.7')
    mockMessageResourceGet
      .mockResolvedValueOnce({
        getReadableStream: async function* () {
          yield png
        }
      })
      .mockResolvedValueOnce({
        getReadableStream: async function* () {
          yield pdf
        }
      })

    channelHandlers.message(
      incomingMessage({
        content: '<image>\n<file name="report.pdf">',
        resources: [
          { type: 'image', fileKey: 'img-1' },
          { type: 'file', fileKey: 'file-1', fileName: 'report.pdf' }
        ]
      })
    )
    await vi.waitFor(() => expect(mockMessageResourceGet).toHaveBeenCalledTimes(2))

    expect(mockMessageResourceGet).toHaveBeenNthCalledWith(1, {
      path: { message_id: 'msg-in-1', file_key: 'img-1' },
      params: { type: 'image' }
    })
    expect(mockMessageResourceGet).toHaveBeenNthCalledWith(2, {
      path: { message_id: 'msg-in-1', file_key: 'file-1' },
      params: { type: 'file' }
    })
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [{ data: png.toString('base64'), media_type: 'image/png' }],
        files: [
          {
            filename: 'report.pdf',
            data: pdf.toString('base64'),
            media_type: 'application/pdf',
            size: pdf.length
          }
        ]
      })
    )
  })

  it('downloads audio as a file and skips unsupported stickers', async () => {
    const adapter = createAdapter()
    const onMessage = vi.fn()
    adapter.on('message', onMessage)
    await adapter.connect()
    const audio = Buffer.from('audio')
    mockMessageResourceGet.mockResolvedValue({
      getReadableStream: async function* () {
        yield audio
      }
    })

    channelHandlers.message(
      incomingMessage({
        content: '<audio key="audio-1"/>',
        resources: [
          { type: 'audio', fileKey: 'audio-1', fileName: 'note.mp3' },
          { type: 'sticker', fileKey: 'sticker-1' }
        ]
      })
    )
    await vi.waitFor(() => expect(mockMessageResourceGet).toHaveBeenCalledOnce())

    expect(mockMessageResourceGet).toHaveBeenCalledWith({
      path: { message_id: 'msg-in-1', file_key: 'audio-1' },
      params: { type: 'file' }
    })
    await vi.waitFor(() =>
      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [expect.objectContaining({ filename: 'note.mp3', data: audio.toString('base64') })]
        })
      )
    )
  })

  it('uses official reaction APIs for thinking and completion status', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await channelHandlers.message(incomingMessage())
    mockAddReaction.mockResolvedValueOnce('rx-thinking').mockResolvedValueOnce('rx-done')

    const responseOptions = { replyToMessageId: 'msg-in-1' }
    await adapter.sendTypingIndicator('oc_123', responseOptions)
    await adapter.sendMessage('oc_123', 'Done', responseOptions)

    expect(mockAddReaction).toHaveBeenNthCalledWith(1, 'msg-in-1', 'Typing')
    expect(mockRemoveReaction).toHaveBeenCalledWith('msg-in-1', 'rx-thinking')
    expect(mockAddReaction).toHaveBeenNthCalledWith(2, 'msg-in-1', 'OK')
    expect(adapter.chatReactions.size).toBe(0)
  })

  it('keeps every long thread reply chunk in the originating thread', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    const text = 'A'.repeat(4001)

    await adapter.sendMessage('oc_123', text, { replyToMessageId: 'msg-in-1', replyInThread: true })

    expect(mockSend.mock.calls.map(([, input]) => input.markdown).join('')).toBe(text)
    expect(mockSend).toHaveBeenCalledTimes(2)
    for (const [chatId, input, options] of mockSend.mock.calls) {
      expect(chatId).toBe('oc_123')
      expect(input.markdown.length).toBeLessThanOrEqual(4000)
      expect(options).toEqual({ replyTo: 'msg-in-1', replyInThread: true })
    }
  })

  it('balances code fences across long thread reply chunks', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    const text = [
      '```typescript',
      ...Array.from({ length: 300 }, (_, index) => `const value${index} = ${index}`),
      '```'
    ].join('\n')

    await adapter.sendMessage('oc_123', text, { replyToMessageId: 'msg-in-1', replyInThread: true })

    const chunks = mockSend.mock.calls.map(([, input]) => input.markdown as string)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000)
      expect(chunk.match(/^```/gm)).toHaveLength(2)
    }
    expect(chunks.join('\n').match(/^const value\d+ = \d+$/gm)).toHaveLength(300)
    expect(chunks.slice(1).every((chunk) => chunk.startsWith('```typescript\n'))).toBe(true)
  })

  it('keeps notification chat ids from configuration', () => {
    const adapter = createAdapter({ allowed_chat_ids: ['oc_a', 'oc_b'] })
    expect(adapter.notifyChatIds).toEqual(['oc_a', 'oc_b'])
  })
})
