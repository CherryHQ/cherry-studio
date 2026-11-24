import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { JSONValue } from '@ai-sdk/provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { netFetchMock } = vi.hoisted(() => ({ netFetchMock: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock }
}))

import { type IncomingMessage, WeixinBot } from '../WeChatProtocol'

const BASE_URL = 'https://ilink.example.com'
let tokenDir: string
let tokenPath: string

function jsonResponse(body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status: 200, headers })
}

function inboundMessage(item_list: unknown[]) {
  return {
    message_id: 1,
    from_user_id: 'user-1',
    to_user_id: 'bot-id',
    client_id: 'message-1',
    create_time_ms: 0,
    message_type: 1,
    message_state: 2,
    context_token: 'context-1',
    item_list
  }
}

function requestBody(callIndex: number): JSONValue {
  const options = netFetchMock.mock.calls[callIndex][1] as RequestInit
  return JSON.parse(options.body as string)
}

beforeEach(async () => {
  tokenDir = await mkdtemp(path.join(tmpdir(), 'wechat-protocol-'))
  tokenPath = path.join(tokenDir, 'credentials.json')
  await writeFile(
    tokenPath,
    JSON.stringify({ token: 'token', baseUrl: BASE_URL, accountId: 'bot-id', userId: 'bot-user' })
  )
  netFetchMock.mockReset()
})

afterEach(async () => {
  await rm(tokenDir, { recursive: true, force: true })
})

