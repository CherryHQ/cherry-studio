import { net } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { t } from '@main/i18n'

import { DINGTALK_FILE_BYTES, DingTalkApi } from '../dingtalk/DingTalkApi'

const config = {
  client_id: 'app',
  client_secret: 'secret',
  robot_code: 'robot',
  allowed_chat_ids: [],
  allowed_user_ids: []
}
const file = {
  filename: 'report.pdf',
  data: Buffer.from('hello').toString('base64'),
  size: 5,
  media_type: 'application/pdf'
}
const json = (data: unknown) => new Response(JSON.stringify(data))
const token = () => json({ accessToken: 'token', expireIn: 7200 })
afterEach(() => vi.restoreAllMocks())

describe('DingTalk HTTP delivery', () => {
  it.each([
    { errcode: 40014, errmsg: 'secret' },
    { code: 'Forbidden', message: 'secret' },
    { processQueryKey: 'q', invalidStaffIdList: ['alice'] },
    { processQueryKey: 'q', flowControlledStaffIdList: ['alice'] },
    { success: false },
    {}
  ])('rejects business failure in HTTP 200 without exposing server text: %j', async (failure) => {
    const fetch = vi
      .spyOn(net, 'fetch')
      .mockImplementation(async (url) => (String(url).endsWith('/accessToken') ? token() : json(failure)))
    const api = new DingTalkApi(config, new AbortController().signal)
    await expect(api.sendText('dm:alice', 'hello')).rejects.toThrow(t('common.dingtalk_delivery_failed'))
    expect(fetch.mock.calls.length).toBe(2)
  })

  it('coalesces concurrent token refresh and sends a file with the actual bytes and target', async () => {
    const requests: { url: string; body: any }[] = []
    vi.spyOn(net, 'fetch').mockImplementation(async (url, init) => {
      const body = init!.body instanceof FormData ? init!.body : JSON.parse(String(init!.body))
      requests.push({ url: String(url), body })
      if (String(url).endsWith('/accessToken')) return token()
      if (String(url).includes('/media/upload')) return json({ errcode: 0, media_id: '@media' })
      return json({ processQueryKey: 'q' })
    })
    const api = new DingTalkApi(config, new AbortController().signal)
    await Promise.all([api.sendFile('group:team', file), api.sendText('dm:alice', 'hello')])
    expect(requests.filter((r) => r.url.endsWith('/accessToken')).length).toBe(1)
    const media = requests.find((r) => r.body instanceof FormData)!.body.get('media') as File
    expect(media.name).toBe('report.pdf')
    expect(await media.text()).toBe('hello')
    expect(requests.at(-1)!.body).toEqual({
      robotCode: 'robot',
      openConversationId: 'team',
      msgKey: 'sampleFile',
      msgParam: JSON.stringify({ mediaId: '@media', fileName: 'report.pdf', fileType: 'pdf' })
    })
  })

  it.each([0, DINGTALK_FILE_BYTES + 1])(
    'checks actual decoded size %i before fetching even when reported size is false',
    async (size) => {
      const fetch = vi.spyOn(net, 'fetch')
      const api = new DingTalkApi(config, new AbortController().signal)
      await expect(
        api.sendFile('dm:alice', { ...file, size: 5, data: Buffer.alloc(size).toString('base64') })
      ).rejects.toThrow(t('common.dingtalk_file_size'))
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('accepts the inclusive upload boundary without altering file bytes', async () => {
    const bytes = Buffer.alloc(DINGTALK_FILE_BYTES, 3)
    let uploaded: Buffer | undefined
    vi.spyOn(net, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).endsWith('/accessToken')) return token()
      if (init?.body instanceof FormData) {
        uploaded = Buffer.from(await (init.body.get('media') as File).arrayBuffer())
        return json({ errcode: 0, media_id: 'media' })
      }
      return json({ processQueryKey: 'q' })
    })
    await new DingTalkApi(config, new AbortController().signal).sendFile('dm:alice', {
      ...file,
      data: bytes.toString('base64'),
      size: bytes.length
    })
    expect(uploaded?.equals(bytes)).toBe(true)
  })

  it('never sends a file after an upload fails or the channel is disabled', async () => {
    const controller = new AbortController()
    const urls: string[] = []
    vi.spyOn(net, 'fetch').mockImplementation(async (url) => {
      urls.push(String(url))
      if (String(url).endsWith('/accessToken')) return token()
      controller.abort()
      return json({ errcode: 0, media_id: 'media' })
    })
    await expect(new DingTalkApi(config, controller.signal).sendFile('dm:alice', file)).rejects.toThrow()
    expect(urls.some((url) => url.includes('/batchSend'))).toBe(false)
  })

  it('forbids redirects and bounds response reads', async () => {
    const fetch = vi.spyOn(net, 'fetch').mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1)))
    const api = new DingTalkApi(config, new AbortController().signal)
    await expect(api.sendText('dm:alice', 'hello')).rejects.toThrow(t('common.dingtalk_delivery_failed'))
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
  })
})
