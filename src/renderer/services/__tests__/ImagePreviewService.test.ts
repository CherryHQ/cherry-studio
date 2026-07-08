import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ImagePreviewService } from '../ImagePreviewService'

// The service no longer processes inputs itself: it delegates input→URL resolution to
// `imageInputToPreviewUrl` (in @renderer/utils/image) and then hands the URL to a
// createPopup popup. So the test mocks both seams and asserts the delegation contract,
// not the (now-relocated) SVG/blob conversion details.
const mocks = vi.hoisted(() => ({
  imageInputToPreviewUrl: vi.fn(),
  popupShow: vi.fn(async () => undefined)
}))

vi.mock('@renderer/utils/image', () => ({
  imageInputToPreviewUrl: mocks.imageInputToPreviewUrl
}))

// Opt out of the global popup mock with a locally controllable createPopup so the test
// can observe the URL forwarded to the popup's show().
vi.mock('@renderer/services/popup', () => ({
  createPopup: vi.fn(() => ({ show: mocks.popupShow, hide: vi.fn() }))
}))

describe('ImagePreviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.imageInputToPreviewUrl.mockResolvedValue('blob:mock-url')
    mocks.popupShow.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('show', () => {
    it('should delegate SVG element input with PNG format/scale to imageInputToPreviewUrl and show the popup', async () => {
      const mockSvgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const options = { format: 'png', scale: 2 } as const

      await expect(ImagePreviewService.show(mockSvgElement, options)).resolves.toBeUndefined()

      expect(mocks.imageInputToPreviewUrl).toHaveBeenCalledWith(mockSvgElement, options)
      expect(mocks.popupShow).toHaveBeenCalledWith({ src: 'blob:mock-url' })
    })

    it('should delegate SVG element input with SVG format to imageInputToPreviewUrl and show the popup', async () => {
      const mockSvgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const options = { format: 'svg' } as const

      await expect(ImagePreviewService.show(mockSvgElement, options)).resolves.toBeUndefined()

      expect(mocks.imageInputToPreviewUrl).toHaveBeenCalledWith(mockSvgElement, options)
      expect(mocks.popupShow).toHaveBeenCalledWith({ src: 'blob:mock-url' })
    })

    it('should delegate string URL input to imageInputToPreviewUrl and show the popup', async () => {
      const imageUrl = 'https://example.com/image.png'
      mocks.imageInputToPreviewUrl.mockResolvedValueOnce(imageUrl)

      await expect(ImagePreviewService.show(imageUrl)).resolves.toBeUndefined()

      expect(mocks.imageInputToPreviewUrl).toHaveBeenCalledWith(imageUrl, {})
      expect(mocks.popupShow).toHaveBeenCalledWith({ src: imageUrl })
    })

    it('should delegate Blob input to imageInputToPreviewUrl and show the popup', async () => {
      const mockBlob = new Blob(['mock'], { type: 'image/png' })

      await expect(ImagePreviewService.show(mockBlob)).resolves.toBeUndefined()

      expect(mocks.imageInputToPreviewUrl).toHaveBeenCalledWith(mockBlob, {})
      expect(mocks.popupShow).toHaveBeenCalledWith({ src: 'blob:mock-url' })
    })

    it('should delegate HTMLImageElement input to imageInputToPreviewUrl and show the popup', async () => {
      const mockImg = document.createElement('img')
      mockImg.src = 'https://example.com/image.png'
      mocks.imageInputToPreviewUrl.mockResolvedValueOnce(mockImg.src)

      await expect(ImagePreviewService.show(mockImg)).resolves.toBeUndefined()

      expect(mocks.imageInputToPreviewUrl).toHaveBeenCalledWith(mockImg, {})
      expect(mocks.popupShow).toHaveBeenCalledWith({ src: mockImg.src })
    })

    it('should reject and not show the popup when imageInputToPreviewUrl rejects (unsupported input type)', async () => {
      mocks.imageInputToPreviewUrl.mockRejectedValueOnce(new Error('Unsupported input type'))
      const unsupportedInput = { invalid: 'input' } as any

      await expect(ImagePreviewService.show(unsupportedInput)).rejects.toThrow('Unsupported input type')

      expect(mocks.popupShow).not.toHaveBeenCalled()
    })

    it('should default options to an empty object when not provided', async () => {
      const mockSvgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')

      await ImagePreviewService.show(mockSvgElement)

      expect(mocks.imageInputToPreviewUrl).toHaveBeenCalledWith(mockSvgElement, {})
    })
  })
})
