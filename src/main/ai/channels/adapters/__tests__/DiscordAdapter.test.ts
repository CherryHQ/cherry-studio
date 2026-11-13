import { EventEmitter } from 'node:events'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { t } from '@main/i18n'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

const mockNetFetch = vi.fn()
beforeEach(() => {
  vi.mocked(net.fetch).mockImplementation((...args) => mockNetFetch(...args))
})
const { mockWebSocket } = vi.hoisted(() => ({ mockWebSocket: vi.fn() }))

vi.mock('ws', () => {
  Object.assign(mockWebSocket, { OPEN: 1, CONNECTING: 0, CLOSED: 3, CLOSING: 2 })
  return { default: mockWebSocket, WebSocket: mockWebSocket }
})

import { createDiscordAdapter } from '../discord/DiscordAdapter'

function createAdapter() {
  return createDiscordAdapter({
    channelId: 'ch-discord-1',
    channelType: 'discord',
    agentId: 'agent-1',
    channelConfig: { bot_token: 'token', allowed_channel_ids: [] }
  })
}

describe('DiscordAdapter connection lifecycle', () => {
  beforeEach(() => {
    mockNetFetch.mockReset()
    mockWebSocket.mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  it('aborts a stalled startup request when disconnected', async () => {
    let startupSignal: AbortSignal | undefined
    let rejectStartup!: (error: Error) => void
    mockNetFetch.mockImplementation((_url: string, init?: RequestInit) => {
      startupSignal = init?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        rejectStartup = reject
        startupSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })
    const adapter = createAdapter()

    const connecting = adapter.connect()
    await vi.waitFor(() => expect(mockNetFetch).toHaveBeenCalled())

    const observedSignal = startupSignal
    await adapter.disconnect()
    if (!observedSignal) rejectStartup(new Error('test cleanup'))
    await expect(connecting).resolves.toBeUndefined()
    expect(observedSignal).toBeInstanceOf(AbortSignal)
    expect(mockWebSocket).not.toHaveBeenCalled()
  })
})

class FakeWebSocket extends EventEmitter {
  readyState = 0
  frames: Array<{ op: number; d: unknown }> = []

  open(): void {
    this.readyState = 1
    this.emit('open')
  }

  receive(payload: object): void {
    this.emit('message', Buffer.from(JSON.stringify(payload)))
  }

  send(text: string): void {
    this.frames.push(JSON.parse(text))
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3
    this.emit('close', code, Buffer.from(reason))
  }
}

function ready(socket: FakeWebSocket, seq = 42): void {
  socket.receive({
    op: 0,
    t: 'READY',
    s: seq,
    d: {
      session_id: 'session',
      resume_gateway_url: 'wss://gateway.example',
      user: { id: 'bot', username: 'test-bot' },
      application: { id: 'application' }
    }
  })
}

describe('DiscordAdapter gateway handshake', () => {
  let sockets: FakeWebSocket[]
  let unexpectedFetches: string[]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    sockets = []
    unexpectedFetches = []
    mockWebSocket.mockReset()
    mockWebSocket.mockImplementation(function () {
      const socket = new FakeWebSocket()
      sockets.push(socket)
      return socket
    })
    mockNetFetch.mockReset()
    mockNetFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === 'https://discord.com/api/v10/gateway/bot') {
        return new Response(JSON.stringify({ url: 'wss://gateway.example' }), { status: 200 })
      }
      if (method === 'PUT' && url === 'https://discord.com/api/v10/applications/application/commands') {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      unexpectedFetches.push(`${method} ${url}`)
      throw new Error(`Unexpected fetch: ${method} ${url}`)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    expect(unexpectedFetches).toEqual([])
  })

  it('explicitly requests online presence on a cold IDENTIFY with the existing intents and properties', async () => {
    const adapter = createAdapter()
    try {
      await adapter.connect()
      const socket = sockets[0]
      socket.open()
      socket.receive({ op: 10, d: { heartbeat_interval: 60000 } })

      const identifies = socket.frames.filter((frame) => frame.op === 2)
      expect(identifies).toHaveLength(1)
      const data = identifies[0].d as Record<string, unknown>
      expect(data.presence).toEqual({ since: null, activities: [], status: 'online', afk: false })
      expect(data.token).toBe('token')
      expect(data.intents).toBe(38401)
      expect(data.properties).toEqual({ os: process.platform, browser: 'cherry-studio', device: 'cherry-studio' })
    } finally {
      await adapter.disconnect()
      vi.useRealTimers()
    }
  })

  it('becomes connected only on READY without sending another IDENTIFY or a presence update', async () => {
    const adapter = createAdapter()
    try {
      await adapter.connect()
      expect(adapter.connected).toBe(false)
      const socket = sockets[0]
      socket.open()
      expect(adapter.connected).toBe(false)
      expect(socket.frames).toEqual([])
      socket.receive({ op: 10, d: { heartbeat_interval: 60000 } })
      expect(adapter.connected).toBe(false)

      ready(socket)
      expect(adapter.connected).toBe(true)
      expect(socket.frames.filter((frame) => frame.op === 2)).toHaveLength(1)
      expect(socket.frames.filter((frame) => frame.op === 3)).toEqual([])
    } finally {
      await adapter.disconnect()
      vi.useRealTimers()
    }
  })

  it('explicitly requests online presence on fresh re-identification after the INVALID_SESSION wait', async () => {
    const adapter = createAdapter()
    try {
      await adapter.connect()
      const socket = sockets[0]
      socket.open()
      socket.receive({ op: 10, d: { heartbeat_interval: 60000 } })
      ready(socket)
      socket.receive({ op: 9, d: false })

      await vi.advanceTimersByTimeAsync(2999)
      expect(socket.frames.filter((frame) => frame.op === 2)).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      const identifies = socket.frames.filter((frame) => frame.op === 2)
      expect(identifies).toHaveLength(2)
      expect(socket.frames.filter((frame) => frame.op === 6)).toEqual([])
      const data = identifies[1].d as Record<string, unknown>
      expect(data.presence).toEqual({ since: null, activities: [], status: 'online', afk: false })
      expect(data.token).toBe('token')
      expect(data.intents).toBe(38401)
      expect(data.properties).toEqual({ os: process.platform, browser: 'cherry-studio', device: 'cherry-studio' })
    } finally {
      await adapter.disconnect()
      vi.useRealTimers()
    }
  })

  it.each([42, 0])('resumes the retained session with sequence %i after the reconnect delay', async (seq) => {
    const adapter = createAdapter()
    try {
      await adapter.connect()
      const socket = sockets[0]
      socket.open()
      socket.receive({ op: 10, d: { heartbeat_interval: 60000 } })
      ready(socket, seq)
      expect(adapter.connected).toBe(true)
      socket.close(4000)
      expect(adapter.connected).toBe(false)

      await vi.advanceTimersByTimeAsync(999)
      expect(sockets).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(sockets).toHaveLength(2)
      const replacement = sockets[1]
      replacement.open()
      replacement.receive({ op: 10, d: { heartbeat_interval: 60000 } })
      expect(replacement.frames.filter((frame) => frame.op === 6)).toEqual([
        { op: 6, d: { token: 'token', session_id: 'session', seq } }
      ])
      expect(replacement.frames.filter((frame) => frame.op === 2 || frame.op === 3)).toEqual([])
      expect(adapter.connected).toBe(false)

      replacement.receive({ op: 0, t: 'RESUMED', s: seq, d: {} })
      expect(adapter.connected).toBe(true)
      expect(replacement.frames).toEqual([{ op: 6, d: { token: 'token', session_id: 'session', seq } }])
    } finally {
      await adapter.disconnect()
      vi.useRealTimers()
    }
  })

  it('sends the last sequence on a server heartbeat request and preserves the first heartbeat jitter', async () => {
    const adapter = createAdapter()
    try {
      await adapter.connect()
      const socket = sockets[0]
      socket.open()
      socket.receive({ op: 10, d: { heartbeat_interval: 60000 } })
      ready(socket)

      await vi.advanceTimersByTimeAsync(29999)
      expect(socket.frames.filter((frame) => frame.op === 1)).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(socket.frames.filter((frame) => frame.op === 1)).toEqual([{ op: 1, d: 42 }])

      socket.receive({ op: 0, t: 'IGNORED', s: 43, d: {} })
      socket.receive({ op: 1, d: null })
      expect(socket.frames.filter((frame) => frame.op === 1)).toEqual([
        { op: 1, d: 42 },
        { op: 1, d: 43 }
      ])
    } finally {
      await adapter.disconnect()
      vi.useRealTimers()
    }
  })
})

