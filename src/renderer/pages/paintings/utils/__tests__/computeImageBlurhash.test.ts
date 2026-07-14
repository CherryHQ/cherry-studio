import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetImageBlobFromSource = vi.hoisted(() => vi.fn())
vi.mock('@renderer/components/ImageViewer', () => ({
  getImageBlobFromSource: mockGetImageBlobFromSource
}))

const mockEncode = vi.hoisted(() => vi.fn())
vi.mock('blurhash', () => ({
  encode: mockEncode
}))

const { computeImageBlurhash } = await import('../computeImageBlurhash')

const BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'

describe('computeImageBlurhash', () => {
  let close: ReturnType<typeof vi.fn>
  let drawImage: ReturnType<typeof vi.fn>
  let getImageData: ReturnType<typeof vi.fn>

  const stubBitmap = (width: number, height: number) => {
    close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width, height, close }))
  }

  const stubContext = (context: unknown) => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
  }

  beforeEach(() => {
    mockGetImageBlobFromSource.mockReset().mockResolvedValue(new Blob())
    mockEncode.mockReset().mockReturnValue(BLURHASH)
    drawImage = vi.fn()
    getImageData = vi.fn((_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('downscales the longest edge to 32px before encoding and returns the natural size', async () => {
    stubBitmap(64, 32)
    stubContext({ drawImage, getImageData })

    const result = await computeImageBlurhash('file:///tmp/image.png')

    // scale = min(1, 32/64) = 0.5 → a 32x16 encode surface; natural size is the original.
    expect(getImageData).toHaveBeenCalledWith(0, 0, 32, 16)
    expect(mockEncode).toHaveBeenCalledWith(expect.any(Uint8ClampedArray), 32, 16, 4, 3)
    expect(result).toEqual({ blurhash: BLURHASH, naturalWidth: 64, naturalHeight: 32 })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('never upscales an image already smaller than the cap', async () => {
    stubBitmap(10, 4)
    stubContext({ drawImage, getImageData })

    await computeImageBlurhash('file:///tmp/tiny.png')

    // scale = min(1, 32/10) = 1 → the source dimensions are used unchanged.
    expect(getImageData).toHaveBeenCalledWith(0, 0, 10, 4)
  })

  it('floors each axis at 1px so a very thin image still encodes', async () => {
    stubBitmap(1, 100)
    stubContext({ drawImage, getImageData })

    await computeImageBlurhash('file:///tmp/thin.png')

    // scale = 32/100 = 0.32 → width rounds to 0 but is floored to 1; height → 32.
    expect(getImageData).toHaveBeenCalledWith(0, 0, 1, 32)
  })

  it('returns null and still closes the bitmap when the 2d context is unavailable', async () => {
    stubBitmap(64, 64)
    stubContext(null)

    const result = await computeImageBlurhash('file:///tmp/image.png')

    expect(result).toBeNull()
    expect(mockEncode).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('returns null when decoding the source throws', async () => {
    mockGetImageBlobFromSource.mockRejectedValue(new Error('bad source'))

    const result = await computeImageBlurhash('file:///bad.png')

    expect(result).toBeNull()
  })

  it('closes the bitmap even when reading pixels throws after it is created', async () => {
    stubBitmap(64, 64)
    getImageData = vi.fn(() => {
      throw new Error('getImageData failed')
    })
    stubContext({ drawImage, getImageData })

    const result = await computeImageBlurhash('file:///tmp/image.png')

    expect(result).toBeNull()
    expect(close).toHaveBeenCalledTimes(1)
  })
})
