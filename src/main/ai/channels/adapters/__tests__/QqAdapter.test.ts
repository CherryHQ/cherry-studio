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
    await adapter.sendMessage('group:g1', 'reply')

    expect(bodies).toHaveLength(1)
    expect(bodies[0].msg_id).toBe('inbound-1')
    expect(bodies[0].msg_seq).toBe(1)
  })

  it('increments msg_seq across replies so chunks are not deduped', async () => {
    const adapter = createAdapter()
    vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')
    const bodies = capturePostBodies()

    await adapter.handleGroupMessage(groupMessage('inbound-1'))
    await adapter.sendMessage('group:g1', 'first')
    await adapter.sendMessage('group:g1', 'second')

    expect(bodies.map((b) => b.msg_seq)).toEqual([1, 2])
    expect(bodies.every((b) => b.msg_id === 'inbound-1')).toBe(true)
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
    adapter.passiveReplies.get('c2c:u1').receivedAt = Date.now() - 10 * 60 * 1000

    await adapter.sendMessage('c2c:u1', 'reply')

    expect(bodies).toHaveLength(1)
    expect(bodies[0].msg_id).toBe('inbound-c2c')
    expect(bodies[0].msg_seq).toBe(1)
  })

  it('drops the passive context once the 5-minute group window lapses', async () => {
    const adapter = createAdapter()
    vi.spyOn(adapter, 'getAccessToken').mockResolvedValue('tok')
    const bodies = capturePostBodies()

    await adapter.handleGroupMessage(groupMessage('inbound-1'))
    const entry = adapter.passiveReplies.get('group:g1')
    entry.receivedAt = Date.now() - 6 * 60 * 1000

    await adapter.sendMessage('group:g1', 'late reply')

    expect(bodies).toHaveLength(1)
    expect(bodies[0].msg_id).toBeUndefined()
    expect(bodies[0].msg_seq).toBeUndefined()
    expect(adapter.passiveReplies.has('group:g1')).toBe(false)
  })
})
