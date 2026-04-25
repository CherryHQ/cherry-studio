import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../../ChannelManager', () => ({
  registerAdapterFactory: vi.fn()
}))

// Mock net.fetch for all Slack API calls
const mockNetFetch = vi.fn()

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/userData' },
  nativeTheme: { themeSource: '', shouldUseDarkColors: false },
  net: { fetch: (...args: unknown[]) => mockNetFetch(...args) }
}))

// Mock WebSocket — create a fake class that emits events like a real WS
class MockWebSocket extends EventEmitter {
  static OPEN = 1
  static CONNECTING = 0
  readyState = 1
  send = vi.fn()
  close = vi.fn()
  ping = vi.fn()
}

let mockWsInstance: MockWebSocket | null = null

vi.mock('ws', () => {
  const Ctor = vi.fn().mockImplementation(() => {
    mockWsInstance = new MockWebSocket()
    return mockWsInstance
  })
  Object.assign(Ctor, { OPEN: 1, CONNECTING: 0, CLOSED: 3, CLOSING: 2 })
  return { default: Ctor, WebSocket: Ctor }
})

import '../slack/SlackAdapter'

import { registerAdapterFactory } from '../../ChannelManager'

function getFactory() {
  const calls = vi.mocked(registerAdapterFactory).mock.calls
  const slackCall = calls.find((c) => c[0] === 'slack')
  if (!slackCall) throw new Error('registerAdapterFactory was not called for slack')
  return slackCall[1] as (channel: any, agentId: string) => any
}

// Helper to build a mock Response
function mockJsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    arrayBuffer: () => Promise.resolve(Buffer.from(JSON.stringify(data)).buffer)
  } as unknown as Response
}

function mockBinaryResponse(buf: Buffer, contentType = 'image/png'): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType }),
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(''),
    arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  } as unknown as Response
}

// Realistic Slack user IDs (alphanumeric, no underscores)
const BOT_USER_ID = 'UBOT12345'
const USER1_ID = 'U01ABCDEF'