describe('WeixinBot API response validation', () => {
  it('decodes consumed inbound fields through HTTP while preserving extensions and nullish fallbacks', async () => {
    const image = {
      media: { encrypt_query_param: 'image-param', aes_key: null, future: { value: true } },
      thumb_width: 'future-shape'
    }
    const received: IncomingMessage[] = []
    const errors: unknown[] = []
    netFetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/notifystart') || url.endsWith('/notifystop')) return Promise.resolve(jsonResponse({ ret: 0 }))
      if (url.endsWith('/getupdates'))
        return Promise.resolve(
          jsonResponse({
            msgs: [
              inboundMessage([
                { type: 11, future: 'extension' },
                {},
                { type: 1, text_item: {} },
                { type: null, text_item: null },
                {
                  type: 1,
                  text_item: { text: 'hello' },
                  ref_msg: { title: 'Earlier', message_item: { type: 1, text_item: { text: 'quoted' } } }
                },
                { type: 2, image_item: image },
                { type: 4, file_item: { media: { encrypt_query_param: 'file-param' }, file_name: null } },
                { type: 3, voice_item: { media: { encrypt_query_param: 'voice-param' }, text: null, encode_type: 77 } }
              ])
            ],
            get_updates_buf: 'next'
          })
        )
      throw new Error(`Unexpected request: ${url}`)
    })
    const bot = new WeixinBot({
      tokenPath,
      onError(error) {
        errors.push(error)
        bot.stop()
      }
    })
    bot.onMessage((message) => {
      received.push(message)
      bot.stop()
    })

    await bot.run()

    expect(errors).toEqual([])
    expect(received).toHaveLength(1)
    expect(received[0].text).toContain('[quote: Earlier | quoted]\nhello')
    expect(received[0].text).toContain('[voice]')
    expect(received[0]._imageItems).toEqual([image])
    expect(received[0]._fileItems).toMatchObject([
      { filename: 'file', mediaType: 'application/octet-stream' },
      { filename: 'voice-1.silk', mediaType: 'audio/silk' }
    ])
  })

  it('retries malformed consumed fields without advancing the polling cursor or reauthenticating', async () => {
    const cursors: string[] = []
    const received: IncomingMessage[] = []
    const errors: unknown[] = []
    netFetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url.endsWith('/notifystart') || url.endsWith('/notifystop')) return Promise.resolve(jsonResponse({ ret: 0 }))
      if (url.endsWith('/getupdates')) {
        cursors.push(JSON.parse(String(options?.body)).get_updates_buf)
        return Promise.resolve(
          jsonResponse({
            msgs: [inboundMessage([{ type: 1, text_item: { text: cursors.length === 1 ? 17 : 'after retry' } }])],
            get_updates_buf: cursors.length === 1 ? 'must-not-commit' : 'valid-cursor'
          })
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const bot = new WeixinBot({
      tokenPath,
      onError(error) {
        errors.push(error)
        if (errors.length > 1) bot.stop()
      }
    })
    bot.onMessage((message) => {
      received.push(message)
      bot.stop()
    })

    await bot.run()

    expect(errors).toHaveLength(1)
    expect(cursors).toEqual(['', ''])
    expect(received.map((message) => message.text)).toEqual(['after retry'])
    expect(await bot.hasCredentials()).toBe(true)
  })

  it('restores valid context tokens beside malformed values and prototype-named keys', async () => {
    await writeFile(
      tokenPath.replace(/\.json$/, '.context-tokens.json'),
      '{"valid":"context-a","bad":17,"other":"context-b","__proto__":"literal-token"}'
    )
    netFetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ret: 0 })))
    const bot = new WeixinBot({ tokenPath })

    for (const userId of ['valid', 'other', '__proto__', 'bad']) await bot.send(userId, 'hello')

    expect(requestBody(0)).toHaveProperty('msg.context_token', 'context-a')
    expect(requestBody(1)).toHaveProperty('msg.context_token', 'context-b')
    expect(requestBody(2)).toHaveProperty('msg.context_token', 'literal-token')
    expect(requestBody(3)).toHaveProperty('msg.context_token', '')
  })

  it('reports an unprintable message-handler rejection without replacing it or aborting the polling loop', async () => {
    const failure = { toString: null }
    const reported: unknown[] = []
    netFetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/notifystart') || url.endsWith('/notifystop')) return Promise.resolve(jsonResponse({ ret: 0 }))
      if (url.endsWith('/getupdates')) {
        return Promise.resolve(
          jsonResponse({
            msgs: [
              {
                message_id: 1,
                from_user_id: 'user-1',
                to_user_id: 'bot-id',
                client_id: 'message-1',
                create_time_ms: 0,
                message_type: 1,
                message_state: 2,
                context_token: 'context-1',
                item_list: [{ type: 1, text_item: { text: 'hello' } }]
              }
            ],
            get_updates_buf: 'next'
          })
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const bot = new WeixinBot({
      tokenPath,
      onError(error) {
        reported.push(error)
        bot.stop()
      }
    })
    bot.onMessage(() => {
      throw failure
    })

    await expect(bot.run()).resolves.toBeUndefined()
    expect(reported).toHaveLength(1)
    expect(reported[0]).toBe(failure)
  })

  it.each([
    {
      body: 'unavailable',
      status: 503,
      message: '/ilink/bot/sendmessage returned non-JSON (HTTP 503)',
      code: undefined
    },
    {
      body: JSON.stringify({ errmsg: 'token expired', errcode: 401 }),
      status: 401,
      message: 'token expired',
      code: 401
    },
    {
      body: JSON.stringify({ ret: -14, errmsg: 'session expired' }),
      status: 200,
      message: 'session expired',
      code: -14
    }
  ])('keeps protocol errors ahead of acknowledgement parsing: $message', async ({ body, status, message, code }) => {
    netFetchMock.mockResolvedValueOnce(new Response(body, { status }))
    const bot = new WeixinBot({ tokenPath })
    await expect(bot.send('user-1', 'hello')).rejects.toMatchObject({ name: 'ApiError', status, message, code })
  })

  it.each([null, { ret: 0 }])('accepts a successful status-only acknowledgement: %j', async (body) => {
    netFetchMock.mockResolvedValueOnce(jsonResponse(body))
    const bot = new WeixinBot({ tokenPath })
    await expect(bot.send('user-1', 'hello')).resolves.toBeUndefined()
  })

  it('rejects malformed QR response fields before starting login polling', async () => {
    netFetchMock.mockResolvedValueOnce(jsonResponse({ qrcode: 42, qrcode_img_content: 'qr-image' }))
    const bot = new WeixinBot({ tokenPath })
    await expect(bot.login({ force: true })).rejects.toMatchObject({
      name: 'ZodError',
      issues: [expect.objectContaining({ path: ['qrcode'], expected: 'string' })]
    })
  })
})

