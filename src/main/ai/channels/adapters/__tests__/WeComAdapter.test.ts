import { createCipheriv } from 'node:crypto'

import type * as WeComSdk from '@wecom/aibot-node-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { t } from '@main/i18n'
import { fetchRemoteBytes } from '@main/utils/remoteFetch'

const sdk = vi.hoisted(() => ({ clients: [] as any[], authenticate: true }))
vi.mock('@wecom/aibot-node-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof WeComSdk>()
  const { EventEmitter } = await import('node:events')
  class Client extends EventEmitter {
    options: unknown
    connect = vi.fn(() => {
      if (sdk.authenticate) queueMicrotask(() => this.emit('authenticated'))
      return this
    })
    disconnect = vi.fn()
    replyStreamNonBlocking = vi.fn().mockResolvedValue({})
    sendMessage = vi.fn().mockResolvedValue({})
    uploadMedia = vi.fn().mockResolvedValue({ media_id: 'media-1' })
    sendMediaMessage = vi.fn().mockResolvedValue({})
    constructor(options: unknown) {
      super()
      this.options = options
      sdk.clients.push(this)
    }
  }
  return { ...actual, WSClient: Client }
})
vi.mock('@main/utils/remoteFetch', () => ({ fetchRemoteBytes: vi.fn() }))

import { WeComAdapter } from '../wecom/WeComAdapter'

const instances: WeComAdapter[] = []
async function adapter(config = {}) {
  const instance = new WeComAdapter({
    channelId: 'channel',
    channelType: 'wecom',
    agentId: 'agent',
    channelConfig: { bot_id: 'bot', secret: 'secret-do-not-log', allowed_chat_ids: [], allowed_user_ids: [], ...config }
  })
  instances.push(instance)
  await instance.connect()
  return { instance, client: sdk.clients.at(-1) }
}
function frame(id: string, extra = {}) {
  return {
    headers: { req_id: `req-${id}` },
    body: {
      msgid: id,
      aibotid: 'bot',
      chattype: 'single',
      from: { userid: 'alice' },
      msgtype: 'text',
      text: { content: 'hello' },
      ...extra
    }
  }
}
const reply = (id: string) => ({ replyToMessageId: id })
const tick = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  vi.clearAllMocks()
  sdk.clients.length = 0
  sdk.authenticate = true
})
afterEach(async () => {
  for (const instance of instances.splice(0)) await instance.disconnect()
  vi.useRealTimers()
})

