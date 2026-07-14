import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })
  }
}))

const mockNetFetch = vi.fn()

vi.mock('electron', () => ({
  net: { fetch: (...args: unknown[]) => mockNetFetch(...args) }
}))

const { downloadImageAsBase64 } = await import('../downloadAsBase64')

function binaryResponse(bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  } as unknown as Response
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
const UNKNOWN_BYTES = new Uint8Array([0x01, 0x02, 0x03, 0x04])

describe('downloadImageAsBase64', () => {
  beforeEach(() => {
    mockNetFetch.mockReset()
  })

  it('uses image bytes ahead of a generic response header', async () => {
    mockNetFetch.mockResolvedValue(binaryResponse(PNG_BYTES, { 'content-type': 'application/octet-stream' }))

    const result = await downloadImageAsBase64('https://example.com/generated')

    expect(result?.media_type).toBe('image/png')
    expect(result?.data).toBe(Buffer.from(PNG_BYTES).toString('base64'))
  })

  it('uses image bytes ahead of an incorrect image response header', async () => {
    mockNetFetch.mockResolvedValue(binaryResponse(WEBP_BYTES, { 'content-type': 'image/png' }))

    const result = await downloadImageAsBase64('https://example.com/generated.png')

    expect(result?.media_type).toBe('image/webp')
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

    await expect(downloadImageAsBase64('https://example.com/result.avif?token=1')).resolves.toMatchObject({
      media_type: 'image/avif'
    })
    await expect(downloadImageAsBase64('https://example.com/download')).resolves.toMatchObject({
      media_type: 'image/svg+xml'
    })
  })

  it('returns null when no image evidence is available', async () => {
    mockNetFetch.mockResolvedValue(binaryResponse(UNKNOWN_BYTES, { 'content-type': 'application/octet-stream' }))

    await expect(downloadImageAsBase64('https://example.com/download')).resolves.toBeNull()
  })
})