it('clears a withdrawn draft while keeping the same Discord message for resumed content', async () => {
  vi.useFakeTimers()
  const adapter = createAdapter()
  mockNetFetch.mockReset()
  mockNetFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'draft' }), { status: 200 }))
  const calls = (method: string) =>
    mockNetFetch.mock.calls
      .filter((call) => call[1].method === method)
      .map((call) => ({ url: call[0], body: JSON.parse(call[1].body) }))
  try {
    await adapter.onTextUpdate('channel:test', '')
    expect(calls('POST')).toEqual([])
    await adapter.onTextUpdate('channel:test', 'Withdrawn')
    await vi.advanceTimersByTimeAsync(2000)
    await adapter.onTextUpdate('channel:test', '')
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls('PATCH').at(-1)).toMatchObject({
      url: expect.stringContaining('/draft'),
      body: { content: t('common.channel_processing') }
    })
    await adapter.onTextUpdate('channel:test', 'Replacement')
    await vi.advanceTimersByTimeAsync(2000)
    await adapter.onStreamComplete('channel:test', 'Final')
    expect(calls('POST')).toHaveLength(1)
    expect(calls('PATCH').at(-1)).toMatchObject({ url: expect.stringContaining('/draft'), body: { content: 'Final' } })
  } finally {
    await adapter.disconnect()
    vi.useRealTimers()
  }
})