describe('WeixinBot media protocol', () => {
  it('uploads and sends a document as a native FILE item', async () => {
    netFetchMock
      .mockResolvedValueOnce(jsonResponse({ upload_param: 'upload-token' }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'x-encrypted-param': 'download-token' } }))
      .mockResolvedValueOnce(jsonResponse({ ret: 0 }))

    const bot = new WeixinBot({ tokenPath })
    await bot.sendFile('user-1', 'report.pdf', Buffer.from('pdf'), 'application/pdf')

    expect(netFetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/ilink/bot/getuploadurl`)
    expect(requestBody(0)).toMatchObject({ media_type: 3, rawsize: 3, filesize: 16, to_user_id: 'user-1' })
    expect(netFetchMock.mock.calls[1][0]).toContain('encrypted_query_param=upload-token')

    expect(requestBody(2)).toHaveProperty('msg.item_list', [
      {
        type: 4,
        file_item: {
          file_name: 'report.pdf',
          len: '3',
          media: expect.objectContaining({ encrypt_query_param: 'download-token' })
        }
      }
    ])
  })

  it('uploads and sends a video as a native VIDEO item', async () => {
    netFetchMock
      .mockResolvedValueOnce(jsonResponse({ upload_full_url: 'https://novac2c.cdn.weixin.qq.com/c2c/upload' }))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'x-encrypted-param': 'download-token' } }))
      .mockResolvedValueOnce(jsonResponse({ ret: 0 }))

    const bot = new WeixinBot({ tokenPath })
    await bot.sendFile('user-1', 'demo.mp4', Buffer.from('video'), 'video/mp4')

    expect(requestBody(0)).toMatchObject({ media_type: 2, rawsize: 5, filesize: 16, to_user_id: 'user-1' })
    expect(netFetchMock.mock.calls[1][0]).toBe('https://novac2c.cdn.weixin.qq.com/c2c/upload')

    expect(requestBody(2)).toHaveProperty('msg.item_list', [
      {
        type: 5,
        video_item: {
          video_size: 16,
          media: expect.objectContaining({ encrypt_query_param: 'download-token' })
        }
      }
    ])
  })

  it('keeps the originating context token while media upload is in flight', async () => {
    let resolveUploadUrl!: (response: Response) => void
    netFetchMock
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveUploadUrl = resolve)))
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'x-encrypted-param': 'download-token' } }))
      .mockResolvedValueOnce(jsonResponse({ ret: 0 }))

    const bot = new WeixinBot({ tokenPath })
    const contextTokens = bot['contextTokens']
    contextTokens.set('user-1', 'context-before-upload')

    const sending = bot.sendFile('user-1', 'report.pdf', Buffer.from('pdf'), 'application/pdf')
    await vi.waitFor(() => expect(netFetchMock).toHaveBeenCalledTimes(1))
    contextTokens.set('user-1', 'context-after-upload')
    resolveUploadUrl(jsonResponse({ upload_param: 'upload-token' }))
    await sending

    expect(requestBody(2)).toHaveProperty('msg.context_token', 'context-before-upload')
  })

  it('stops polling without waiting for the lifecycle notification', async () => {
    netFetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url.endsWith('/notifystart')) return Promise.resolve(jsonResponse({ ret: 0 }))
      if (url.endsWith('/notifystop')) return new Promise(() => {})
      if (url.endsWith('/getupdates')) {
        return new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          )
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const bot = new WeixinBot({ tokenPath })
    const run = bot.run()
    await vi.waitFor(() => expect(netFetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/ilink/bot/msg/notifystart`))

    expect(bot.stop()).toBeUndefined()
    await run

    expect(netFetchMock.mock.calls.map(([url]) => url)).toContain(`${BASE_URL}/ilink/bot/msg/notifystop`)
  })

  it('normalizes inbound file, video, and voice media for the channel adapter', () => {
    const bot = new WeixinBot({ tokenPath })
    const incoming = bot['toIncomingMessage']({
      message_id: 42,
      from_user_id: 'user-1',
      to_user_id: 'bot-user',
      client_id: 'client-1',
      create_time_ms: 0,
      message_type: 1,
      message_state: 2,
      context_token: 'context-1',
      item_list: [
        { type: 4, file_item: { file_name: 'report.pdf', media: { encrypt_query_param: 'file-token' } } },
        { type: 5, video_item: { media: { encrypt_query_param: 'video-token' } } },
        { type: 3, voice_item: { encode_type: 7, text: 'hello', media: { encrypt_query_param: 'voice-token' } } },
        {
          type: 1,
          text_item: { text: 'follow-up' },
          ref_msg: { title: 'Earlier message', message_item: { type: 1, text_item: { text: 'original message' } } }
        }
      ]
    })
    if (!incoming) throw new Error('Expected the inbound user message to be accepted')

    expect(incoming.text).toContain('[quote: Earlier message | original message]')
    expect(incoming.text).toContain('hello')
    expect(incoming.text).toContain('follow-up')
    expect(incoming._fileItems).toMatchObject([
      { filename: 'report.pdf', mediaType: 'application/octet-stream' },
      { filename: 'video-42.mp4', mediaType: 'video/mp4' },
      { filename: 'voice-42.mp3', mediaType: 'audio/mpeg' }
    ])
  })
})
