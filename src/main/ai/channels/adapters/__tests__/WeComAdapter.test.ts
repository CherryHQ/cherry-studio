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
  it.each(['Summarize the meeting', '/new'])('forwards voice transcription %j as user text once', async (text) => {
    const { instance, client } = await adapter()
    const messages: unknown[] = []
    const commands: unknown[] = []
    instance.on('message', (event) => messages.push(event))
    instance.on('command', (event) => commands.push(event))
    const incoming = frame('voice', { msgtype: 'voice', voice: { content: text } })
    client.emit('message', incoming)
    client.emit('message', incoming)
    await tick()
    expect(messages).toMatchObject([{ text, messageId: 'voice', chatId: 'dm:alice', images: [], files: [] }])
    expect(commands).toEqual([])
    expect(fetchRemoteBytes).not.toHaveBeenCalled()
  })

  it.each([undefined, '', '   ', 123])(
    'reports missing voice transcription %j without invoking the Agent',
    async (content) => {
      const { instance, client } = await adapter()
      const messages: unknown[] = []
      instance.on('message', (event) => messages.push(event))
      client.emit('message', frame('voice', { msgtype: 'voice', voice: { content } }))
      await tick()
      expect(messages).toEqual([])
      expect(client.replyStreamNonBlocking.mock.calls.at(-1)?.[2]).toBe(t('common.channel_voice_transcription_missing'))
    }
  )

  it('decrypts a video into a typed attachment without changing its bytes', async () => {
    const { instance, client } = await adapter()
    const raw = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')
    const key = Buffer.alloc(32, 1)
    const padding = 32 - (raw.length % 32)
    const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
    cipher.setAutoPadding(false)
    const encrypted = Buffer.concat([
      cipher.update(Buffer.concat([raw, Buffer.alloc(padding, padding)])),
      cipher.final()
    ])
    vi.mocked(fetchRemoteBytes).mockResolvedValueOnce({ body: encrypted, headers: {} })
    const messages: any[] = []
    instance.on('message', (event) => messages.push(event))
    client.emit(
      'message',
      frame('video', {
        msgtype: 'video',
        video: { url: 'https://example.com/video', aeskey: key.toString('base64') }
      })
    )
    await tick()
    expect(messages).toMatchObject([
      {
        text: '',
        messageId: 'video',
        files: [
          {
            filename: 'attachment.mp4',
            media_type: 'video/mp4',
            data: raw.toString('base64'),
            size: raw.length
          }
        ]
      }
    ])
  })

  it('rejects a non-video response to a video message', async () => {
    const { instance, client } = await adapter()
    vi.mocked(fetchRemoteBytes).mockResolvedValueOnce({ body: Buffer.from('not a video'), headers: {} })
    const messages: unknown[] = []
    instance.on('message', (event) => messages.push(event))
    client.emit('message', frame('video', { msgtype: 'video', video: { url: 'https://example.com/video' } }))
    await tick()
    expect(messages).toEqual([])
    expect(client.replyStreamNonBlocking.mock.calls.at(-1)?.[2]).toBe(t('common.wecom_attachment_failed'))
  })

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

  it.each(['file', 'video'])(
    'aborts %s downloads on disconnect without invoking the Agent or replying afterward',
    async (kind) => {
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
      client.emit('message', frame('1', { msgtype: kind, [kind]: { url: 'https://example.com/media' } }))
      await tick()
      await instance.disconnect()
      await tick()
      expect(aborted).toBe(true)
      expect(messages).toEqual([])
      expect(client.replyStreamNonBlocking).not.toHaveBeenCalled()
      expect(client.sendMessage).not.toHaveBeenCalled()
    }
  )

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

  it('downloads mixed images concurrently and preserves their order when downloads finish in reverse', async () => {
    const { instance, client } = await adapter()
    const messages: any[] = []
    instance.on('message', (event) => messages.push(event))
    const releases: Array<() => void> = []
    const images = [1, 2, 3, 4, 5].map((value) =>
      Buffer.from(`474946383961${value.toString(16).padStart(2, '0')}001000`, 'hex')
    )
    vi.mocked(fetchRemoteBytes).mockImplementation(
      (url) =>
        new Promise((resolve) => {
          const index = Number(new URL(url).pathname.slice(1))
          releases[index] = () => resolve({ body: images[index], headers: {} })
        })
    )
    client.emit(
      'message',
      frame('mixed', {
        msgtype: 'mixed',
        mixed: {
          msg_item: [
            { msgtype: 'text', text: { content: 'compare' } },
            ...images.map((_, index) => ({ msgtype: 'image', image: { url: `https://example.com/${index}` } }))
          ]
        }
      })
    )
    await tick()
    expect(releases.filter(Boolean)).toHaveLength(4)
    releases[3]()
    await tick()
    expect(releases.filter(Boolean)).toHaveLength(5)
    for (const index of [4, 2, 1, 0]) releases[index]()
    await tick()
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe('compare')
    expect(messages[0].images.map((image: { data: string }) => image.data)).toEqual(
      images.map((image) => image.toString('base64'))
    )
  })

  it('releases superseded callbacks so rapid batches do not exhaust response capacity', async () => {
    const { instance, client } = await adapter()
    const messages: unknown[] = []
    instance.on('message', (message) => messages.push(message))
    for (let index = 0; index < 1100; index++) {
      client.emit('message', frame(String(index)))
      if (index) instance.discardResponse('dm:alice', reply(String(index - 1)))
    }
    expect(messages).toHaveLength(1100)
    await instance.onStreamComplete('dm:alice', 'batched result', reply('1099'))
    expect(
      client.replyStreamNonBlocking.mock.calls.map(([frame, , text, finish]: any[]) => [
        frame.headers.req_id,
        text,
        finish
      ])
    ).toEqual([['req-1099', 'batched result', true]])
  })

  it('bounds concurrent mixed downloads by a shared wire budget before all bodies accumulate', async () => {
    const { instance, client } = await adapter()
    const messages: unknown[] = []
    instance.on('message', (message) => messages.push(message))
    const image = Buffer.alloc(11 * 1024 * 1024)
    image.write('GIF89a')
    let downloaded = 0
    vi.mocked(fetchRemoteBytes).mockImplementation(async (_url, options) => {
      await Promise.resolve()
      if (options?.byteBudget) {
        if (options.byteBudget.remaining < image.length) throw new Error('budget exceeded')
        options.byteBudget.remaining -= image.length
      }
      downloaded += image.length
      return { body: image, headers: {} }
    })
    client.emit(
      'message',
      frame('budget', {
        msgtype: 'mixed',
        mixed: {
          msg_item: [0, 1, 2, 3].map((index) => ({ msgtype: 'image', image: { url: `https://example.com/${index}` } }))
        }
      })
    )
    await tick()
    expect(downloaded).toBeLessThanOrEqual(40 * 1024 * 1024 + 20 * 32)
    expect(messages).toEqual([])
    expect(client.replyStreamNonBlocking.mock.calls.at(-1)?.slice(2)).toEqual([
      t('common.wecom_attachment_failed'),
      true
    ])
  })

  it('shares the minute quota across stream updates and active messages while reserving final delivery', async () => {
    vi.useFakeTimers()
    const { instance, client } = await adapter()
    const sent: Array<{ time: number; text: string; finish: boolean }> = []
    client.replyStreamNonBlocking.mockImplementation(
      async (_frame: unknown, _id: string, text: string, finish: boolean) => {
        sent.push({ time: Date.now(), text, finish })
      }
    )
    client.sendMessage.mockImplementation(async (_chat: string, body: { markdown: { content: string } }) => {
      sent.push({ time: Date.now(), text: body.markdown.content, finish: true })
    })
    client.emit('message', frame('quota'))
    await instance.sendTypingIndicator('dm:alice', reply('quota'))
    for (let index = 0; index < 80; index++) {
      await instance.onTextUpdate('dm:alice', `part ${index}`, reply('quota'))
      await vi.advanceTimersByTimeAsync(500)
    }
    await instance.sendMessage('dm:alice', 'notification')
    await instance.onStreamComplete('dm:alice', 'complete answer', reply('quota'))
    expect(sent.length).toBeLessThanOrEqual(30)
    expect(sent.slice(-2).map(({ text }) => text)).toEqual(['notification', 'complete answer'])
    expect(sent.at(-1)?.finish).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sent.at(-1)?.text).toBe('complete answer')
  })

  it('waits for the rolling quota and cancels delayed delivery when disconnected', async () => {
    vi.useFakeTimers()
    const { instance, client } = await adapter()
    for (let index = 0; index < 30; index++) await instance.sendMessage('dm:alice', `message ${index}`)
    const pending = instance.sendMessage('dm:alice', 'after window')
    await vi.advanceTimersByTimeAsync(59_999)
    expect(client.sendMessage.mock.calls).toHaveLength(30)
    await instance.sendMessage('dm:bob', 'independent chat')
    await vi.advanceTimersByTimeAsync(2)
    await pending
    expect(client.sendMessage.mock.calls.at(-1)?.[1].markdown.content).toBe('after window')
    for (let index = 0; index < 29; index++) await instance.sendMessage('dm:alice', `next ${index}`)
    const cancelled = instance.sendMessage('dm:alice', 'must not arrive')
    const rejected = expect(cancelled).rejects.toThrow(t('common.wecom_delivery_failed'))
    await vi.advanceTimersByTimeAsync(1)
    await instance.disconnect()
    await rejected
    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.sendMessage.mock.calls.some(([, body]: any[]) => body.markdown.content === 'must not arrive')).toBe(
      false
    )
  })

  it('enforces the hourly quota even when every minute remains within its limit', async () => {
    vi.useFakeTimers()
    const { instance, client } = await adapter()
    for (let index = 0; index < 1000; index++) {
      if (index && index % 30 === 0) await vi.advanceTimersByTimeAsync(60_000)
      await instance.sendMessage('dm:alice', `message ${index}`)
    }
    const pending = instance.sendMessage('dm:alice', 'next hour')
    await vi.advanceTimersByTimeAsync(1_619_999)
    expect(client.sendMessage.mock.calls).toHaveLength(1000)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(client.sendMessage.mock.calls.at(-1)?.[1].markdown.content).toBe('next hour')
  })

  it('delivers a final result actively when quota waiting outlasts its reply window', async () => {
    vi.useFakeTimers()
    const { instance, client } = await adapter()
    client.emit('message', frame('expires'))
    await vi.advanceTimersByTimeAsync(160_000)
    for (let index = 0; index < 30; index++) await instance.sendMessage('dm:alice', `message ${index}`)
    const final = instance.onStreamComplete('dm:alice', 'preserved result', reply('expires'))
    await vi.advanceTimersByTimeAsync(60_000)
    await final
    expect(client.replyStreamNonBlocking.mock.calls).toHaveLength(0)
    expect(client.sendMessage.mock.calls.at(-1)?.[1].markdown.content).toBe('preserved result')
  })

  it('cancels sibling mixed-image downloads on failure without dispatching a partial message', async () => {
    const { instance, client } = await adapter()
    const messages: unknown[] = []
    const signals: AbortSignal[] = []
    instance.on('message', (event) => messages.push(event))
    vi.mocked(fetchRemoteBytes).mockImplementation(async (url, options) => {
      if (url.endsWith('/bad')) throw new Error('download failed')
      signals.push(options!.signal!)
      return new Promise((_resolve, reject) =>
        options!.signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      )
    })
    client.emit(
      'message',
      frame('mixed-failure', {
        msgtype: 'mixed',
        mixed: {
          msg_item: ['bad', 'pending'].map((name) => ({
            msgtype: 'image',
            image: { url: `https://example.com/${name}` }
          }))
        }
      })
    )
    await tick()
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(true)
    expect(messages).toEqual([])
    expect(client.replyStreamNonBlocking.mock.calls.at(-1)?.slice(2)).toEqual([
      t('common.wecom_attachment_failed'),
      true
    ])
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
