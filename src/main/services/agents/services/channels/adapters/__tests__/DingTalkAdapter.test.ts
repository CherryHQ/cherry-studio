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
  app: { getVersion: () => '0.0.0-test', getPath: () => '/mock/userData' },
  nativeTheme: { themeSource: '', shouldUseDarkColors: false },
  net: { fetch: vi.fn() }
}))

vi.mock('../../../../../WindowService', () => ({
  windowService: { getMainWindow: () => null }
}))

// Mock DWClient so the adapter doesn't try a real WebSocket connection.
const dwClientInstances: Array<{
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  registerCallbackListener: ReturnType<typeof vi.fn>
  socketCallBackResponse: ReturnType<typeof vi.fn>
  _handler?: (downstream: any) => void
}> = []

vi.mock('dingtalk-stream', () => {
  class DWClient {
    connect = vi.fn().mockResolvedValue(undefined)
    disconnect = vi.fn()
    socketCallBackResponse = vi.fn()
    registerCallbackListener = vi.fn((_topic: string, handler: (downstream: any) => void) => {
      ;(this as any)._handler = handler
      return this
    })
    constructor() {
      dwClientInstances.push(this as any)
    }
  }
  return {
    DWClient,
    TOPIC_ROBOT: '/v1.0/im/bot/messages/get'
  }
})

// Import to trigger self-registration.
import '../dingtalk/DingTalkAdapter'

import { net } from 'electron'

import { registerAdapterFactory } from '../../ChannelManager'

function getFactory() {
  const call = vi.mocked(registerAdapterFactory).mock.calls.find((c) => c[0] === 'dingtalk')
  if (!call) throw new Error('registerAdapterFactory was not called for dingtalk')
  return call[1] as (channel: any, agentId: string) => any
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null }
  } as unknown as Response
}

