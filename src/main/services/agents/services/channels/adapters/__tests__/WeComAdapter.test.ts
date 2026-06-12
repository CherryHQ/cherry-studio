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
    getVersion: () => '0.0.0-test',
    getPath: () => '/mock/userData'
  },
  nativeTheme: { themeSource: '', shouldUseDarkColors: false },
  net: { fetch: vi.fn() }
}))

vi.mock('../../../../../WindowService', () => ({
  windowService: {
    getMainWindow: () => null
  }
}))

// Import to trigger self-registration side effect.
import '../wecom/WeComAdapter'

import { net } from 'electron'

import { registerAdapterFactory } from '../../ChannelManager'
import { genReqId, sign, WeComClient } from '../wecom/WeComClient'

function getFactory() {
  const call = vi.mocked(registerAdapterFactory).mock.calls.find((c) => c[0] === 'wecom')
  if (!call) throw new Error('registerAdapterFactory was not called for wecom')
  return call[1] as (channel: any, agentId: string) => any
}

function bizPayload(payload: Record<string, unknown>): { result: { content: [{ type: 'text'; text: string }] } } {
  return { result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as unknown as Response
}

describe('WeComClient signature', () => {
  it('concatenates inputs as secret + bot_id + time + nonce', () => {
    // wecom-cli src/mcp/config.rs:99 — sign = sha256(secret + bot_id + time + nonce).
    // sha256("secbot100nonce") = 6e8a64...; verify the same node:crypto result matches.
    const expected = require('node:crypto').createHash('sha256').update('secbot100nonce').digest('hex')
    expect(sign('sec', 'bot', 100, 'nonce')).toBe(expected)
  })

  it('is deterministic and varies with inputs', () => {
    expect(sign('sec', 'bot', 100, 'nonce')).toBe(sign('sec', 'bot', 100, 'nonce'))
    expect(sign('sec', 'bot', 100, 'nonce')).toHaveLength(64)
    expect(sign('sec', 'bot', 100, 'nonce1')).not.toBe(sign('sec', 'bot', 100, 'nonce2'))
  })

  it('genReqId follows {prefix}_{ts}_{8hex} format', () => {
    const id = genReqId('mcp')
    expect(id).toMatch(/^mcp_\d+_[0-9a-f]{8}$/)
  })
})

describe('WeComClient HTTP', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.mocked(net.fetch)
    fetchMock.mockReset()
  })

  it('bootstrap caches per-category URLs', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        errcode: 0,
        list: [
          { biz_type: 'msg', url: 'https://example.com/msg', type: 'streamable-http', is_authed: true },
          { biz_type: 'contact', url: 'https://example.com/contact' }
        ]
      })
    )
    const client = new WeComClient({ botId: 'bot', botSecret: 'sec' })
    const list = await client.bootstrap()
    expect(list).toHaveLength(2)
    expect(client.isBootstrapped()).toBe(true)
  })

  it('bootstrap throws WeComBusinessError on errcode !== 0', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40029, errmsg: 'invalid signature' }))
    const client = new WeComClient({ botId: 'bot', botSecret: 'wrong' })
    await expect(client.bootstrap()).rejects.toThrow(/Bootstrap failed.*invalid signature.*errcode=40029/)
  })

  it('callTool unwraps JSON-RPC content[0].text and parses business JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errcode: 0, list: [{ biz_type: 'msg', url: 'https://example.com/msg' }] })
    )
    const client = new WeComClient({ botId: 'bot', botSecret: 'sec' })
    await client.bootstrap()

    fetchMock.mockResolvedValueOnce(jsonResponse(bizPayload({ errcode: 0, errmsg: 'ok' })))
    const res = await client.callTool('msg', 'send_message', { x: 1 })
    expect(res).toEqual({ errcode: 0, errmsg: 'ok' })

    // Verify the request envelope was a tools/call JSON-RPC.
    const [, init] = fetchMock.mock.calls[1]
    const body = JSON.parse((init as { body: string }).body)
    expect(body.jsonrpc).toBe('2.0')
    expect(body.method).toBe('tools/call')
    expect(body.params).toEqual({ name: 'send_message', arguments: { x: 1 } })
  })

  it('callTool throws business error when inner errcode !== 0', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errcode: 0, list: [{ biz_type: 'msg', url: 'https://example.com/msg' }] })
    )
    const client = new WeComClient({ botId: 'bot', botSecret: 'sec' })
    await client.bootstrap()

    fetchMock.mockResolvedValueOnce(jsonResponse(bizPayload({ errcode: 60011, errmsg: 'no permission' })))
    await expect(client.callTool('msg', 'send_message', {})).rejects.toThrow(/errcode=60011/)
  })
})

