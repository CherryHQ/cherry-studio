import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFeishuHttpInstance } from '../FeishuHttpInstance'

function okResponse(payload: unknown = { code: 0 }) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    body: null,
    text: async () => JSON.stringify(payload)
  } as unknown as Response
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

  it('builds a multipart FormData from a plain object with a Buffer field', async () => {
    const http = createFeishuHttpInstance()

    await http.post(
      'https://open.feishu.cn/open-apis/im/v1/images',
      { image_type: 'message', image: Buffer.from('PNGDATA') },
      { headers: { 'Content-Type': 'multipart/form-data' } }
    )

    const [, init] = fetchMock.mock.calls[0]
    expect(init.body).toBeInstanceOf(FormData)

    const form = init.body as FormData
    expect(form.get('image_type')).toBe('message')

    const filePart = form.get('image')
    expect(filePart).toBeInstanceOf(Blob)
    expect(await (filePart as Blob).text()).toBe('PNGDATA')

    // The boundary-less Content-Type must be dropped so fetch can set one with a boundary.
    const headers = (init.headers ?? {}) as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
    expect(headers['content-type']).toBeUndefined()
  })

  it('serializes a plain object as JSON when not multipart', async () => {
    const http = createFeishuHttpInstance()

    await http.post('https://open.feishu.cn/open-apis/im/v1/messages', { msg_type: 'text' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.body).toBe(JSON.stringify({ msg_type: 'text' }))
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('passes a string body through unchanged', async () => {
    const http = createFeishuHttpInstance()

    await http.post('https://example.com', 'raw-body')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.body).toBe('raw-body')
  })

  it('throws with status detail on non-ok responses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers(),
      body: null,
      text: async () => JSON.stringify({ msg: 'invalid file' })
    } as unknown as Response)

    const http = createFeishuHttpInstance()

    await expect(http.post('https://example.com', { a: 1 })).rejects.toThrow('Feishu HTTP 400: invalid file')
  })
})
