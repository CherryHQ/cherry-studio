import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../../ChannelManager', () => ({
  registerAdapterFactory: vi.fn()
}))

const { mockNetFetch, mockWebSocket } = vi.hoisted(() => ({
  mockNetFetch: vi.fn(),
  mockWebSocket: vi.fn()
}))
vi.mock('electron', () => ({
  net: { fetch: (...args: unknown[]) => mockNetFetch(...args) }
}))

vi.mock('ws', () => {
  Object.assign(mockWebSocket, { OPEN: 1, CONNECTING: 0, CLOSED: 3, CLOSING: 2 })
  return { default: mockWebSocket, WebSocket: mockWebSocket }
})

import '../discord/DiscordAdapter'
import { registerAdapterFactory } from '../../ChannelManager'

const discordCall = vi.mocked(registerAdapterFactory).mock.calls.find((call) => call[0] === 'discord')
if (!discordCall) throw new Error('registerAdapterFactory was not called for discord')
const discordFactory = discordCall[1] as (channel: any, agentId: string) => any

function createAdapter() {
  return discordFactory(
    {
      id: 'ch-discord-1',
      type: 'discord',
      enabled: true,
      config: { bot_token: 'token', allowed_channel_ids: [] }
    },
    'agent-1'
  )
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
