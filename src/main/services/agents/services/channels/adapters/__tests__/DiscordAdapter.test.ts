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

const mockNetFetch = vi.fn()

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/userData' },
  nativeTheme: { themeSource: '', shouldUseDarkColors: false },
  net: { fetch: (...args: unknown[]) => mockNetFetch(...args) }
}))

class MockWebSocket extends EventEmitter {
  static OPEN = 1
  static CONNECTING = 0
  readyState = 1
  send = vi.fn()
  close = vi.fn()
  ping = vi.fn()
}

vi.mock('ws', () => {
  const Ctor = vi.fn().mockImplementation(() => new MockWebSocket())
  Object.assign(Ctor, { OPEN: 1, CONNECTING: 0, CLOSED: 3, CLOSING: 2 })
  return { default: Ctor, WebSocket: Ctor }
})

import '../discord/DiscordAdapter'

import { registerAdapterFactory } from '../../ChannelManager'

function getFactory() {
  const calls = vi.mocked(registerAdapterFactory).mock.calls
  const discordCall = calls.find((c) => c[0] === 'discord')
  if (!discordCall) throw new Error('registerAdapterFactory was not called for discord')
  return discordCall[1] as (channel: any, agentId: string) => any
}

function mockJsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data))
  } as unknown as Response
}

describe('DiscordAdapter streaming', () => {
  let postedMessageIds: number
  let postBodies: string[]
  let patchBodies: Array<{ messageId: string; content: string }>

  beforeEach(() => {
    mockNetFetch.mockReset()
    postedMessageIds = 0
    postBodies = []
    patchBodies = []

    mockNetFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET'
      // POST /channels/:id/messages — create a message
      if (method === 'POST' && /\/channels\/[^/]+\/messages$/.test(url)) {
        const body = init?.body ? JSON.parse(init.body) : {}
        postBodies.push(body.content ?? '')
        postedMessageIds += 1
        return Promise.resolve(mockJsonResponse({ id: `msg-${postedMessageIds}` }))
      }
      // PATCH /channels/:id/messages/:messageId — edit a message
      const editMatch = /\/channels\/[^/]+\/messages\/([^/]+)$/.exec(url)
      if (method === 'PATCH' && editMatch) {
        const body = init?.body ? JSON.parse(init.body) : {}
        patchBodies.push({ messageId: editMatch[1], content: body.content ?? '' })
        return Promise.resolve(mockJsonResponse({}))
      }
      return Promise.resolve(mockJsonResponse({}))
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createAdapter() {
    const factory = getFactory()
    return factory(
      {
        id: 'ch-discord-1',
        type: 'discord',
        enabled: true,
        config: {
          bot_token: 'bot-test-token',
          allowed_channel_ids: ['channel:1234567890']
        }
      },
      'agent-1'
    )
  }

  it('registers itself as a discord adapter factory', () => {
    expect(getFactory()).toBeTypeOf('function')
  })

  it('onStreamComplete with content under 2000 chars edits a single message', async () => {
    const adapter = createAdapter()
    const chatId = 'channel:1234567890'

    await adapter.onTextUpdate(chatId, 'short reply')
    const result = await adapter.onStreamComplete(chatId, 'short reply final')

    expect(result).toBe(true)
    // One message created, one final edit
    expect(postBodies.length).toBe(1)
    expect(patchBodies[patchBodies.length - 1].content).toBe('short reply final')
  })

  it('onStreamComplete splits a long final message across multiple Discord messages', async () => {
    const adapter = createAdapter()
    const chatId = 'channel:1234567890'

    // Build ~5500-char text with paragraph breaks so split has clean boundaries.
    const paragraph = 'A'.repeat(900)
    const longText = Array.from({ length: 6 }, () => paragraph).join('\n\n')
    expect(longText.length).toBeGreaterThan(2000 * 2)

    await adapter.onTextUpdate(chatId, 'starting...')
    const result = await adapter.onStreamComplete(chatId, longText)

    expect(result).toBe(true)
    // Should have created at least 3 messages to fit ~5500 chars at 2000/msg.
    expect(postBodies.length).toBeGreaterThanOrEqual(3)
    // Each posted/edited content must respect the 2000 char limit.
    for (const content of postBodies) expect(content.length).toBeLessThanOrEqual(2000)
    for (const { content } of patchBodies) expect(content.length).toBeLessThanOrEqual(2000)
  })

  it('onStreamError appends error text and may roll over to a new message', async () => {
    const adapter = createAdapter()
    const chatId = 'channel:1234567890'

    // Fill close to the limit so the appended error pushes us into a second message.
    const nearLimit = 'B'.repeat(1990)
    await adapter.onTextUpdate(chatId, nearLimit)
    await adapter.onStreamError(chatId, 'Boom')

    // At least the original message; possibly a follow-up holding the error tail.
    expect(postBodies.length).toBeGreaterThanOrEqual(1)
    const allWritten = [...postBodies, ...patchBodies.map((p) => p.content)].join('\n')
    expect(allWritten).toContain('Error')
    expect(allWritten).toContain('Boom')
  })

  it('onStreamComplete returns false when there is no streaming session', async () => {
    const adapter = createAdapter()
    const result = await adapter.onStreamComplete('channel:9999', 'final')
    expect(result).toBe(false)
  })
})
