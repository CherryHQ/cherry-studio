import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockNetFetch = vi.mocked(net.fetch)

const { downloadImageAsBase64 } = await import('../downloadAsBase64')

function binaryResponse(bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  return new Response(Buffer.from(bytes), { headers })
}

const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
const JPEG_XL_BYTES = new Uint8Array([0xff, 0x0a])
const PDF_BYTES = new Uint8Array(Buffer.from('%PDF-', 'ascii'))
const UNKNOWN_BYTES = new Uint8Array([0x01, 0x02, 0x03, 0x04])

describe('downloadImageAsBase64', () => {
  beforeEach(() => {
    mockNetFetch.mockReset()
  })

  it('uses the injected fetch and returns the actual downloaded bytes', async () => {
    mockNetFetch.mockRejectedValue(new Error('Must use the injected request'))
    const requests: Request[] = []
    const fetch: typeof globalThis.fetch = async (url, init) => {
      requests.push(new Request(url, init))
      return binaryResponse(WEBP_BYTES)
    }
    await expect(downloadImageAsBase64('https://example.com/image', { fetch })).resolves.toEqual({
      data: Buffer.from(WEBP_BYTES).toString('base64'),
      media_type: 'image/webp'
    })
    expect(requests[0].headers.get('authorization')).toBeNull()
    expect(requests[0].headers.get('cookie')).toBeNull()
  })

  it('does not start a request after cancellation', async () => {
    const controller = new AbortController()
    controller.abort('user cancelled')
    await expect(
      downloadImageAsBase64('https://example.com/image', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockNetFetch).not.toHaveBeenCalled()
  })

  it('forwards cancellation to the request and does not turn it into a missing image', async () => {
    const controller = new AbortController()
    const response = Promise.withResolvers<Response>()
    let requestSignal: AbortSignal | null | undefined
    mockNetFetch.mockImplementation((_url, init) => {
      requestSignal = init?.signal
      return response.promise
    })
    const result = downloadImageAsBase64('https://example.com/image', { signal: controller.signal })
    controller.abort()
    response.reject(controller.signal.reason)
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestSignal).toBe(controller.signal)
  })

  it('rejects cancellation during body consumption instead of returning bytes', async () => {
    const controller = new AbortController()
    mockNetFetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(stream) {
            controller.abort()
            stream.enqueue(WEBP_BYTES)
            stream.close()
          }
        })
      )
    )
    await expect(
      downloadImageAsBase64('https://example.com/image', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('uses file-type detection ahead of a generic response header', async () => {
    mockNetFetch.mockResolvedValue(binaryResponse(JPEG_XL_BYTES, { 'content-type': 'application/octet-stream' }))

    const result = await downloadImageAsBase64('https://example.com/generated')

    expect(result?.media_type).toBe('image/jxl')
    expect(result?.data).toBe(Buffer.from(JPEG_XL_BYTES).toString('base64'))
  })

  it('uses image bytes ahead of an incorrect image response header', async () => {
    mockNetFetch.mockResolvedValue(binaryResponse(WEBP_BYTES, { 'content-type': 'image/png' }))

    const result = await downloadImageAsBase64('https://example.com/generated.png')

    expect(result?.media_type).toBe('image/webp')
  })

  it('falls back from image/octet-stream without rejecting other image content types', async () => {
    mockNetFetch
      .mockResolvedValueOnce(binaryResponse(UNKNOWN_BYTES, { 'content-type': 'image/octet-stream' }))
      .mockResolvedValueOnce(binaryResponse(UNKNOWN_BYTES, { 'content-type': 'image/jxl' }))

    await expect(downloadImageAsBase64('https://example.com/result.png')).resolves.toMatchObject({
      media_type: 'image/png'
    })
    await expect(downloadImageAsBase64('https://example.com/generated')).resolves.toMatchObject({
      media_type: 'image/jxl'
    })
  })

  it('normalizes the legacy image/jpg content type', async () => {
    mockNetFetch.mockResolvedValue(binaryResponse(UNKNOWN_BYTES, { 'content-type': 'image/jpg; charset=binary' }))

    await expect(downloadImageAsBase64('https://example.com/generated')).resolves.toMatchObject({
      media_type: 'image/jpeg'
    })
  })

  it('falls back to trusted URL and Content-Disposition image extensions', async () => {
    mockNetFetch
      .mockResolvedValueOnce(binaryResponse(UNKNOWN_BYTES, { 'content-type': 'application/octet-stream' }))
      .mockResolvedValueOnce(
        binaryResponse(UNKNOWN_BYTES, {
          'content-disposition': 'attachment; filename="generated.svg"',
          'content-type': 'application/octet-stream'
        })
      )
      .mockResolvedValueOnce(
        binaryResponse(UNKNOWN_BYTES, {
          'content-disposition': "attachment; filename*=UTF-8''generated.heic",
          'content-type': 'application/octet-stream'
        })
      )

    await expect(downloadImageAsBase64('https://example.com/result.avif?token=1')).resolves.toMatchObject({
      media_type: 'image/avif'
    })
    await expect(downloadImageAsBase64('https://example.com/download')).resolves.toMatchObject({
      media_type: 'image/svg+xml'
    })
    await expect(downloadImageAsBase64('https://example.com/download')).resolves.toMatchObject({
      media_type: 'image/heic'
    })
  })

  it('returns null when no image evidence is available', async () => {
    mockNetFetch.mockResolvedValue(binaryResponse(UNKNOWN_BYTES, { 'content-type': 'application/octet-stream' }))

    await expect(downloadImageAsBase64('https://example.com/download')).resolves.toBeNull()
  })

  it('rejects non-image file types detected from bytes', async () => {
    mockNetFetch.mockResolvedValue(binaryResponse(PDF_BYTES, { 'content-type': 'image/png' }))

    await expect(downloadImageAsBase64('https://example.com/download')).resolves.toBeNull()
  })
})
