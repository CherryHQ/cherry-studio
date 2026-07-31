import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../../ChannelManager', () => ({
  registerAdapterFactory: vi.fn()
}))

const mockNetFetch = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: () => '/mock/userData' },
  net: { fetch: (...args: unknown[]) => mockNetFetch(...args) }
}))

vi.mock('ws', () => {
  const Ctor = vi.fn()
  Object.assign(Ctor, { OPEN: 1, CONNECTING: 0, CLOSED: 3, CLOSING: 2 })
  return { default: Ctor, WebSocket: Ctor }
})

import '../qq/QqAdapter'
import { registerAdapterFactory } from '../../ChannelManager'

// Capture the factory at module load — `registerAdapterFactory('qq', …)` runs once on import,
// and afterEach's restoreAllMocks would otherwise wipe that call history before later tests.
const qqCall = vi.mocked(registerAdapterFactory).mock.calls.find((c) => c[0] === 'qq')
if (!qqCall) throw new Error('registerAdapterFactory was not called for qq')
const qqFactory = qqCall[1] as (channel: any, agentId: string) => any

function mockBinaryResponse(buf: Buffer, contentType = 'image/png'): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType }),
    arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  } as unknown as Response
}

function mockOkJson(): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve('{}'),
    json: () => Promise.resolve({})
  } as unknown as Response
}

function groupMessage(id: string, groupOpenid = 'g1', content = 'hi'): any {
  return {
    id,
    author: { member_openid: 'm1', id: 'a1', username: 'u' },
    content,
    timestamp: '',
    group_openid: groupOpenid
  }
}

function createAdapter() {
  return qqFactory(
    { id: 'ch-qq-1', type: 'qq', enabled: true, config: { app_id: 'app', client_secret: 'sec', allowed_chat_ids: [] } },
    'agent-1'
  )
}

describe('QqAdapter.downloadAttachments', () => {
  beforeEach(() => mockNetFetch.mockReset())
  afterEach(() => vi.restoreAllMocks())

  it('rejects an SSRF target before any (token-bearing) fetch (C8)', async () => {
    const adapter = createAdapter()
    vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')

    const result = await adapter.downloadAttachments([
      { url: 'http://169.254.169.254/latest/meta-data/', content_type: 'image/png', filename: 'meta' }
    ])

    expect(result).toEqual({})
    expect(mockNetFetch).not.toHaveBeenCalled()
  })

  it('downloads a public attachment URL', async () => {
    const adapter = createAdapter()
    vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')
    mockNetFetch.mockResolvedValue(mockBinaryResponse(Buffer.from('img'), 'image/png'))

    const result = await adapter.downloadAttachments([
      { url: 'https://gchat.qpic.cn/a.png', content_type: 'image/png', filename: 'a.png' }
    ])

    expect(result.images).toHaveLength(1)
    expect(mockNetFetch).toHaveBeenCalled()
  })
})

