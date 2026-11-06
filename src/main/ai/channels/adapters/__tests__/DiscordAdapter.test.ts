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

function createAdapter(): any {
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
    vi.useRealTimers()
  }
})
