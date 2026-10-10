import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { t } from '@main/i18n'
import { fetchRemoteBytes } from '@main/utils/remoteFetch'

const sdk = vi.hoisted(() => ({ clients: [] as any[], connect: true }))
vi.mock('dingtalk-stream', async () => {
  const { EventEmitter } = await import('node:events')
  class Client extends EventEmitter {
    callback!: (frame: unknown) => void
    ack = vi.fn()
    socketCallBackResponse = this.ack
    disconnect = vi.fn()
    registerCallbackListener(_topic: string, fn: (frame: unknown) => void) {
      this.callback = fn
    }
    async connect() {
      if (sdk.connect) this.emit('connectionState', true)
    }
    constructor(public options: unknown) {
      super()
      sdk.clients.push(this)
    }
  }
  return { DWClient: Client, TOPIC_ROBOT: '/v1.0/im/bot/messages/get' }
})
vi.mock('@main/utils/remoteFetch', () => ({ fetchRemoteBytes: vi.fn() }))

import { DingTalkAdapter } from '../dingtalk/DingTalkAdapter'

const instances: DingTalkAdapter[] = []
const requests: { url: string; body: any; init: RequestInit }[] = []
const tick = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve))
}
const reply = (id: string) => ({ replyToMessageId: id })
const file = {
  filename: 'report.pdf',
  data: Buffer.from('document').toString('base64'),
  media_type: 'application/pdf',
  size: 8
}
function frame(id: string, extra = {}) {
  return {
    headers: { messageId: `ack-${id}`, topic: '/v1.0/im/bot/messages/get' },
    data: JSON.stringify({
      msgId: id,
      robotCode: 'robot',
      senderStaffId: 'alice',
      senderNick: 'Alice',
      conversationType: '1',
      conversationId: 'conversation',
      sessionWebhook: `https://oapi.dingtalk.com/robot/sendBySession?session=${id}`,
      sessionWebhookExpiredTime: Date.now() + 60_000,
      msgtype: 'text',
      text: { content: 'hello' },
      ...extra
    })
  }
}
async function adapter(config = {}) {
  const instance = new DingTalkAdapter({
    channelId: 'channel',
    channelType: 'dingtalk',
    agentId: 'agent',
    channelConfig: {
      client_id: 'app',
      client_secret: 'secret-do-not-log',
      robot_code: 'robot',
      allowed_chat_ids: [],
      allowed_user_ids: [],
      ...config
    }
  })
  instances.push(instance)
  await instance.connect()
  return { instance, client: sdk.clients.at(-1) }
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status })
}
function success(url: string) {
  if (url.endsWith('/accessToken')) return response({ accessToken: 'token-do-not-log', expireIn: 7200 })
  if (url.includes('/media/upload')) return response({ errcode: 0, media_id: '@media' })
  if (url.endsWith('/download')) return response({ downloadUrl: 'https://cdn.example.com/file' })
  if (url.endsWith('/deliver')) return response({ result: [{ success: true }] })
  if (url.includes('/card/')) return response({ success: true })
  if (url.includes('/sendBySession')) return response({ errcode: 0 })
  return response({ processQueryKey: 'query' })
}
beforeEach(() => {
  vi.clearAllMocks()
  sdk.clients.length = 0
  sdk.connect = true
  requests.length = 0
  vi.spyOn(net, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    requests.push({
      url,
      body: init?.body instanceof FormData ? init.body : JSON.parse(String(init?.body)),
      init: init as RequestInit
    })
    return success(url)
  })
})
afterEach(async () => {
  for (const instance of instances.splice(0)) await instance.disconnect()
  vi.restoreAllMocks()
})