describe('DingTalkAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.mocked(net.fetch)
    fetchMock.mockReset()
    dwClientInstances.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createAdapter(overrides: Record<string, unknown> = {}) {
    const factory = getFactory()
    return factory(
      {
        id: (overrides.channelId as string) ?? 'ch-1',
        type: 'dingtalk',
        enabled: true,
        config: {
          client_id: (overrides.client_id as string) ?? 'CLIENT_ID',
          client_secret: (overrides.client_secret as string) ?? 'CLIENT_SECRET',
          allowed_chat_ids: (overrides.allowed_chat_ids as string[]) ?? []
        }
      },
      (overrides.agentId as string) ?? 'agent-1'
    )
  }

  it('checkReady returns true only when both credentials are present', async () => {
    const empty = createAdapter({ client_id: '', client_secret: '' })
    expect(await empty.checkReady()).toBe(false)
    const ok = createAdapter()
    expect(await ok.checkReady()).toBe(true)
  })

  it('connect starts DWClient and registers the robot listener', async () => {
    const adapter = createAdapter({ allowed_chat_ids: ['p2p:zhangsan'] })
    await adapter.connect()

    expect(dwClientInstances).toHaveLength(1)
    const dw = dwClientInstances[0]
    expect(dw.connect).toHaveBeenCalledTimes(1)
    expect(dw.registerCallbackListener).toHaveBeenCalledTimes(1)
    expect(dw.registerCallbackListener.mock.calls[0][0]).toBe('/v1.0/im/bot/messages/get')
    expect(adapter.connected).toBe(true)

    await adapter.disconnect()
    expect(dw.disconnect).toHaveBeenCalled()
  })

  it('emits message event for an allowed p2p text and acks the message', async () => {
    const adapter = createAdapter({ allowed_chat_ids: ['p2p:staff-001'] })
    const received: any[] = []
    adapter.on('message', (msg: any) => received.push(msg))
    await adapter.connect()

    const dw = dwClientInstances[0]
    dw._handler?.({
      headers: { messageId: 'mid-1' },
      data: JSON.stringify({
        msgId: 'in-1',
        msgtype: 'text',
        conversationType: '1',
        conversationId: 'conv-1',
        senderId: 'staff-001',
        senderStaffId: 'staff-001',
        senderNick: 'Zhang San',
        sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?token=xxx',
        text: { content: 'hello' }
      })
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(dw.socketCallBackResponse).toHaveBeenCalledWith('mid-1', { success: true })
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      chatId: 'p2p:staff-001',
      userId: 'staff-001',
      userName: 'Zhang San',
      text: 'hello'
    })

    await adapter.disconnect()
  })

  it('drops inbound messages from non-allowed chats', async () => {
    const adapter = createAdapter({ allowed_chat_ids: ['p2p:other'] })
    const received: any[] = []
    adapter.on('message', (msg: any) => received.push(msg))
    await adapter.connect()

    dwClientInstances[0]._handler?.({
      headers: { messageId: 'mid-2' },
      data: JSON.stringify({
        msgId: 'in-2',
        msgtype: 'text',
        conversationType: '1',
        conversationId: 'conv-2',
        senderId: 'staff-002',
        senderStaffId: 'staff-002',
        sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?token=yyy',
        text: { content: 'sneak' }
      })
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(received).toHaveLength(0)
    await adapter.disconnect()
  })

  it('sendMessage uses the captured session webhook when fresh', async () => {
    const adapter = createAdapter({ allowed_chat_ids: ['group:cid-1'] })
    await adapter.connect()

    // Webhook will respond with { errcode: 0 }.
    fetchMock.mockResolvedValue(jsonResponse({ errcode: 0, errmsg: 'ok' }))

    dwClientInstances[0]._handler?.({
      headers: { messageId: 'mid-3' },
      data: JSON.stringify({
        msgId: 'in-3',
        msgtype: 'text',
        conversationType: '2',
        conversationId: 'cid-1',
        senderId: 'staff-003',
        senderStaffId: 'staff-003',
        sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?token=zzz',
        text: { content: 'hi bot' }
      })
    })
    await new Promise((resolve) => setImmediate(resolve))

    await adapter.sendMessage('group:cid-1', 'reply text')

    expect(fetchMock).toHaveBeenCalled()
    const sendCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).startsWith('https://oapi.dingtalk.com/robot/sendBySession')
    )
    expect(sendCall).toBeDefined()
    const body = JSON.parse((sendCall![1] as { body: string }).body)
    expect(body).toEqual({ msgtype: 'text', text: { content: 'reply text' } })

    await adapter.disconnect()
  })

  it('sendMessage falls back to proactive p2p send when no fresh webhook exists', async () => {
    const adapter = createAdapter({ allowed_chat_ids: ['p2p:staff-x'] })
    await adapter.connect()

    // First call is the access token fetch; second is the proactive send.
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/oauth2/accessToken')) {
        return jsonResponse({ accessToken: 'tok', expireIn: 7200 })
      }
      if (String(url).includes('/oToMessages/batchSend')) {
        return jsonResponse({ processQueryKey: 'pqk-1' })
      }
      return jsonResponse({})
    })

    await adapter.sendMessage('p2p:staff-x', 'proactive hello')

    const proactiveCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/oToMessages/batchSend'))
    expect(proactiveCall).toBeDefined()
    const body = JSON.parse((proactiveCall![1] as { body: string }).body)
    expect(body.userIds).toEqual(['staff-x'])
    expect(body.msgKey).toBe('sampleText')
    expect(JSON.parse(body.msgParam)).toEqual({ content: 'proactive hello' })

    await adapter.disconnect()
  })

  it('rejects sendMessage with malformed chat id', async () => {
    const adapter = createAdapter()
    await adapter.connect()
    await expect(adapter.sendMessage('not-a-valid-id', 'x')).rejects.toThrow(/Invalid DingTalk chat id/)
    await adapter.disconnect()
  })
})