describe('WeCom channel contract', () => {
  it('admits each message once and keeps private and group conversations separate', async () => {
    const { instance, client } = await adapter()
    const messages: unknown[] = []
    instance.on('message', (event) => messages.push(event))
    client.emit('message', frame('1'))
    client.emit('message', frame('1'))
    client.emit('message', frame('2', { chattype: 'group', chatid: 'alice' }))
    expect(messages).toMatchObject([
      { chatId: 'dm:alice', conversationId: 'dm:alice', text: 'hello', messageId: '1' },
      { chatId: 'group:alice', conversationId: 'group:alice', messageId: '2' }
    ])
  })

  it('requires both allowlists before downloading or invoking the Agent', async () => {
    const { instance, client } = await adapter({ allowed_chat_ids: ['group:team'], allowed_user_ids: ['alice'] })
    const message = vi.fn()
    instance.on('message', message)
    client.emit(
      'message',
      frame('1', {
        chattype: 'group',
        chatid: 'team',
        from: { userid: 'bob' },
        msgtype: 'image',
        image: { url: 'https://example.com/secret' }
      })
    )
    client.emit('message', frame('2', { chattype: 'group', chatid: 'other' }))
    await tick()
    expect(fetchRemoteBytes).not.toHaveBeenCalled()
    expect(message).not.toHaveBeenCalled()
    await instance.sendMessage('group:other', 'private result')
    await instance.sendMessage('dm:bob', 'private result')
    expect(client.sendMessage).not.toHaveBeenCalled()
  })

  it('binds same-group responses to their own callback, including reverse completion order', async () => {
    const { instance, client } = await adapter()
    client.emit('message', frame('1', { chattype: 'group', chatid: 'team' }))
    client.emit('message', frame('2', { chattype: 'group', chatid: 'team', from: { userid: 'bob' } }))
    await instance.onStreamComplete('group:team', 'Bob', reply('2'))
    await instance.onStreamComplete('group:team', 'Alice', reply('1'))
    expect(
      client.replyStreamNonBlocking.mock.calls.map(([f, , content, finish]: any[]) => [
        f.headers.req_id,
        content,
        finish
      ])
    ).toEqual([
      ['req-2', 'Bob', true],
      ['req-1', 'Alice', true]
    ])
  })

  it('only opens the selected batched response and closes an empty turn', async () => {
    const { instance, client } = await adapter()
    client.emit('message', frame('1'))
    client.emit('message', frame('2'))
    expect(client.replyStreamNonBlocking).not.toHaveBeenCalled()
    await instance.sendTypingIndicator('dm:alice', reply('2'))
    await instance.sendTypingIndicator('dm:alice', reply('2'))
    await instance.onStreamComplete('dm:alice', '', reply('2'))
    expect(
      client.replyStreamNonBlocking.mock.calls.map(([f, , text, done]: any[]) => [f.headers.req_id, text, done])
    ).toEqual([
      ['req-2', t('common.wecom_processing'), false],
      ['req-2', t('common.wecom_empty_response'), true]
    ])
  })

  it('keeps a final result during transient disconnect and delivers after authentication', async () => {
    const { instance, client } = await adapter()
    client.emit('message', frame('1'))
    client.emit('disconnected', 'network')
    expect(instance.connected).toBe(false)
    expect(instance.isStreamListenerAlive()).toBe(true)
    const done = instance.onStreamComplete('dm:alice', 'result', reply('1'))
    expect(client.replyStreamNonBlocking).not.toHaveBeenCalled()
    client.emit('authenticated')
    await done
    expect(client.replyStreamNonBlocking.mock.calls.at(-1)?.slice(2)).toEqual(['result', true])
  })

  it('cancels a pending result on stop and ignores stale callbacks', async () => {
    const { instance, client } = await adapter()
    client.emit('message', frame('1'))
    client.emit('disconnected', 'network')
    const pending = instance.onStreamComplete('dm:alice', 'result', reply('1'))
    const rejected = expect(pending).rejects.toThrow(t('common.wecom_delivery_failed'))
    await instance.disconnect()
    await rejected
    client.emit('authenticated')
    expect(instance.connected).toBe(false)
    expect(instance.isStreamListenerAlive()).toBe(false)
    expect(client.sendMessage).not.toHaveBeenCalled()
  })

  it('retires a replaced connection without starting another reconnect loop', async () => {
    const { instance, client } = await adapter()
    client.emit('event.disconnected_event', {})
    expect(instance.isStreamListenerAlive()).toBe(false)
    expect(instance.connected).toBe(false)
    expect(client.connect).toHaveBeenCalledTimes(1)
  })

  it('waits for authentication rather than accepting the socket-open event', async () => {
    sdk.authenticate = false
    vi.useFakeTimers()
    const promise = adapter()
    const failure = expect(promise).rejects.toThrow(t('common.wecom_connection_failed'))
    await vi.advanceTimersByTimeAsync(0)
    sdk.clients[0].emit('connected')
    expect(instances.at(-1)?.connected).toBe(false)
    await vi.advanceTimersByTimeAsync(30_000)
    await failure
    expect(instances.at(-1)?.isStreamListenerAlive()).toBe(false)
  })

  it('hands long UTF-8 results to active messages without losing or splitting characters', async () => {
    const { instance, client } = await adapter()
    client.emit('message', frame('1'))
    await instance.sendTypingIndicator('dm:alice', reply('1'))
    const text = '中文😀'.repeat(1000)
    await instance.onTextUpdate('dm:alice', text, reply('1'))
    await instance.onStreamComplete('dm:alice', text, reply('1'))
    const chunks = client.sendMessage.mock.calls.map(([chat, body]: any[]) => {
      expect(chat).toBe('alice')
      return body.markdown.content as string
    })
    expect(chunks.map((chunk: string) => chunk.replace(/^\[\d+\/\d+\]\n/, '')).join('')).toBe(text)
    expect(chunks.every((chunk: string) => Buffer.byteLength(chunk) <= 2048 && !chunk.includes('\uFFFD'))).toBe(true)
    expect(client.replyStreamNonBlocking.mock.calls.at(-1)?.slice(2)).toEqual([t('common.wecom_continued'), true])
  })

  it('closes and reopens code fences across numbered message parts', async () => {
    const { instance, client } = await adapter()
    await instance.sendMessage('dm:alice', '```ts\n' + 'const value = 1\n'.repeat(400) + '```')
    const chunks = client.sendMessage.mock.calls.map(([, body]: any[]) => body.markdown.content as string)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(2048)
      expect(chunk.match(/^```/gm)).toHaveLength(2)
    }
    expect(chunks.join('\n').match(/const value = 1/g)).toHaveLength(400)
  })

  it('finishes an expired placeholder and delivers a later result actively', async () => {
    vi.useFakeTimers()
    const { instance, client } = await adapter()
    client.emit('message', frame('1'))
    await instance.sendTypingIndicator('dm:alice', reply('1'))
    await vi.advanceTimersByTimeAsync(170_000)
    expect(client.replyStreamNonBlocking.mock.calls.at(-1)?.slice(2)).toEqual([t('common.wecom_continued'), true])
    await instance.onStreamComplete('dm:alice', 'late result', reply('1'))
    expect(client.sendMessage).toHaveBeenCalledWith('alice', {
      msgtype: 'markdown',
      markdown: { content: 'late result' }
    })
  })

  it('flushes the latest throttled text and cancels delayed updates at completion', async () => {
    vi.useFakeTimers()
    const { instance, client } = await adapter()
    client.emit('message', frame('1'))
    await instance.onTextUpdate('dm:alice', 'first', reply('1'))
    await instance.onTextUpdate('dm:alice', 'first and latest', reply('1'))
    await vi.advanceTimersByTimeAsync(500)
    expect(client.replyStreamNonBlocking.mock.calls.at(-1)?.slice(2)).toEqual(['first and latest', false])
    await instance.onTextUpdate('dm:alice', 'queued', reply('1'))
    await instance.onStreamComplete('dm:alice', 'final', reply('1'))
    const completedFrames = client.replyStreamNonBlocking.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(client.replyStreamNonBlocking.mock.calls.at(-1)?.slice(2)).toEqual(['final', true])
    expect(client.replyStreamNonBlocking.mock.calls).toHaveLength(completedFrames)
  })

  it('aborts attachment downloads on disconnect without invoking the Agent or replying afterward', async () => {
    const { instance, client } = await adapter()
    let aborted = false
    vi.mocked(fetchRemoteBytes).mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(new Error('Aborted'))
            },
            { once: true }
          )
        })
    )
    const messages: unknown[] = []
    instance.on('message', (message) => messages.push(message))
    client.emit('message', frame('1', { msgtype: 'file', file: { url: 'https://example.com/file' } }))
    await tick()
    await instance.disconnect()
    await tick()
    expect(aborted).toBe(true)
    expect(messages).toEqual([])
    expect(client.replyStreamNonBlocking).not.toHaveBeenCalled()
    expect(client.sendMessage).not.toHaveBeenCalled()
  })

  it('sends task notifications actively without borrowing the latest callback', async () => {
    const { instance, client } = await adapter()
    client.emit('message', frame('1'))
    await instance.onTextUpdate('dm:alice', 'task partial')
    expect(await instance.onStreamComplete('dm:alice', 'task result')).toBe(false)
    await instance.sendMessage('dm:alice', 'task result')
    expect(client.sendMessage).toHaveBeenCalledWith('alice', {
      msgtype: 'markdown',
      markdown: { content: 'task result' }
    })
    expect(client.replyStreamNonBlocking).not.toHaveBeenCalled()
  })

  it('does not retry an ACK-unknown final or expose SDK error details', async () => {
    const { instance, client } = await adapter()
    client.emit('message', frame('1'))
    client.replyStreamNonBlocking.mockRejectedValue(new Error('secret-do-not-log'))
    await expect(instance.onStreamComplete('dm:alice', 'answer', reply('1'))).rejects.toThrow(
      t('common.wecom_delivery_failed')
    )
    expect(client.replyStreamNonBlocking).toHaveBeenCalledTimes(1)
    expect(client.sendMessage).not.toHaveBeenCalled()
  })

  it('decrypts file bytes before forwarding and rejects an entire mixed message if any attachment fails', async () => {
    const { instance, client } = await adapter()
    const key = Buffer.alloc(32, 1)
    const raw = Buffer.from('actual file contents')
    const padding = 32 - (raw.length % 32)
    const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
    cipher.setAutoPadding(false)
    const encrypted = Buffer.concat([
      cipher.update(Buffer.concat([raw, Buffer.alloc(padding, padding)])),
      cipher.final()
    ])
    vi.mocked(fetchRemoteBytes).mockResolvedValueOnce({
      body: encrypted,
      headers: { 'content-disposition': 'attachment; filename="report.txt"' }
    })
    const messages: any[] = []
    instance.on('message', (event) => messages.push(event))
    client.emit(
      'message',
      frame('1', { msgtype: 'file', file: { url: 'https://example.com/file', aeskey: key.toString('base64') } })
    )
    await tick()
    expect(messages[0]?.files[0]).toMatchObject({
      filename: 'report.txt',
      data: raw.toString('base64'),
      size: raw.length
    })
    vi.mocked(fetchRemoteBytes).mockRejectedValueOnce(new Error('url-with-secret'))
    client.emit(
      'message',
      frame('2', {
        msgtype: 'mixed',
        mixed: {
          msg_item: [
            { msgtype: 'text', text: { content: 'analyze image' } },
            { msgtype: 'image', image: { url: 'https://example.com/image' } }
          ]
        }
      })
    )
    await tick()
    expect(messages).toHaveLength(1)
    expect(client.replyStreamNonBlocking.mock.calls.at(-1)?.[2]).toBe(t('common.wecom_attachment_failed'))
  })

  it.each([
    { bytes: 0, reportedSize: 5 },
    { bytes: 4, reportedSize: 4 },
    { bytes: 20 * 1024 * 1024 + 1, reportedSize: 20 * 1024 * 1024 + 1 },
    { bytes: 20 * 1024 * 1024 + 1, reportedSize: 5 }
  ])(
    'rejects a $bytes-byte upload before contacting WeCom (reported size $reportedSize)',
    async ({ bytes, reportedSize }) => {
      const { instance, client } = await adapter()
      await expect(
        instance.sendFile('group:team', {
          data: Buffer.alloc(bytes, 1).toString('base64'),
          filename: 'result.txt',
          size: reportedSize,
          media_type: 'text/plain'
        })
      ).rejects.toThrow(t('common.wecom_attachment_failed'))
      expect(client.uploadMedia).not.toHaveBeenCalled()
      expect(client.sendMediaMessage).not.toHaveBeenCalled()
    }
  )

  it.each([5, 20 * 1024 * 1024])('delivers a permitted %i-byte file to the intended chat', async (size) => {
    const { instance, client } = await adapter()
    const bytes = Buffer.alloc(size, 1)
    await instance.sendFile('group:team', {
      data: bytes.toString('base64'),
      filename: 'result.txt',
      size,
      media_type: 'text/plain'
    })
    const [uploaded, options] = client.uploadMedia.mock.calls[0]
    expect(uploaded.equals(bytes)).toBe(true)
    expect(options).toEqual({ type: 'file', filename: 'result.txt' })
    expect(client.sendMediaMessage).toHaveBeenCalledWith('team', 'file', 'media-1')
  })
})
