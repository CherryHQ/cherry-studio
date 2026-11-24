import { Readable } from 'node:stream'

import { AxiosHeaders } from 'axios'
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

  it.each([
    { payload: { msg: 123, message: 'secondary', extension: { trace: 'keep' } }, detail: '123' },
    { payload: { msg: 0, message: 'secondary' }, detail: 'secondary' },
    { payload: { msg: { reason: 'opaque' }, message: 'secondary' }, detail: '[object Object]' },
    { payload: null, detail: 'Bad Request' },
    { payload: false, detail: 'Bad Request' }
  ])('preserves SDK error response data and truthy detail precedence: $detail', async ({ payload, detail }) => {
    fetchMock.mockResolvedValue(
      Response.json(payload, { status: 400, statusText: 'Bad Request', headers: { 'x-request-id': 'request-1' } })
    )

    await expect(createFeishuHttpInstance().post('https://example.com', {})).rejects.toMatchObject({
      message: `Feishu HTTP 400: ${detail}`,
      response: {
        data: payload,
        status: 400,
        statusText: 'Bad Request',
        headers: { 'x-request-id': 'request-1' }
      }
    })
  })

  it('keeps an empty text error body instead of substituting the status text', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 400, statusText: 'Bad Request' }))

    await expect(createFeishuHttpInstance().get('https://example.com')).rejects.toMatchObject({
      message: 'Feishu HTTP 400: '
    })
  })

  it('returns Node download bytes and response headers when requested', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0, 255, 17]), { headers: { 'x-file': 'binary' } }))

    const response = await createFeishuHttpInstance().get<unknown, { data: Readable; headers: Record<string, string> }>(
      'https://example.com/file',
      { responseType: 'stream', $return_headers: true }
    )
    expect(response.data).toBeInstanceOf(Readable)
    const chunks: Buffer[] = []
    for await (const chunk of response.data) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 255, 17]))
    expect(response.headers).toMatchObject({ 'x-file': 'binary' })
  })

  it('forwards iterable Axios headers without losing array or numeric values', async () => {
    const headers = new AxiosHeaders({ 'x-values': ['first', 'second'], 'x-count': 7, 'x-disabled': false })

    await createFeishuHttpInstance().get('https://example.com', { headers })

    const forwarded = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(forwarded.get('x-values')).toBe('first,second')
    expect(forwarded.get('x-count')).toBe('7')
    expect(forwarded.has('x-disabled')).toBe(false)
  })

  it('propagates the original network failure', async () => {
    const error = new Error('network unavailable')
    fetchMock.mockRejectedValue(error)

    await expect(createFeishuHttpInstance().get('https://example.com')).rejects.toBe(error)
  })
})
