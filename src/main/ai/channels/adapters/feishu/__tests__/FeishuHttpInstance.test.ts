import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFeishuHttpInstance } from '../FeishuHttpInstance'

function okResponse(payload: unknown = { code: 0 }) {
  return Response.json(payload, { status: 200, statusText: 'OK' })
}

describe('createFeishuHttpInstance', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['Content-Type', 'cOnTeNt-TyPe'])(
    'uploads the exact Buffer slice and handles the %s header case-insensitively',
    async (contentTypeHeader) => {
      const http = createFeishuHttpInstance()
      const image = Buffer.from('xxPNGDATAyy').subarray(2, 9)

      await http.post(
        'https://open.feishu.cn/open-apis/im/v1/images',
        { image_type: 'message', image },
        { headers: { [contentTypeHeader]: 'multipart/form-data' } }
      )

      const [, init] = fetchMock.mock.calls[0]
      expect(init.body).toBeInstanceOf(FormData)

      const form = init.body as FormData
      expect(form.get('image_type')).toBe('message')

      const filePart = form.get('image')
      expect(filePart).toBeInstanceOf(Blob)
      image.fill(0)
      expect(filePart).toHaveProperty('size', 7)
      expect(await (filePart as Blob).text()).toBe('PNGDATA')

      // The boundary-less Content-Type must be dropped so fetch can set one with a boundary.
      expect(new Headers(init.headers).has('content-type')).toBe(false)
    }
  )

  it('serializes a plain object as JSON when not multipart', async () => {
    const http = createFeishuHttpInstance()

    await http.post('https://open.feishu.cn/open-apis/im/v1/messages', { msg_type: 'text' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.body).toBe(JSON.stringify({ msg_type: 'text' }))
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
  })

  it('passes a string body through unchanged', async () => {
    const http = createFeishuHttpInstance()

    await http.post('https://example.com', 'raw-body')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.body).toBe('raw-body')
  })

  it('throws with status detail on non-ok responses', async () => {
    fetchMock.mockResolvedValue(Response.json({ msg: 'invalid file' }, { status: 400, statusText: 'Bad Request' }))

    const http = createFeishuHttpInstance()

    await expect(http.post('https://example.com', { a: 1 })).rejects.toThrow('Feishu HTTP 400: invalid file')
  })
})
