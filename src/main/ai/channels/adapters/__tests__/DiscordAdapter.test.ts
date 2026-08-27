import { beforeEach, expect, it, vi } from 'vitest'

const downloads = vi.hoisted(() => ({ image: vi.fn(), file: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@main/utils/downloadAsBase64', () => ({
  downloadImageAsBase64: downloads.image,
  downloadFileAsBase64: downloads.file,
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024
}))

vi.mock('../../ChannelManager', () => ({ registerAdapterFactory: vi.fn() }))

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/userData' },
  nativeTheme: { themeSource: '', shouldUseDarkColors: false },
  net: { fetch: vi.fn() }
}))

vi.mock('ws', () => {
  class MockWebSocket {
    static readonly OPEN = 1
    readyState = 1
    on = vi.fn()
    once = vi.fn()
    send = vi.fn()
    close = vi.fn()
  }
  return { default: MockWebSocket, WebSocket: MockWebSocket }
})

import '../discord/DiscordAdapter'

import { registerAdapterFactory } from '../../ChannelManager'

const factoryCall = vi.mocked(registerAdapterFactory).mock.calls.find(([type]) => type === 'discord')
if (!factoryCall) throw new Error('registerAdapterFactory was not called for discord')
const createAdapter = factoryCall[1] as (channel: unknown, agentId: string) => any

beforeEach(() => {
  downloads.image.mockReset()
  downloads.file.mockReset()
})

it('does not emit when attachment loading outlives its connect run', async () => {
  const adapter = createAdapter(
    {
      id: 'discord-1',
      type: 'discord',
      enabled: true,
      config: { bot_token: 'token', allowed_channel_ids: [] }
    },
    'agent-1'
  )
  const events: unknown[] = []
  adapter.on('message', (event: unknown) => events.push(event))
  const current = new AbortController()
  adapter.connectAbort = current
  let finishDownload!: () => void
  downloads.image.mockReturnValue(
    new Promise((resolve) => {
      finishDownload = () => resolve({ data: 'image', media_type: 'image/png' })
    })
  )

  const handling = adapter.handleDispatch(
    'MESSAGE_CREATE',
    {
      id: 'message-1',
      channel_id: 'channel-1',
      author: { id: 'user-1', username: 'User' },
      content: '',
      timestamp: '',
      attachments: [
        {
          id: 'attachment-1',
          filename: 'image.png',
          url: 'https://cdn.example/image.png',
          proxy_url: 'https://cdn.example/image.png',
          content_type: 'image/png',
          size: 5
        }
      ]
    },
    current.signal
  )
  await Promise.resolve()
  adapter.connectAbort = new AbortController()
  current.abort()
  finishDownload()
  await handling

  expect(events).toEqual([])
})