describe('QqAdapter passive reply', () => {
  beforeEach(() => mockNetFetch.mockReset())
  afterEach(() => vi.restoreAllMocks())

  function capturePostBodies(): any[] {
    const bodies: any[] = []
    mockNetFetch.mockImplementation((_url: string, init?: any) => {
      if (init?.method === 'POST' && typeof init.body === 'string') bodies.push(JSON.parse(init.body))
      return Promise.resolve(mockOkJson())
    })
    return bodies
  }

  it('replies to a group message passively with the inbound msg_id and msg_seq', async () => {
    const adapter = createAdapter()
    vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')
    const bodies = capturePostBodies()

    await adapter.handleGroupMessage(groupMessage('inbound-1'))
    await adapter.sendMessage('group:g1', 'reply', { replyToMessageId: 'inbound-1' })

    expect(bodies).toHaveLength(1)
    expect(bodies[0].msg_id).toBe('inbound-1')
    expect(bodies[0].msg_seq).toBe(1)
  })

  it('increments msg_seq across replies so chunks are not deduped', async () => {
    const adapter = createAdapter()
    vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')
    const bodies = capturePostBodies()

    await adapter.handleGroupMessage(groupMessage('inbound-1'))
    await adapter.sendMessage('group:g1', 'first', { replyToMessageId: 'inbound-1' })
    await adapter.sendMessage('group:g1', 'second', { replyToMessageId: 'inbound-1' })

    expect(bodies.map((b) => b.msg_seq)).toEqual([1, 2])
    expect(bodies.every((b) => b.msg_id === 'inbound-1')).toBe(true)
  })

  it('replies against the answered msg_id, not the latest inbound for the chat', async () => {
    const adapter = createAdapter()
    vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')
    const bodies = capturePostBodies()

    // Two inbound messages arrive; the reply to the first must not bind to the second.
    await adapter.handleGroupMessage(groupMessage('inbound-1'))
    await adapter.handleGroupMessage(groupMessage('inbound-2'))
    await adapter.sendMessage('group:g1', 'answer to first', { replyToMessageId: 'inbound-1' })

    expect(bodies).toHaveLength(1)
    expect(bodies[0].msg_id).toBe('inbound-1')
    expect(bodies[0].msg_seq).toBe(1)
    // inbound-2's slot is untouched.
    expect(adapter.passiveReplies.get('group:g1:inbound-2').seq).toBe(0)
  })

  it('emits the inbound messageId on the message event', async () => {
    const adapter = createAdapter()
    const events: any[] = []
    adapter.on('message', (e: any) => events.push(e))

    await adapter.handleGroupMessage(groupMessage('inbound-1'))

    expect(events).toHaveLength(1)
    expect(events[0].messageId).toBe('inbound-1')
  })

  it('keeps the C2C passive window open for 60 minutes (longer than group)', async () => {
    const adapter = createAdapter()
    vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')
    const bodies = capturePostBodies()

    await adapter.handleC2CMessage({
      id: 'inbound-c2c',
      author: { user_openid: 'u1', id: 'a1', username: 'u' },
      content: 'hi',
      timestamp: ''
    })
    // 10 min in: would be expired for a group, still valid for C2C.
    adapter.passiveReplies.get('c2c:u1:inbound-c2c').receivedAt = Date.now() - 10 * 60 * 1000

    await adapter.sendMessage('c2c:u1', 'reply', { replyToMessageId: 'inbound-c2c' })

    expect(bodies).toHaveLength(1)
    expect(bodies[0].msg_id).toBe('inbound-c2c')
    expect(bodies[0].msg_seq).toBe(1)
  })

  it('drops the passive context once the 5-minute group window lapses', async () => {
    const adapter = createAdapter()
    vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')
    const bodies = capturePostBodies()

    await adapter.handleGroupMessage(groupMessage('inbound-1'))
    adapter.passiveReplies.get('group:g1:inbound-1').receivedAt = Date.now() - 6 * 60 * 1000

    await adapter.sendMessage('group:g1', 'late reply', { replyToMessageId: 'inbound-1' })

    expect(bodies).toHaveLength(1)
    expect(bodies[0].msg_id).toBeUndefined()
    expect(bodies[0].msg_seq).toBeUndefined()
    expect(adapter.passiveReplies.has('group:g1:inbound-1')).toBe(false)
  })

  it('stops passive replies after the 5-per-msg_id cap and falls back to active push', async () => {
    const adapter = createAdapter()
    vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')
    const bodies = capturePostBodies()

    await adapter.handleGroupMessage(groupMessage('inbound-1'))
    // 6 separate passive sends against the same msg_id; QQ allows only 5.
    for (let i = 0; i < 6; i++) {
      await adapter.sendMessage('group:g1', `chunk ${i}`, { replyToMessageId: 'inbound-1' })
    }

    expect(bodies.map((b) => b.msg_seq)).toEqual([1, 2, 3, 4, 5, undefined])
    expect(bodies[5].msg_id).toBeUndefined()
    expect(adapter.passiveReplies.has('group:g1:inbound-1')).toBe(false)
  })
})

describe('ChannelAdapter.sendFile default', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rejects with the channel type for adapters that inherit the base default (QQ)', async () => {
    const adapter = createAdapter()
    const file = { filename: 'a.txt', data: 'eA==', media_type: 'text/plain', size: 1 }

    await expect(adapter.sendFile('100', file)).rejects.toThrow('Channel type "qq" does not support sending files')
  })
})