describe('DingTalk channel contract', () => {
  it.each(['Summarize the meeting', '/new'])('forwards audio transcription %j as user text once', async (text) => {
    const { instance, client } = await adapter()
    const messages: unknown[] = []
    const commands: unknown[] = []
    instance.on('message', (event) => messages.push(event))
    instance.on('command', (event) => commands.push(event))
    const incoming = frame('voice', { msgtype: 'audio', content: { recognition: text, downloadCode: 'audio-code' } })
    client.callback(incoming)
    client.callback(incoming)
    await tick()
    expect(messages).toMatchObject([{ text, messageId: 'voice', chatId: 'dm:alice', images: [], files: [] }])
    expect(commands).toEqual([])
    expect(fetchRemoteBytes).not.toHaveBeenCalled()
  })

  it.each([undefined, '', '   ', 123])(
    'reports missing audio transcription %j without invoking the Agent',
    async (recognition) => {
      const { instance, client } = await adapter()
      const messages: unknown[] = []
      instance.on('message', (event) => messages.push(event))
      client.callback(frame('voice', { msgtype: 'audio', content: { recognition } }))
      await tick()
      expect(messages).toEqual([])
      expect(requests.at(-1)?.body.text.content).toBe(t('common.channel_voice_transcription_missing'))
    }
  )

  it('downloads a video into a typed attachment using its detected extension', async () => {
    const { instance, client } = await adapter()
    const raw = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')
    vi.mocked(fetchRemoteBytes).mockResolvedValueOnce({ body: raw, headers: {} })
    const messages: unknown[] = []
    instance.on('message', (event) => messages.push(event))
    client.callback(
      frame('video', { msgtype: 'video', content: { downloadCode: 'video-code', videoType: 'untrusted' } })
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
    expect(requests.find((request) => request.url.endsWith('/download'))?.body).toEqual({
      downloadCode: 'video-code',
      robotCode: 'robot'
    })
  })

  it('rejects a non-video response to a video message', async () => {
    const { instance, client } = await adapter()
    vi.mocked(fetchRemoteBytes).mockResolvedValueOnce({ body: Buffer.from('not a video'), headers: {} })
    const messages: unknown[] = []
    instance.on('message', (event) => messages.push(event))
    client.callback(frame('video', { msgtype: 'video', content: { downloadCode: 'video-code' } }))
    await tick()
    expect(messages).toEqual([])
    expect(requests.at(-1)?.body.text.content).toBe(t('common.dingtalk_attachment_failed'))
  })

  it('acknowledges transport redelivery without running the Agent twice and isolates DM/group identities', async () => {
    const { instance, client } = await adapter()
    const messages: unknown[] = []
    instance.on('message', (message) => messages.push(message))
    client.callback(frame('1'))
    client.callback({ ...frame('1'), headers: { messageId: 'redelivery', topic: '/v1.0/im/bot/messages/get' } })
    client.callback(frame('2', { conversationType: '2', conversationId: 'team', isInAtList: true }))
    await tick()
    expect(messages).toMatchObject([
      { chatId: 'dm:alice', userId: 'alice', messageId: '1' },
      { chatId: 'group:team', conversationId: 'group:team', messageId: '2' }
    ])
    expect(client.ack.mock.calls.map(([id]: [string]) => id)).toEqual(['ack-1', 'redelivery', 'ack-2'])
  })

  it('rejects unauthorized identities, wrong bots and unmentioned groups before downloads or Agent execution', async () => {
    const { instance, client } = await adapter({ allowed_chat_ids: ['group:team'], allowed_user_ids: ['alice'] })
    const messages: unknown[] = []
    instance.on('message', (message) => messages.push(message))
    for (const extra of [
      { senderStaffId: 'bob' },
      { conversationId: 'other' },
      { senderStaffId: '' },
      { robotCode: 'other' },
      { isInAtList: false }
    ]) {
      client.callback(
        frame(JSON.stringify(extra), {
          conversationType: '2',
          conversationId: 'team',
          isInAtList: true,
          msgtype: 'picture',
          content: { downloadCode: 'secret' },
          ...extra
        })
      )
    }
    await tick()
    expect(messages).toEqual([])
    expect(requests).toEqual([])
    expect(fetchRemoteBytes).not.toHaveBeenCalled()
    await expect(instance.sendFile('dm:bob', file)).rejects.toThrow()
    expect(requests).toEqual([])
  })

  it('keeps original reply webhooks for interleaved messages and uses proactive APIs after expiry', async () => {
    const { instance, client } = await adapter()
    for (const id of ['1', '2'])
      client.callback(frame(id, { conversationType: '2', conversationId: 'team', isInAtList: true }))
    client.callback(frame('expired', { sessionWebhookExpiredTime: 1 }))
    await tick()
    await instance.onStreamComplete('group:team', 'second', reply('2'))
    await instance.onStreamComplete('group:team', 'first', reply('1'))
    await instance.sendMessage('dm:alice', 'late', reply('expired'))
    expect(requests.filter((r) => r.url.includes('sendBySession')).map((r) => [r.url, r.body.text.content])).toEqual([
      ['https://oapi.dingtalk.com/robot/sendBySession?session=2', 'second'],
      ['https://oapi.dingtalk.com/robot/sendBySession?session=1', 'first']
    ])
    expect(requests.at(-1)?.body).toEqual({
      robotCode: 'robot',
      userIds: ['alice'],
      msgKey: 'sampleText',
      msgParam: '{"content":"late"}'
    })
  })

  it('refuses signed reply URLs outside the trusted endpoint without leaking credentials', async () => {
    const { instance, client } = await adapter()
    client.callback(frame('1', { sessionWebhook: 'https://attacker.example/robot/sendBySession?session=secret' }))
    await tick()
    await expect(instance.sendMessage('dm:alice', 'answer', reply('1'))).rejects.toThrow(
      t('common.dingtalk_delivery_failed')
    )
    expect(requests).toEqual([])
  })

  it('acks before downloading and rejects the whole rich-text message if one image fails', async () => {
    const { instance, client } = await adapter()
    const messages: unknown[] = []
    instance.on('message', (message) => messages.push(message))
    vi.mocked(fetchRemoteBytes).mockRejectedValue(new Error('network secret'))
    client.callback(
      frame('1', {
        msgtype: 'richText',
        content: { richText: [{ text: 'analyze this' }, { type: 'picture', downloadCode: 'code' }] }
      })
    )
    expect(client.ack.mock.calls[0][0]).toBe('ack-1')
    await tick()
    expect(messages).toEqual([])
    expect(requests.at(-1)?.body.text.content).toBe(t('common.dingtalk_attachment_failed'))
    expect(vi.mocked(fetchRemoteBytes).mock.calls[0][1]?.headers).toBeUndefined()
  })

  it('preserves inbound file bytes and names and routes commands without invoking the Agent', async () => {
    const { instance, client } = await adapter()
    const messages: any[] = []
    const commands: any[] = []
    instance.on('message', (message) => messages.push(message))
    instance.on('command', (command) => commands.push(command))
    vi.mocked(fetchRemoteBytes).mockResolvedValue({ body: Buffer.from('document'), headers: {} })
    client.callback(frame('1', { msgtype: 'file', content: { downloadCode: 'code', fileName: 'report.txt' } }))
    client.callback(frame('2', { text: { content: '/whoami' } }))
    await tick()
    expect(messages[0].files[0]).toMatchObject({ filename: 'report.txt', size: 8, data: file.data })
    expect(commands).toMatchObject([{ command: 'whoami', chatId: 'dm:alice', userId: 'alice' }])
  })

  it('retains delivery while Stream reconnects, and aborts all delivery after disable', async () => {
    const { instance, client } = await adapter()
    client.emit('connectionState', false)
    expect(instance.connected).toBe(false)
    expect(instance.isStreamListenerAlive()).toBe(true)
    await instance.sendMessage('group:team', 'scheduled result')
    expect(requests.at(-1)?.body.openConversationId).toBe('team')
    client.emit('connectionState', true)
    expect(instance.connected).toBe(true)
    const signal = requests.at(-1)!.init.signal!
    await instance.disconnect()
    expect(signal.aborted).toBe(true)
    expect(instance.isStreamListenerAlive()).toBe(false)
    await expect(instance.sendMessage('group:team', 'late result')).rejects.toThrow()
    client.emit('connectionState', true)
    expect(instance.connected).toBe(false)
  })

  it.each(['file', 'video'])('does not emit late %s downloads after disable', async (kind) => {
    const { instance, client } = await adapter()
    let release!: (value: { body: Buffer; headers: {} }) => void
    vi.mocked(fetchRemoteBytes).mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const messages: unknown[] = []
    instance.on('message', (message) => messages.push(message))
    client.callback(frame('1', { msgtype: kind, content: { downloadCode: 'code', fileName: 'x.txt' } }))
    await tick()
    await instance.disconnect()
    release({ body: Buffer.from('late bytes'), headers: {} })
    await tick()
    expect(messages).toEqual([])
  })

  it('serializes card updates and ends paused or empty responses explicitly', async () => {
    const { instance, client } = await adapter({ card_template_id: 'template' })
    client.callback(frame('1'))
    await tick()
    await instance.sendTypingIndicator('dm:alice', reply('1'))
    await instance.onTextUpdate('dm:alice', 'partial', reply('1'))
    await instance.onStreamComplete('dm:alice', 'partial', reply('1'), { status: 'paused' })
    const final = requests.filter((r) => r.url.endsWith('/streaming')).at(-1)!
    expect(final.body).toMatchObject({
      isFull: true,
      isFinalize: true,
      isError: false,
      content: `partial\n\n${t('common.channel_stopped')}`
    })
    const count = requests.length
    await instance.onTextUpdate('dm:alice', 'late delta', reply('1'))
    expect(requests.length).toBe(count)
    client.callback(frame('2'))
    await tick()
    await instance.onStreamComplete('dm:alice', '', reply('2'))
    expect(requests.at(-1)?.body.text.content).toBe(t('common.dingtalk_empty_response'))
  })

  it('delivers a successor execution on a finalized reply as a fresh message, never rewriting its card', async () => {
    const { instance, client } = await adapter({ card_template_id: 'template' })
    client.callback(frame('1'))
    await tick()
    await instance.sendTypingIndicator('dm:alice', reply('1'))
    await instance.onTextUpdate('dm:alice', 'original answer', reply('1'))
    await instance.onStreamComplete('dm:alice', 'original answer', reply('1'))
    const finalizedCardWrites = requests.filter((r) => r.url.endsWith('/streaming')).length
    // A background wake streams and settles on the same inbound message (the chain-held listener
    // keeps its reply context). Card streaming sends full replacement content, so reusing the
    // finalized cardId would overwrite the original answer — the wake must go out as fresh text.
    await instance.onTextUpdate('dm:alice', 'wake summary', reply('1'))
    await instance.onStreamComplete('dm:alice', 'wake summary', reply('1'))
    expect(requests.filter((r) => r.url.endsWith('/streaming')).length).toBe(finalizedCardWrites)
    expect(requests.filter((r) => r.url.includes('sendBySession')).map((r) => r.body.text.content)).toEqual([
      'wake summary'
    ])
  })

  it('keeps command acknowledgements in text mode without leaving a processing card behind', async () => {
    const { instance, client } = await adapter({ card_template_id: 'template' })
    client.callback(frame('compact', { text: { content: '/compact' } }))
    await tick()
    await instance.sendTypingIndicator('dm:alice', reply('compact'))
    await instance.sendMessage('dm:alice', 'compacted', reply('compact'))
    expect(requests.map((request) => request.url)).toEqual([
      'https://oapi.dingtalk.com/robot/sendBySession?session=compact'
    ])
  })

  it('suppresses all terminal delivery when requested and avoids resending uncertain cards', async () => {
    const { instance, client } = await adapter({ card_template_id: 'template' })
    client.callback(frame('1'))
    await tick()
    await instance.sendTypingIndicator('dm:alice', reply('1'))
    const count = requests.length
    expect(await instance.onStreamError('dm:alice', 'error', reply('1'), { suppressDelivery: true })).toBe(true)
    expect(requests.length).toBe(count)
    client.callback(frame('2'))
    await tick()
    vi.mocked(net.fetch).mockImplementation(async (url) =>
      String(url).endsWith('/deliver') ? response({ result: [{ success: false }] }) : success(String(url))
    )
    await instance.sendTypingIndicator('dm:alice', reply('2'))
    await expect(instance.onStreamComplete('dm:alice', 'answer', reply('2'))).rejects.toThrow(
      t('common.dingtalk_delivery_failed')
    )
  })
})