describe('WeComAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.mocked(net.fetch)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createAdapter(overrides: Record<string, unknown> = {}) {
    const factory = getFactory()
    return factory(
      {
        id: (overrides.channelId as string) ?? 'ch-1',
        type: 'wecom',
        enabled: true,
        config: {
          bot_id: (overrides.bot_id as string) ?? 'BOT_ID',
          bot_secret: (overrides.bot_secret as string) ?? 'BOT_SECRET',
          allowed_chat_ids: (overrides.allowed_chat_ids as string[]) ?? []
        }
      },
      (overrides.agentId as string) ?? 'agent-1'
    )
  }

  function mockBootstrap() {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errcode: 0, list: [{ biz_type: 'msg', url: 'https://example.com/msg' }] })
    )
  }

  it('checkReady returns true only when bot_id and bot_secret are present', async () => {
    const empty = createAdapter({ bot_id: '', bot_secret: '' })
    // protected method — access via prototype
    expect(await empty.checkReady()).toBe(false)

    const ok = createAdapter()
    expect(await ok.checkReady()).toBe(true)
  })

  it('connect bootstraps then starts polling', async () => {
    mockBootstrap()
    // First poll: get_message returns no messages.
    fetchMock.mockResolvedValueOnce(jsonResponse(bizPayload({ errcode: 0, messages: [] })))

    const adapter = createAdapter({ allowed_chat_ids: ['1:zhangsan'] })
    await adapter.connect()

    expect(adapter.connected).toBe(true)
    // bootstrap + first immediate poll
    await new Promise((resolve) => setImmediate(resolve))
    expect(fetchMock).toHaveBeenCalled()
    await adapter.disconnect()
  })

  it('sendMessage chunks long text and serializes WeCom args', async () => {
    mockBootstrap()
    // First poll (no messages) + send_message calls
    fetchMock.mockResolvedValue(jsonResponse(bizPayload({ errcode: 0, messages: [] })))

    const adapter = createAdapter({ allowed_chat_ids: ['1:zhangsan'] })
    await adapter.connect()

    await adapter.sendMessage('2:wrxxxx', 'hello world')

    const sendCall = fetchMock.mock.calls.find((c) => {
      try {
        const body = JSON.parse((c[1] as { body?: string }).body ?? '{}')
        return body?.params?.name === 'send_message'
      } catch {
        return false
      }
    })
    expect(sendCall).toBeDefined()
    const body = JSON.parse((sendCall![1] as { body: string }).body)
    expect(body.params.arguments).toEqual({
      chat_type: 2,
      chatid: 'wrxxxx',
      msgtype: 'text',
      text: { content: 'hello world' }
    })

    await adapter.disconnect()
  })

  it('skips invalid allowed_chat_ids gracefully', async () => {
    mockBootstrap()
    const adapter = createAdapter({ allowed_chat_ids: ['malformed', '3:bad-type'] })
    await adapter.connect()
    // No additional fetch calls beyond bootstrap — invalid ids are dropped
    await new Promise((resolve) => setImmediate(resolve))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await adapter.disconnect()
  })

  it('suppresses echoes of recently sent outgoing text', async () => {
    mockBootstrap()
    // Stub all subsequent fetches (poll + send) with empty success.
    fetchMock.mockResolvedValue(jsonResponse(bizPayload({ errcode: 0, messages: [] })))

    const adapter = createAdapter({ allowed_chat_ids: ['1:zhangsan'] })
    await adapter.connect()
    await adapter.sendMessage('1:zhangsan', 'echo me')

    expect(adapter.isEcho('echo me')).toBe(true)
    expect(adapter.isEcho('different')).toBe(false)

    await adapter.disconnect()
  })
})