describe('QqAdapter GROUP_MESSAGE_CREATE handling', () => {
  afterEach(() => vi.restoreAllMocks())

  function createAdapterWithConfig(config: Record<string, unknown>) {
    return qqFactory(
      {
        id: 'ch-qq-1',
        type: 'qq',
        enabled: true,
        config: { app_id: 'app', client_secret: 'sec', allowed_chat_ids: [], ...config }
      },
      'agent-1'
    )
  }

  it('mention_only=true (default): discards all GROUP_MESSAGE_CREATE events', async () => {
    const adapter = createAdapter()
    const events: any[] = []
    adapter.on('message', (e: any) => events.push(e))

    await adapter.handleGroupFullMessage(groupMessage('full-1'))

    expect(events).toHaveLength(0)
  })

  it('mention_only=false: processes GROUP_MESSAGE_CREATE and emits message event', async () => {
    const adapter = createAdapterWithConfig({ mention_only: false })
    const events: any[] = []
    adapter.on('message', (e: any) => events.push(e))

    await adapter.handleGroupFullMessage(groupMessage('full-1', 'g1', 'hey everyone'))

    expect(events).toHaveLength(1)
    expect(events[0].messageId).toBe('full-1')
    expect(events[0].text).toBe('hey everyone')
  })

  it('mention_only=false: dedup—AT event then FULL event with same msg.id emits once', async () => {
    const adapter = createAdapterWithConfig({ mention_only: false })
    const events: any[] = []
    adapter.on('message', (e: any) => events.push(e))

    // Real routing through handleDispatch: AT arrives first, then the FULL twin.
    await adapter.handleDispatch('GROUP_AT_MESSAGE_CREATE', groupMessage('dup-1', 'g1', 'hello'))
    await adapter.handleDispatch('GROUP_MESSAGE_CREATE', groupMessage('dup-1', 'g1', 'hello'))

    expect(events).toHaveLength(1)
    expect(events[0].messageId).toBe('dup-1')
  })

  it('mention_only=false: dedup—FULL event then AT event with same msg.id emits once', async () => {
    const adapter = createAdapterWithConfig({ mention_only: false })
    const events: any[] = []
    adapter.on('message', (e: any) => events.push(e))

    // Real routing through handleDispatch: FULL arrives first, then the AT twin.
    await adapter.handleDispatch('GROUP_MESSAGE_CREATE', groupMessage('dup-2', 'g1', 'hello'))
    await adapter.handleDispatch('GROUP_AT_MESSAGE_CREATE', groupMessage('dup-2', 'g1', 'hello'))

    expect(events).toHaveLength(1)
    expect(events[0].messageId).toBe('dup-2')
  })

  it('mention_only=false: still respects allowed_chat_ids filter', async () => {
    const adapter = createAdapterWithConfig({ mention_only: false, allowed_chat_ids: ['group:g-whitelist'] })
    const events: any[] = []
    adapter.on('message', (e: any) => events.push(e))

    await adapter.handleDispatch('GROUP_MESSAGE_CREATE', groupMessage('full-1', 'g-other', 'hi'))

    expect(events).toHaveLength(0)
  })

  it('routing: mention_only=true (default) — AT processed, FULL dropped, via handleDispatch', async () => {
    const adapter = createAdapter()
    const events: any[] = []
    adapter.on('message', (e: any) => events.push(e))

    await adapter.handleDispatch('GROUP_MESSAGE_CREATE', groupMessage('m-1', 'g1', 'hi'))
    expect(events).toHaveLength(0)

    await adapter.handleDispatch('GROUP_AT_MESSAGE_CREATE', groupMessage('m-1', 'g1', 'hi @bot'))
    expect(events).toHaveLength(1)
    expect(events[0].messageId).toBe('m-1')
  })

  it('rollback: FULL fails → AT retries the same message successfully', async () => {
    const adapter = createAdapterWithConfig({ mention_only: false })
    const events: any[] = []
    adapter.on('message', (e: any) => events.push(e))

    // First copy fails (e.g. transient download error) — the dedup mark must be rolled back.
    vi.spyOn(adapter, 'processMessage').mockRejectedValueOnce(new Error('download failed'))
    await expect(adapter.handleDispatch('GROUP_MESSAGE_CREATE', groupMessage('rb-1', 'g1', 'hello'))).rejects.toThrow(
      'download failed'
    )

    // Twin AT event arrives — the mark was rolled back, so this copy processes.
    await adapter.handleDispatch('GROUP_AT_MESSAGE_CREATE', groupMessage('rb-1', 'g1', 'hello'))

    expect(events).toHaveLength(1)
    expect(events[0].messageId).toBe('rb-1')
  })

  it('dedup cap: 501 marks → map stays at 500, oldest evicted', () => {
    vi.useFakeTimers()
    try {
      const adapter = createAdapterWithConfig({ mention_only: false })
      for (let i = 0; i < 501; i++) adapter.markSeen(`cap-${i}`)
      expect(adapter.seenMsgIds.size).toBe(500)
      expect(adapter.wasSeen('cap-0')).toBe(false) // oldest evicted by the cap
      expect(adapter.wasSeen('cap-500')).toBe(true) // newest still present
    } finally {
      vi.useRealTimers()
    }
  })

  it('parseContent strips alphanumeric mentions of other users', () => {
    const adapter = createAdapter()
    expect(adapter.parseContent('hi <@!A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4> how are you')).toBe('hi how are you')
    expect(adapter.parseContent('@bot hello')).toBe('@bot hello') // non-bracket text untouched
  })
})
