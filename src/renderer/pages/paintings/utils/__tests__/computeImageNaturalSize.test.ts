import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetImageBlobFromSource = vi.hoisted(() => vi.fn())
vi.mock('@renderer/utils/image', () => ({
  getImageBlobFromSource: mockGetImageBlobFromSource
}))

const { computeImageNaturalSize } = await import('../computeImageNaturalSize')

describe('computeImageNaturalSize', () => {
  let close: ReturnType<typeof vi.fn>

  const stubBitmap = (width: number, height: number) => {
    close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width, height, close }))
  }

  beforeEach(() => {
    mockGetImageBlobFromSource.mockReset().mockResolvedValue(new Blob())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the decoded bitmap dimensions and closes the bitmap', async () => {
    stubBitmap(1024, 768)

    const result = await computeImageNaturalSize('file:///tmp/image.png')

    expect(result).toEqual({ naturalWidth: 1024, naturalHeight: 768 })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('returns null when decoding the source throws', async () => {
    mockGetImageBlobFromSource.mockRejectedValue(new Error('bad source'))

    const result = await computeImageNaturalSize('file:///bad.png')

    expect(result).toBeNull()
  })

  it('closes the bitmap even when reading its size throws after it is created', async () => {
    close = vi.fn()
    // A bitmap whose size read fails simulates a failure after the bitmap exists —
    // the `finally` must still release it.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        get width(): number {
          throw new Error('width read failed')
        },
        height: 64,
        close
      })
    )

    const result = await computeImageNaturalSize('file:///tmp/image.png')

    expect(result).toBeNull()
    expect(close).toHaveBeenCalledTimes(1)
  })
})
