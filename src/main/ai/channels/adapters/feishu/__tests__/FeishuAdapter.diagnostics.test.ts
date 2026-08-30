/**
 * Diagnostics contract for the Feishu adapter (#18336): policy rejections must
 * surface as warn-level channel logs with an actionable hint, the connect log
 * must state the active inbound policy, and the adapter must not report
 * "connected" while the SDK is reconnecting a dead socket.
 *
 * The Lark SDK is mocked at module level with a controllable fake channel; the
 * adapter under test is the real one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const handlers: Record<string, ((...args: unknown[]) => void) | undefined> = {}
  const channel = {
    on(map: Record<string, (...args: unknown[]) => void>) {
      Object.assign(handlers, map)
    },
    async connect() {},
    async disconnect() {},
    rawWsClient: null
  }
  return { handlers, channel, createdWith: null as unknown as Record<string, unknown> }
})

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Domain: { Lark: 'https://open.larksuite.com', Feishu: 'https://open.feishu.cn' },
  LoggerLevel: { info: 'info' },
  createLarkChannel: (config: Record<string, unknown>) => {
    fake.createdWith = config
    return fake.channel
  }
}))

vi.mock('file-type', () => ({ fileTypeFromBuffer: async () => undefined }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    IpcApiService: { broadcastToType: vi.fn() }
  } as never)
})

import { FeishuAdapter } from '../FeishuAdapter'
import type { ChannelLogEntry } from '../../../types'
import type { ChannelStatusEvent } from '../../../types'

function buildAdapter(): FeishuAdapter {
  return new FeishuAdapter({
    channelId: 'channel-1',
    channelType: 'feishu',
    agentId: 'agent-1',
    channelConfig: {
      app_id: 'app',
      app_secret: 'secret',
      encrypt_key: '',
      verification_token: '',
      allowed_chat_ids: [],
      domain: 'feishu'
    }
  })
}

describe('Feishu adapter diagnostics (#18336)', () => {
  let adapter: FeishuAdapter
  let logs: ChannelLogEntry[]
  let statuses: ChannelStatusEvent[]

  beforeEach(async () => {
    fake.handlers.message = undefined
    fake.handlers.reject = undefined
    fake.handlers.reconnecting = undefined
    fake.handlers.reconnected = undefined
    adapter = buildAdapter()
    logs = []
    statuses = []
    adapter.on('log', (event) => logs.push(event))
    adapter.on('statusChange', (event) => statuses.push(event))
    await adapter.connect()
  })

  afterEach(async () => {
    await adapter.disconnect()
  })

  it('logs the active inbound policy on connect', () => {
    expect(adapter.connected).toBe(true)
    const connectLog = logs.find((event) => event.message.includes('Feishu bot connected'))
    expect(connectLog).toBeDefined()
    expect(connectLog?.message).toContain('requireMention')
    expect(fake.createdWith?.policy).toMatchObject({ dmMode: 'open', requireMention: true })
  })

  it('surfaces policy rejections as warn logs with hint and counters', () => {
    fake.handlers.reject!({ messageId: 'm1', chatId: 'c1', senderId: 'u1', reason: 'no_mention' })

    const rejectLog = logs.find((event) => event.message.includes('Feishu message rejected'))
    expect(rejectLog?.level).toBe('warn')
    expect(rejectLog?.message).toContain('no_mention')
    // the hint makes the silent failure actionable (#18336's core complaint)
    expect(rejectLog?.message).toContain('@mention')

    fake.handlers.reject!({ messageId: 'm2', chatId: 'c1', senderId: 'u1', reason: 'dm_disabled' })
    const second = logs.filter((event) => event.message.includes('Feishu message rejected'))
    expect(second).toHaveLength(2)
    expect(second[1].message).toContain('direct messages are disabled')
  })

  it('stays connected during a transparent reconnect, but stops reporting connected past the grace window', async () => {
    vi.useFakeTimers()
    try {
      expect(adapter.connected).toBe(true)

      // Deliberate design: streams stay alive while the SDK retries.
      fake.handlers.reconnecting!()
      expect(adapter.connected).toBe(true)

      // Grace window elapses without a successful reconnect.
      vi.advanceTimersByTime(5 * 60_000 + 1000)
      expect(adapter.connected).toBe(false)
      expect(statuses.at(-1)?.connected).toBe(false)

      // A late reconnect still recovers the status.
      fake.handlers.reconnected!()
      expect(adapter.connected).toBe(true)
      expect(statuses.at(-1)?.connected).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('still counts accepted messages separately from rejections', () => {
    // an accepted (but content-empty) message first, then a rejection: the
    // running counters must appear in the reject log
    fake.handlers.message!({
      messageId: 'm2',
      chatId: 'c1',
      senderId: 'u1',
      content: '   ',
      resources: []
    })
    fake.handlers.reject!({ messageId: 'm1', chatId: 'c1', senderId: 'u1', reason: 'no_mention' })

    const rejectLog = logs.find((event) => event.message.includes('Feishu message rejected'))
    expect(rejectLog?.message).toContain('accepted=1')
  })
})
