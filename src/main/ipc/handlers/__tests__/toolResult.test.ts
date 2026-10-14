import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())
const lookupMock = vi.hoisted(() => vi.fn())
vi.mock('node:http', () => ({ request: requestMock }))
vi.mock('node:https', () => ({ request: requestMock }))
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

import { toolResultHandlers } from '../toolResult'

const preview = (url = 'https://example.com/image', imageHint = false) =>
  toolResultHandlers['tool_result.preview_image']({ url, imageHint }, { senderId: 'w1' })

function respond(headers: IncomingMessage['headers'], statusCode = 200, body = 'image') {
  requestMock.mockImplementationOnce((options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const response = Object.assign(new EventEmitter(), { headers, statusCode, resume: vi.fn(), destroy: vi.fn() })
    queueMicrotask(() => {
      callback(response as unknown as IncomingMessage)
      if (options.method !== 'HEAD') response.emit('data', Buffer.from(body))
      response.emit('end')
    })
    return Object.assign(new EventEmitter(), { end: vi.fn() })
  })
}

beforeEach(() => {
  requestMock.mockReset()
  lookupMock.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('app.fetch.allow_private_network', true)
})

describe('tool-result image preview', () => {
  it('detects extensionless images with HEAD and returns bytes instead of an unchecked URL', async () => {
    respond({ 'content-type': 'IMAGE/PNG; charset=binary', 'content-length': '9000000' })
    respond({ 'content-type': 'image/png' })
    await expect(preview()).resolves.toBe('data:image/png;base64,aW1hZ2U=')
    expect(requestMock.mock.calls.map(([options]) => options.method)).toEqual(['HEAD', 'GET'])
    const lookupCallback = vi.fn()
    requestMock.mock.calls[1][0].lookup('example.com', {}, lookupCallback)
    expect(lookupCallback).toHaveBeenCalledWith(null, '93.184.216.34', 4)
  })

  it.each(['http://127.0.0.1:18080/action', 'http://192.168.1.1/action', 'http://[::1]/action'])(
    'never requests %s even with an image hint and private-network preference enabled',
    async (url) => {
      await expect(preview(url, true)).resolves.toBeNull()
      expect(requestMock).not.toHaveBeenCalled()
    }
  )

  it('rejects a hostname resolving to a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    await expect(preview(undefined, true)).resolves.toBeNull()
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('revalidates DNS for the image GET after a successful HEAD', async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    respond({ 'content-type': 'image/png' })
    await expect(preview()).resolves.toBeNull()
    expect(requestMock.mock.calls.map(([options]) => options.method)).toEqual(['HEAD'])
  })

  it.each(['HEAD', 'GET'])('rejects redirects into the private network during %s', async (method) => {
    if (method === 'GET') respond({ 'content-type': 'image/png' })
    respond({ location: 'http://127.0.0.1/action' }, 302)
    await expect(preview()).resolves.toBeNull()
    expect(requestMock.mock.calls.map(([options]) => options.method)).toEqual(
      method === 'GET' ? ['HEAD', 'GET'] : ['HEAD']
    )
  })

  it('keeps HTML as a link even when the tool claims it is an image', async () => {
    respond({ 'content-type': 'text/html' })
    await expect(preview(undefined, true)).resolves.toBeNull()
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('uses the image hint only when HEAD is unsupported, and validates the GET type', async () => {
    respond({}, 405)
    respond({ 'content-type': 'text/html' })
    await expect(preview(undefined, true)).resolves.toBeNull()
    expect(requestMock.mock.calls.map(([options]) => options.method)).toEqual(['HEAD', 'GET'])
  })

  it.each([200, 405])('loads a hinted image when HEAD has no MIME type (status %s)', async (status) => {
    respond({}, status)
    respond({ 'content-type': 'image/webp' })
    await expect(preview(undefined, true)).resolves.toBe('data:image/webp;base64,aW1hZ2U=')
  })

  it('keeps unknown links clickable when HEAD is unavailable', async () => {
    respond({}, 405)
    await expect(preview()).resolves.toBeNull()
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized image bodies even without Content-Length', async () => {
    respond({ 'content-type': 'image/png' })
    respond({ 'content-type': 'image/png' }, 200, 'x'.repeat(8 * 1024 * 1024 + 1))
    await expect(preview()).resolves.toBeNull()
  })
})
