import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

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

import { WeixinBot } from '../WeChatProtocol'

const BASE_URL = 'https://ilink.example.com'
let tokenDir: string
let tokenPath: string

function jsonResponse(body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status: 200, headers })
}

function requestBody(callIndex: number): Record<string, unknown> {
  const options = netFetchMock.mock.calls[callIndex][1] as RequestInit
  return JSON.parse(options.body as string) as Record<string, unknown>
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

    const sent = requestBody(2).msg as { item_list: Array<{ type: number; file_item?: Record<string, unknown> }> }
    expect(sent.item_list).toEqual([
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

    const sent = requestBody(2).msg as { item_list: Array<{ type: number; video_item?: Record<string, unknown> }> }
    expect(sent.item_list).toEqual([
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
    const contextTokens = bot as unknown as { contextTokens: Map<string, string> }
    contextTokens.contextTokens.set('user-1', 'context-before-upload')

    const sending = bot.sendFile('user-1', 'report.pdf', Buffer.from('pdf'), 'application/pdf')
    await vi.waitFor(() => expect(netFetchMock).toHaveBeenCalledTimes(1))
    contextTokens.contextTokens.set('user-1', 'context-after-upload')
    resolveUploadUrl(jsonResponse({ upload_param: 'upload-token' }))
    await sending

    const sent = requestBody(2).msg as { context_token: string }
    expect(sent.context_token).toBe('context-before-upload')
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
    const toIncomingMessage = bot as unknown as {
      toIncomingMessage: (message: Record<string, unknown>) => {
        _fileItems?: Array<{ filename: string; mediaType: string }>
        text: string
      }
    }

    const incoming = toIncomingMessage.toIncomingMessage({
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