describe('SlackAdapter', () => {
  beforeEach(() => {
    mockNetFetch.mockReset()
    mockWsInstance = null

    // Default mock: auth.test returns bot user ID, apps.connections.open returns WS URL
    mockNetFetch.mockImplementation((url: string) => {
      if (typeof url === 'string') {
        if (url.includes('auth.test')) {
          return Promise.resolve(mockJsonResponse({ ok: true, user_id: BOT_USER_ID }))
        }
        if (url.includes('apps.connections.open')) {
          return Promise.resolve(mockJsonResponse({ ok: true, url: 'wss://slack.test/ws' }))
        }
        if (url.includes('chat.postMessage')) {
          return Promise.resolve(mockJsonResponse({ ok: true, ts: '1234567890.123456' }))
        }
        if (url.includes('chat.update')) {
          return Promise.resolve(mockJsonResponse({ ok: true }))
        }
        if (url.includes('users.info')) {
          return Promise.resolve(mockJsonResponse({ ok: true, user: { real_name: 'Test User', name: 'testuser' } }))
        }
      }
      return Promise.resolve(mockJsonResponse({ ok: true }))
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createAdapter(overrides: Record<string, unknown> = {}) {
    const factory = getFactory()
    return factory(
      {
        id: (overrides.channelId as string) ?? 'ch-slack-1',
        type: 'slack',
        enabled: true,
        config: {
          bot_token: (overrides.bot_token as string) ?? 'xoxb-test-token',
          app_token: (overrides.app_token as string) ?? 'xapp-test-token',
          allowed_channel_ids: (overrides.allowed_channel_ids as string[]) ?? ['C0ALLOWED']
        }
      },
      (overrides.agentId as string) ?? 'agent-1'
    )
  }

  async function connectAdapter(overrides: Record<string, unknown> = {}) {
    const adapter = createAdapter(overrides)
    const connectPromise = adapter.connect()
    // Simulate WS open + hello
    await vi.waitFor(() => expect(mockWsInstance).not.toBeNull())
    mockWsInstance!.emit('open')
    simulateHello()
    await connectPromise
    return adapter
  }

  function simulateHello() {
    const envelope = { envelope_id: 'env-hello', type: 'hello' }
    mockWsInstance!.emit('message', Buffer.from(JSON.stringify(envelope)))
  }

  function simulateMessageEvent(event: Record<string, unknown>, envelopeId = 'env-msg-1') {
    const envelope = {
      envelope_id: envelopeId,
      type: 'events_api',
      payload: { event: { type: 'message', ts: '1234.5678', ...event } }
    }
    mockWsInstance!.emit('message', Buffer.from(JSON.stringify(envelope)))
  }

  function simulateSlashCommand(payload: Record<string, unknown>, envelopeId = 'env-cmd-1') {
    const envelope = { envelope_id: envelopeId, type: 'slash_commands', payload }
    mockWsInstance!.emit('message', Buffer.from(JSON.stringify(envelope)))
  }

  // ─── Registration ─────────────────────────────────────────

  it('registers itself as a slack adapter factory', () => {
    const calls = vi.mocked(registerAdapterFactory).mock.calls
    expect(calls.some((c) => c[0] === 'slack')).toBe(true)
  })

  // ─── Constructor & Config ─────────────────────────────────

  it('sets notifyChatIds from allowed_channel_ids', () => {
    const adapter = createAdapter({ allowed_channel_ids: ['C1', 'C2'] })
    expect(adapter.notifyChatIds).toEqual(['C1', 'C2'])
  })

  it('sets empty notifyChatIds when allowed_channel_ids is empty', () => {
    const adapter = createAdapter({ allowed_channel_ids: [] })
    expect(adapter.notifyChatIds).toEqual([])
  })

  // ─── Connection Lifecycle ─────────────────────────────────

  it('connect() calls auth.test and apps.connections.open, then opens WebSocket', async () => {
    await connectAdapter()

    const calls = mockNetFetch.mock.calls.map((c: unknown[]) => c[0])
    expect(calls).toContainEqual(expect.stringContaining('auth.test'))
    expect(calls).toContainEqual(expect.stringContaining('apps.connections.open'))
    expect(mockWsInstance).not.toBeNull()
  })

  it('connect() marks adapter as connected on hello', async () => {
    const adapter = await connectAdapter()
    expect(adapter.connected).toBe(true)
  })

  it('connect() acknowledges the hello envelope', async () => {
    await connectAdapter()
    expect(mockWsInstance!.send).toHaveBeenCalledWith(JSON.stringify({ envelope_id: 'env-hello' }))
  })

  it('connect() with missing bot_token does not connect (checkReady returns false)', async () => {
    const adapter = createAdapter({ bot_token: '' })
    await adapter.connect()
    expect(adapter.connected).toBe(false)
  })

  it('connect() with missing app_token does not connect', async () => {
    const adapter = createAdapter({ app_token: '' })
    await adapter.connect()
    expect(adapter.connected).toBe(false)
  })

  it('disconnect() closes WebSocket and clears state', async () => {
    const adapter = await connectAdapter()
    const wsRef = mockWsInstance!
    await adapter.disconnect()
    expect(wsRef.close).toHaveBeenCalled()
  })

  // ─── Message Sending ──────────────────────────────────────

  it('sendMessage() calls chat.postMessage with correct params', async () => {
    const adapter = await connectAdapter()
    await adapter.sendMessage('C0ALLOWED', 'Hello Slack')

    const postCalls = mockNetFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('chat.postMessage'))
    expect(postCalls.length).toBeGreaterThanOrEqual(1)

    const lastPostCall = postCalls[postCalls.length - 1]
    const body = JSON.parse(lastPostCall[1].body)
    expect(body).toEqual({ channel: 'C0ALLOWED', text: 'Hello Slack' })
  })

  it('sendMessage() chunks long messages', async () => {
    // Connect with real timers first
    const adapter = await connectAdapter()
    // Then switch to fake timers for the send
    vi.useFakeTimers()

    const longText = 'A'.repeat(5000)
    const sendPromise = adapter.sendMessage('C0ALLOWED', longText)
    await vi.runAllTimersAsync()
    await sendPromise

    const postCalls = mockNetFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('chat.postMessage'))
    // 5000 chars > 4000 max → should be split into 2 chunks
    expect(postCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('sendTypingIndicator() is a no-op and does not throw', async () => {
    const adapter = await connectAdapter()
    await expect(adapter.sendTypingIndicator('C0ALLOWED')).resolves.toBeUndefined()
  })

  // ─── Incoming Messages ────────────────────────────────────

  it('emits message event for incoming text messages', async () => {
    const adapter = await connectAdapter()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    simulateMessageEvent({ channel: 'C0ALLOWED', user: USER1_ID, text: 'Hello agent' })

    await vi.waitFor(() => expect(messageSpy).toHaveBeenCalledTimes(1))

    expect(messageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'C0ALLOWED',
        userId: USER1_ID,
        userName: 'Test User',
        text: 'Hello agent'
      })
    )
  })

  it('acknowledges incoming message envelopes', async () => {
    await connectAdapter()
    simulateMessageEvent({ channel: 'C0ALLOWED', user: USER1_ID, text: 'Hello' }, 'env-ack-test')

    await vi.waitFor(() => {
      expect(mockWsInstance!.send).toHaveBeenCalledWith(JSON.stringify({ envelope_id: 'env-ack-test' }))
    })
  })

  it('strips bot mentions from incoming text', async () => {
    const adapter = await connectAdapter()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    simulateMessageEvent({
      channel: 'C0ALLOWED',
      user: USER1_ID,
      text: `<@${BOT_USER_ID}> Hello agent`
    })

    await vi.waitFor(() => expect(messageSpy).toHaveBeenCalledTimes(1))
    expect(messageSpy).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello agent' }))
  })

  it('ignores messages with subtypes (edits, deletes, etc.)', async () => {
    const adapter = await connectAdapter()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    simulateMessageEvent({
      channel: 'C0ALLOWED',
      user: USER1_ID,
      text: 'Edited',
      subtype: 'message_changed'
    })

    await new Promise((r) => setTimeout(r, 50))
    expect(messageSpy).not.toHaveBeenCalled()
  })

  it('allows file_share subtype messages (image/file uploads)', async () => {
    const adapter = await connectAdapter()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    const imageBuffer = Buffer.from('fake-image-data')
    mockNetFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('files.slack.com')) {
        return Promise.resolve(mockBinaryResponse(imageBuffer, 'image/png'))
      }
      if (url.includes('users.info')) {
        return Promise.resolve(mockJsonResponse({ ok: true, user: { real_name: 'Test User' } }))
      }
      return Promise.resolve(mockJsonResponse({ ok: true }))
    })

    simulateMessageEvent({
      channel: 'C0ALLOWED',
      user: USER1_ID,
      text: '',
      subtype: 'file_share',
      files: [
        {
          id: 'F1',
          name: 'photo.png',
          mimetype: 'image/png',
          size: 1000,
          url_private: 'https://files.slack.com/photo.png'
        }
      ]
    })

    await vi.waitFor(() => expect(messageSpy).toHaveBeenCalledTimes(1))
    expect(messageSpy.mock.calls[0][0].images).toHaveLength(1)
  })

  it('ignores messages from the bot itself', async () => {
    const adapter = await connectAdapter()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    simulateMessageEvent({ channel: 'C0ALLOWED', user: BOT_USER_ID, text: 'My own message' })

    await new Promise((r) => setTimeout(r, 50))
    expect(messageSpy).not.toHaveBeenCalled()
  })

  it('blocks messages from unauthorized channels', async () => {
    const adapter = await connectAdapter({ allowed_channel_ids: ['C0ALLOWED'] })
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    simulateMessageEvent({ channel: 'C0UNAUTH', user: USER1_ID, text: 'Blocked' })

    await new Promise((r) => setTimeout(r, 50))
    expect(messageSpy).not.toHaveBeenCalled()
  })

  it('allows messages when allowed_channel_ids is empty (no restriction)', async () => {
    const adapter = await connectAdapter({ allowed_channel_ids: [] })
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    simulateMessageEvent({ channel: 'C0ANY', user: USER1_ID, text: 'Allowed' })

    await vi.waitFor(() => expect(messageSpy).toHaveBeenCalledTimes(1))
    expect(messageSpy).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'C0ANY', text: 'Allowed' }))
  })

  it('ignores empty messages with no text and no files', async () => {
    const adapter = await connectAdapter()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    simulateMessageEvent({ channel: 'C0ALLOWED', user: USER1_ID, text: '' })

    await new Promise((r) => setTimeout(r, 50))
    expect(messageSpy).not.toHaveBeenCalled()
  })

  // ─── Slash Commands (from text) ───────────────────────────

  it('emits command event for /new text message', async () => {
    const adapter = await connectAdapter()
    const commandSpy = vi.fn()
    adapter.on('command', commandSpy)

    simulateMessageEvent({ channel: 'C0ALLOWED', user: USER1_ID, text: '/new' })

    await vi.waitFor(() => expect(commandSpy).toHaveBeenCalledTimes(1))
    expect(commandSpy).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'C0ALLOWED', userId: USER1_ID, command: 'new' })
    )
  })

  it('handles /whoami text command by sending a message', async () => {
    const adapter = await connectAdapter()
    const commandSpy = vi.fn()
    adapter.on('command', commandSpy)

    simulateMessageEvent({ channel: 'C0ALLOWED', user: USER1_ID, text: '/whoami' })

    // /whoami sends a message instead of emitting command
    await vi.waitFor(() => {
      const postCalls = mockNetFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('chat.postMessage'))
      expect(postCalls.length).toBeGreaterThanOrEqual(1)
      const bodies = postCalls.map((c: unknown[]) => JSON.parse((c[1] as any).body))
      expect(bodies.some((b: any) => b.text?.includes('Channel ID'))).toBe(true)
    })

    expect(commandSpy).not.toHaveBeenCalled()
  })

  // ─── Slash Commands (from Socket Mode slash_commands) ─────

  it('emits command event for slash_commands envelope', async () => {
    const adapter = await connectAdapter()
    const commandSpy = vi.fn()
    adapter.on('command', commandSpy)

    simulateSlashCommand({
      command: '/new',
      channel_id: 'C0ALLOWED',
      user_id: USER1_ID,
      user_name: 'testuser'
    })

    await vi.waitFor(() => expect(commandSpy).toHaveBeenCalledTimes(1))
    expect(commandSpy).toHaveBeenCalledWith({
      chatId: 'C0ALLOWED',
      userId: USER1_ID,
      userName: 'testuser',
      command: 'new'
    })
  })

  it('handles /whoami slash command by sending a message', async () => {
    await connectAdapter()

    simulateSlashCommand({
      command: '/whoami',
      channel_id: 'C0ALLOWED',
      user_id: USER1_ID,
      user_name: 'testuser'
    })

    await vi.waitFor(() => {
      const postCalls = mockNetFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('chat.postMessage'))
      expect(postCalls.length).toBeGreaterThanOrEqual(1)
      const bodies = postCalls.map((c: unknown[]) => JSON.parse((c[1] as any).body))
      expect(bodies.some((b: any) => b.text?.includes('Channel ID'))).toBe(true)
    })
  })

  it('blocks slash commands from unauthorized channels', async () => {
    const adapter = await connectAdapter({ allowed_channel_ids: ['C0ALLOWED'] })
    const commandSpy = vi.fn()
    adapter.on('command', commandSpy)

    simulateSlashCommand({
      command: '/new',
      channel_id: 'C0UNAUTH',
      user_id: USER1_ID,
      user_name: 'testuser'
    })

    await new Promise((r) => setTimeout(r, 50))
    expect(commandSpy).not.toHaveBeenCalled()
  })

  // ─── Disconnect Envelope ──────────────────────────────────

  it('closes WebSocket when disconnect envelope is received', async () => {
    await connectAdapter()
    const wsRef = mockWsInstance!

    const envelope = { envelope_id: 'env-disc', type: 'disconnect' }
    wsRef.emit('message', Buffer.from(JSON.stringify(envelope)))

    await vi.waitFor(() => {
      expect(wsRef.close).toHaveBeenCalledWith(1000, 'Server requested disconnect')
    })
  })

  // ─── File Attachments ─────────────────────────────────────

  it('downloads image attachments with bot token auth', async () => {
    const adapter = await connectAdapter()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    const imageBuffer = Buffer.from('fake-image-data')
    mockNetFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('files.slack.com')) {
        return Promise.resolve(mockBinaryResponse(imageBuffer, 'image/png'))
      }
      if (url.includes('users.info')) {
        return Promise.resolve(mockJsonResponse({ ok: true, user: { real_name: 'Test User' } }))
      }
      return Promise.resolve(mockJsonResponse({ ok: true }))
    })

    simulateMessageEvent({
      channel: 'C0ALLOWED',
      user: USER1_ID,
      text: 'Check this image',
      files: [
        {
          id: 'F1',
          name: 'photo.png',
          mimetype: 'image/png',
          size: 1000,
          url_private: 'https://files.slack.com/photo.png'
        }
      ]
    })

    await vi.waitFor(() => expect(messageSpy).toHaveBeenCalledTimes(1))

    const call = messageSpy.mock.calls[0][0]
    expect(call.images).toHaveLength(1)
    expect(call.images[0].media_type).toBe('image/png')
    expect(call.images[0].data).toBe(imageBuffer.toString('base64'))

    // Verify the download used Bearer auth
    const fileFetchCall = mockNetFetch.mock.calls.find((c: unknown[]) => (c[0] as string).includes('files.slack.com'))
    expect(fileFetchCall![1]).toEqual({ headers: { Authorization: 'Bearer xoxb-test-token' } })
  })

  // ─── Streaming ────────────────────────────────────────────

  it('onTextUpdate() creates a message then edits it on subsequent updates', async () => {
    const adapter = await connectAdapter()
    vi.useFakeTimers()

    await adapter.onTextUpdate('C0ALLOWED', 'partial text...')

    // First update creates a new message
    const postCalls = mockNetFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('chat.postMessage'))
    expect(postCalls.length).toBeGreaterThanOrEqual(1)

    // Advance timer to trigger throttled flush (long-gap batching)
    await vi.advanceTimersByTimeAsync(2000)

    const updateCalls = mockNetFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('chat.update'))
    expect(updateCalls.length).toBeGreaterThanOrEqual(1)

    const updateBody = JSON.parse(updateCalls[0][1].body)
    expect(updateBody.ts).toBe('1234567890.123456')
    expect(updateBody.text).toBe('partial text...')
  })

  it('onStreamComplete() edits the final message and returns true', async () => {
    const adapter = await connectAdapter()
    vi.useFakeTimers()

    await adapter.onTextUpdate('C0ALLOWED', 'partial...')
    await vi.advanceTimersByTimeAsync(2000)

    const result = await adapter.onStreamComplete('C0ALLOWED', 'final text')
    expect(result).toBe(true)

    const updateCalls = mockNetFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('chat.update'))
    const lastUpdateBody = JSON.parse(updateCalls[updateCalls.length - 1][1].body)
    expect(lastUpdateBody.text).toBe('final text')
  })

  it('onStreamComplete() returns false when no streaming session exists', async () => {
    const adapter = await connectAdapter()
    const result = await adapter.onStreamComplete('C0ALLOWED', 'final text')
    expect(result).toBe(false)
  })

  it('onStreamError() updates the message with error text', async () => {
    const adapter = await connectAdapter()
    vi.useFakeTimers()

    await adapter.onTextUpdate('C0ALLOWED', 'partial...')
    await vi.advanceTimersByTimeAsync(2000)

    await adapter.onStreamError('C0ALLOWED', 'Something went wrong')

    const updateCalls = mockNetFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('chat.update'))
    const lastUpdateBody = JSON.parse(updateCalls[updateCalls.length - 1][1].body)
    expect(lastUpdateBody.text).toContain('*Error*')
  })

  // ─── API Error Handling ───────────────────────────────────

  it('sendMessage() throws when Slack API returns ok=false', async () => {
    const adapter = await connectAdapter()

    mockNetFetch.mockImplementation((url: string) => {
      if (url.includes('chat.postMessage')) {
        return Promise.resolve(mockJsonResponse({ ok: false, error: 'channel_not_found' }))
      }
      return Promise.resolve(mockJsonResponse({ ok: true }))
    })

    await expect(adapter.sendMessage('C0BAD', 'Hello')).rejects.toThrow('channel_not_found')
  })

  it('sendMessage() throws when HTTP response is not ok', async () => {
    const adapter = await connectAdapter()

    mockNetFetch.mockImplementation((url: string) => {
      if (url.includes('chat.postMessage')) {
        return Promise.resolve(mockJsonResponse({}, false, 500))
      }
      return Promise.resolve(mockJsonResponse({ ok: true }))
    })

    await expect(adapter.sendMessage('C0ALLOWED', 'Hello')).rejects.toThrow('HTTP 500')
  })

  // ─── Reaction Acknowledgment ─────────────────────────────

  it('adds eyes reaction when receiving a message', async () => {
    await connectAdapter()

    simulateMessageEvent({ channel: 'C0ALLOWED', user: USER1_ID, text: 'Hello' })

    await vi.waitFor(() => {
      const reactionCalls = mockNetFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('reactions.add'))
      expect(reactionCalls.length).toBeGreaterThanOrEqual(1)
      const body = JSON.parse(reactionCalls[0][1].body)
      expect(body).toEqual({ channel: 'C0ALLOWED', name: 'eyes', timestamp: '1234.5678' })
    })
  })

  it('removes eyes reaction when sendMessage is called', async () => {
    const adapter = await connectAdapter()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    simulateMessageEvent({ channel: 'C0ALLOWED', user: USER1_ID, text: 'Hello' })
    await vi.waitFor(() => expect(messageSpy).toHaveBeenCalledTimes(1))

    await adapter.sendMessage('C0ALLOWED', 'Reply')

    const removeCalls = mockNetFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('reactions.remove'))
    expect(removeCalls.length).toBeGreaterThanOrEqual(1)
    const body = JSON.parse(removeCalls[0][1].body)
    expect(body).toEqual({ channel: 'C0ALLOWED', name: 'eyes', timestamp: '1234.5678' })
  })

  it('removes eyes reaction on stream complete', async () => {
    const adapter = await connectAdapter()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    simulateMessageEvent({ channel: 'C0ALLOWED', user: USER1_ID, text: 'Hello' })
    await vi.waitFor(() => expect(messageSpy).toHaveBeenCalledTimes(1))

    vi.useFakeTimers()
    await adapter.onTextUpdate('C0ALLOWED', 'partial...')
    await vi.advanceTimersByTimeAsync(2000)
    await adapter.onStreamComplete('C0ALLOWED', 'final')

    const removeCalls = mockNetFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('reactions.remove'))
    expect(removeCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('does not call reactions.remove when no pending reaction', async () => {
    const adapter = await connectAdapter()
    await adapter.sendMessage('C0ALLOWED', 'Unprompted message')

    const removeCalls = mockNetFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('reactions.remove'))
    expect(removeCalls).toHaveLength(0)
  })

  // ─── User Name Resolution ────────────────────────────────

  it('caches user names across messages', async () => {
    const adapter = await connectAdapter()
    const messageSpy = vi.fn()
    adapter.on('message', messageSpy)

    // Send two messages from same user
    simulateMessageEvent({ channel: 'C0ALLOWED', user: USER1_ID, text: 'First' }, 'env-1')
    await vi.waitFor(() => expect(messageSpy).toHaveBeenCalledTimes(1))

    simulateMessageEvent({ channel: 'C0ALLOWED', user: USER1_ID, text: 'Second' }, 'env-2')
    await vi.waitFor(() => expect(messageSpy).toHaveBeenCalledTimes(2))

    // users.info should only have been called once (cached on second call)
    const userInfoCalls = mockNetFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('users.info'))
    expect(userInfoCalls).toHaveLength(1)

    // Both messages should have the resolved name
    expect(messageSpy.mock.calls[0][0].userName).toBe('Test User')
    expect(messageSpy.mock.calls[1][0].userName).toBe('Test User')
  })
})
