import * as htmlToImage from 'html-to-image'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipcMocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/ipc', () => ({ ipcApi: ipcMocks }))

import {
  captureElement,
  captureScrollable,
  captureScrollableAsBlob,
  captureScrollableAsDataUrl,
  checkEntityImageSize,
  convertToBase64,
  getImageBlobFromSource,
  makeSvgSizeAdaptive,
  MAX_ENTITY_IMAGE_UPLOAD_BYTES,
  prepareEntityImageBytes
} from '../image'

// mock 依赖
vi.mock('html-to-image', () => ({
  toCanvas: vi.fn(() =>
    Promise.resolve({
      toDataURL: vi.fn(() => 'data:image/png;base64,xxx'),
      toBlob: vi.fn((cb) => cb(new Blob(['blob'], { type: 'image/png' })))
    })
  )
}))

// Deterministic i18n for checkEntityImageSize (avoids depending on real init).
vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string, opts?: Record<string, unknown>) => `${key}:${JSON.stringify(opts)}` }
}))

beforeEach(() => {
  ipcMocks.request.mockReset()
  vi.mocked(htmlToImage.toCanvas).mockReset()
  vi.mocked(htmlToImage.toCanvas).mockImplementation(() =>
    Promise.resolve({
      toDataURL: vi.fn(() => 'data:image/png;base64,xxx'),
      toBlob: vi.fn((cb) => cb(new Blob(['blob'], { type: 'image/png' })))
    } as unknown as HTMLCanvasElement)
  )
})

describe('utils/image', () => {
  describe('convertToBase64', () => {
    it('should convert file to base64 string', async () => {
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
      const result = await convertToBase64(file)
      expect(typeof result).toBe('string')
      expect(result).toMatch(/^data:/)
    })
  })

  describe('checkEntityImageSize', () => {
    const makeFile = (size: number): File => {
      const file = new File(['x'], 'avatar.png', { type: 'image/png' })
      Object.defineProperty(file, 'size', { value: size })
      return file
    }

    it('returns null when the file is within the limit', () => {
      expect(checkEntityImageSize(makeFile(MAX_ENTITY_IMAGE_UPLOAD_BYTES))).toBeNull()
    })

    it('returns a localized message when the file exceeds the limit', () => {
      const message = checkEntityImageSize(makeFile(MAX_ENTITY_IMAGE_UPLOAD_BYTES + 1))
      expect(message).toContain('message.error.avatar_image_too_large')
      expect(message).toContain('10MB')
    })
  })

  describe('prepareEntityImageBytes', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('throws a localized retry error when the canvas cannot decode the input', async () => {
      // No raw fallback: a decode failure (SVG / corrupt / odd format) surfaces so the
      // user can retry — raw bytes are never sent to main, which could not decode them.
      vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('cannot decode')))
      const file = new File(['x'], 'logo.svg', { type: 'image/svg+xml' })

      await expect(prepareEntityImageBytes(file)).rejects.toThrow('message.error.image_process_failed')
    })

    it('cover-crops the largest centered square into a 128×128 WebP', async () => {
      const close = vi.fn()
      // 200×100 landscape → centered 100×100 square (sx=50, sy=0) scaled to 128².
      vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 200, height: 100, close }))
      const drawImage = vi.fn()
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage
      } as unknown as CanvasRenderingContext2D)
      const webp = new Uint8Array([9, 8, 7])
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        cb: BlobCallback
      ) {
        cb({ arrayBuffer: async () => webp.buffer } as Blob)
      })

      const out = await prepareEntityImageBytes(new File(['x'], 'a.png', { type: 'image/png' }))

      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 50, 0, 100, 100, 0, 0, 128, 128)
      expect(out).toEqual(webp)
      expect(close).toHaveBeenCalled()
    })
  })

  describe('captureElement', () => {
    it('should return image data url when elRef.current exists', async () => {
      const ref = { current: document.createElement('div') } as React.RefObject<HTMLDivElement>
      const result = await captureElement(ref)
      expect(result).toMatch(/^data:image\/png;base64/)
    })

    it('should return undefined when elRef.current is null', async () => {
      const ref = { current: null } as unknown as React.RefObject<HTMLDivElement>
      const result = await captureElement(ref)
      expect(result).toBeUndefined()
    })

    it('should retry loading html-to-image after a failed dynamic import', async () => {
      vi.resetModules()

      let failImport = true
      vi.doMock('html-to-image', () => {
        if (failImport) {
          throw new Error('load failed')
        }

        return {
          toCanvas: vi.fn(() =>
            Promise.resolve({
              toDataURL: vi.fn(() => 'data:image/png;base64,recovered')
            })
          )
        }
      })

      try {
        const { captureElement: captureElementWithRetry } = await import('../image')
        const ref = { current: document.createElement('div') } as React.RefObject<HTMLDivElement>

        await expect(captureElementWithRetry(ref)).rejects.toBeUndefined()

        failImport = false
        await expect(captureElementWithRetry(ref)).resolves.toBe('data:image/png;base64,recovered')
      } finally {
        vi.doMock('html-to-image', () => ({
          toCanvas: htmlToImage.toCanvas
        }))
      }
    })
  })

  describe('captureScrollable', () => {
    it('should return canvas when elRef.current exists', async () => {
      const div = document.createElement('div')
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>
      const result = await captureScrollable(ref)
      expect(result).toBeTruthy()
      expect(typeof (result as HTMLCanvasElement).toDataURL).toBe('function')
    })

    it('should warm up html-to-image before returning the final canvas', async () => {
      const warmupCanvas = { toDataURL: vi.fn(() => 'warmup') } as unknown as HTMLCanvasElement
      const finalCanvas = { toDataURL: vi.fn(() => 'final') } as unknown as HTMLCanvasElement
      vi.mocked(htmlToImage.toCanvas).mockResolvedValueOnce(warmupCanvas).mockResolvedValueOnce(finalCanvas)

      const div = document.createElement('div')
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>

      const result = await captureScrollable(ref)

      expect(htmlToImage.toCanvas).toHaveBeenCalledTimes(2)
      expect(result).toBe(finalCanvas)
    })

    it('should release the warm-up canvas before the final capture', async () => {
      const warmupCanvas = { width: 100, height: 100 } as HTMLCanvasElement
      const finalCanvas = { toDataURL: vi.fn(() => 'final') } as unknown as HTMLCanvasElement
      vi.mocked(htmlToImage.toCanvas)
        .mockResolvedValueOnce(warmupCanvas)
        .mockImplementationOnce(() => {
          expect(warmupCanvas.width).toBe(0)
          expect(warmupCanvas.height).toBe(0)
          return Promise.resolve(finalCanvas)
        })

      const div = document.createElement('div')
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>

      const result = await captureScrollable(ref)

      expect(result).toBe(finalCanvas)
    })

    it('should exclude HTML artifacts from image capture', async () => {
      const div = document.createElement('div')
      const content = document.createElement('div')
      const htmlArtifact = document.createElement('div')
      htmlArtifact.setAttribute('data-html-artifact', '')
      div.append(content, htmlArtifact)
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>

      await captureScrollable(ref)

      const captureOptions = vi.mocked(htmlToImage.toCanvas).mock.calls[0]?.[1]
      expect(captureOptions?.filter?.(htmlArtifact)).toBe(false)
      expect(captureOptions?.filter?.(content)).toBe(true)
    })

    it('inlines file image sources while capturing and restores them afterward', async () => {
      ipcMocks.request.mockResolvedValue({
        content: new Uint8Array([1, 2, 3]),
        mime: 'image/webp',
        version: { mtime: 1, size: 3 }
      })

      const finalCanvas = { toDataURL: vi.fn(() => 'final') } as unknown as HTMLCanvasElement
      vi.mocked(htmlToImage.toCanvas).mockImplementation(async (node, options) => {
        expect((node.querySelector('img') as HTMLImageElement).src).toMatch(/^data:image\/webp;base64,/)
        expect(options?.imagePlaceholder).toMatch(/^data:image\//)
        return finalCanvas
      })

      const div = document.createElement('div')
      const image = document.createElement('img')
      image.src = 'file:///tmp/avatar.webp'
      image.srcset = 'file:///tmp/avatar@2x.webp 2x'
      div.appendChild(image)
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>

      await expect(captureScrollable(ref)).resolves.toBe(finalCanvas)

      expect(ipcMocks.request).toHaveBeenCalledTimes(1)
      expect(ipcMocks.request).toHaveBeenCalledWith('file.read', {
        handle: { kind: 'path', path: '/tmp/avatar.webp' },
        options: { encoding: 'binary' }
      })
      expect(image.getAttribute('src')).toBe('file:///tmp/avatar.webp')
      expect(image.getAttribute('srcset')).toBe('file:///tmp/avatar@2x.webp 2x')
    })

    it('deduplicates identical file image reads during capture', async () => {
      ipcMocks.request.mockResolvedValue({
        content: new Uint8Array([1, 2, 3]),
        mime: 'image/webp',
        version: { mtime: 1, size: 3 }
      })

      const div = document.createElement('div')
      const firstImage = document.createElement('img')
      const secondImage = document.createElement('img')
      firstImage.src = 'file:///tmp/avatar.webp'
      secondImage.src = 'file:///tmp/avatar.webp'
      div.append(firstImage, secondImage)
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>

      await captureScrollable(ref)

      expect(ipcMocks.request).toHaveBeenCalledTimes(1)
      expect(firstImage.getAttribute('src')).toBe('file:///tmp/avatar.webp')
      expect(secondImage.getAttribute('src')).toBe('file:///tmp/avatar.webp')
    })

    it('continues capture with the placeholder when a file image read fails', async () => {
      ipcMocks.request.mockRejectedValue(new Error('read failed'))
      const finalCanvas = { toDataURL: vi.fn(() => 'final') } as unknown as HTMLCanvasElement
      vi.mocked(htmlToImage.toCanvas).mockImplementation(async (node, options) => {
        const image = node.querySelector('img') as HTMLImageElement
        expect(image.getAttribute('src')).toBe('file:///tmp/missing.webp')
        expect(image.hasAttribute('srcset')).toBe(false)
        expect(options?.imagePlaceholder).toMatch(/^data:image\//)
        return finalCanvas
      })

      const div = document.createElement('div')
      const image = document.createElement('img')
      image.src = 'file:///tmp/missing.webp'
      image.srcset = 'file:///tmp/missing@2x.webp 2x'
      div.appendChild(image)
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>

      await expect(captureScrollable(ref)).resolves.toBe(finalCanvas)

      expect(image.getAttribute('src')).toBe('file:///tmp/missing.webp')
      expect(image.getAttribute('srcset')).toBe('file:///tmp/missing@2x.webp 2x')
    })

    it('restores file image sources when html-to-image capture fails', async () => {
      ipcMocks.request.mockResolvedValue({
        content: new Uint8Array([1, 2, 3]),
        mime: 'image/webp',
        version: { mtime: 1, size: 3 }
      })
      vi.mocked(htmlToImage.toCanvas).mockImplementation(async (node) => {
        expect((node.querySelector('img') as HTMLImageElement).src).toMatch(/^data:image\/webp;base64,/)
        throw new Error('capture failed')
      })

      const div = document.createElement('div')
      const image = document.createElement('img')
      image.src = 'file:///tmp/avatar.webp'
      image.srcset = 'file:///tmp/avatar@2x.webp 2x'
      div.appendChild(image)
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>

      await expect(captureScrollable(ref)).rejects.toThrow('capture failed')

      expect(image.getAttribute('src')).toBe('file:///tmp/avatar.webp')
      expect(image.getAttribute('srcset')).toBe('file:///tmp/avatar@2x.webp 2x')
    })

    it('should restore styles when html-to-image capture fails', async () => {
      vi.mocked(htmlToImage.toCanvas).mockRejectedValueOnce(new Error('capture failed'))

      const div = document.createElement('div')
      div.style.height = '120px'
      div.style.maxHeight = '240px'
      div.style.overflow = 'auto'
      div.style.position = 'relative'
      div.scrollTop = 32
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>

      await expect(captureScrollable(ref)).rejects.toThrow('capture failed')

      expect(div.style.height).toBe('120px')
      expect(div.style.maxHeight).toBe('240px')
      expect(div.style.overflow).toBe('auto')
      expect(div.style.position).toBe('relative')
      expect(div.classList.contains('hide-scrollbar')).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(div.scrollTop).toBe(32)
    })

    it('should return undefined when elRef.current is null', async () => {
      const ref = { current: null } as unknown as React.RefObject<HTMLDivElement>
      const result = await captureScrollable(ref)
      expect(result).toBeUndefined()
    })

    it('should reject if dimension too large', async () => {
      const div = document.createElement('div')
      Object.defineProperty(div, 'scrollWidth', { value: 40000, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 40000, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>
      await expect(captureScrollable(ref)).rejects.toThrow()
      expect(div.classList.contains('hide-scrollbar')).toBe(false)
    })
  })

  describe('captureScrollableAsDataUrl', () => {
    it('should return data url when canvas exists', async () => {
      const div = document.createElement('div')
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>
      const result = await captureScrollableAsDataUrl(ref)
      expect(result).toMatch(/^data:image\/png;base64/)
    })

    it('should return undefined when canvas is undefined', async () => {
      const ref = { current: null } as unknown as React.RefObject<HTMLDivElement>
      const result = await captureScrollableAsDataUrl(ref)
      expect(result).toBeUndefined()
    })
  })

  describe('captureScrollableAsBlob', () => {
    it('should call func with blob when canvas exists', async () => {
      const div = document.createElement('div')
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>
      const func = vi.fn()
      await captureScrollableAsBlob(ref, func)
      expect(func).toHaveBeenCalled()
      expect(func.mock.calls[0][0]).toBeInstanceOf(Blob)
    })

    it('should not call func when canvas is undefined', async () => {
      const ref = { current: null } as unknown as React.RefObject<HTMLDivElement>
      const func = vi.fn()
      await captureScrollableAsBlob(ref, func)
      expect(func).not.toHaveBeenCalled()
    })
  })

  describe('makeSvgSizeAdaptive', () => {
    const createSvgElement = (svgString: string): SVGElement => {
      const div = document.createElement('div')
      div.innerHTML = svgString
      const svgElement = div.querySelector<SVGElement>('svg')
      if (!svgElement) {
        throw new Error(`Test setup error: No <svg> element found in string: "${svgString}"`)
      }
      return svgElement
    }

    // Mock document.body.appendChild to avoid errors in jsdom
    beforeEach(() => {
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => ({}) as Node)
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => ({}) as Node)
    })

    it('should measure and add viewBox/max-width when viewBox is missing', () => {
      const svgElement = createSvgElement('<svg width="100pt" height="80pt"></svg>')
      // Mock the measurement result on the prototype
      const spy = vi
        .spyOn(SVGElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({ width: 133, height: 106 } as DOMRect)

      const result = makeSvgSizeAdaptive(svgElement) as SVGElement

      expect(spy).toHaveBeenCalled()
      expect(result.getAttribute('viewBox')).toBe('0 0 133 106')
      expect(result.style.maxWidth).toBe('133px')
      expect(result.getAttribute('width')).toBe('100%')
      expect(result.hasAttribute('height')).toBe(false)

      spy.mockRestore() // Clean up the prototype spy
    })

    it('should use width attribute for max-width when viewBox is present', () => {
      const svgElement = createSvgElement('<svg viewBox="0 0 50 50" width="100pt" height="80pt"></svg>')
      const spy = vi.spyOn(SVGElement.prototype, 'getBoundingClientRect') // Spy to ensure it's NOT called

      const result = makeSvgSizeAdaptive(svgElement) as SVGElement

      expect(spy).not.toHaveBeenCalled()
      expect(result.getAttribute('viewBox')).toBe('0 0 50 50')
      expect(result.style.maxWidth).toBe('100pt')
      expect(result.getAttribute('width')).toBe('100%')
      expect(result.hasAttribute('height')).toBe(false)

      spy.mockRestore()
    })

    it('should handle measurement failure gracefully', () => {
      const svgElement = createSvgElement('<svg width="100pt" height="80pt"></svg>')
      // Mock a failed measurement
      const spy = vi
        .spyOn(SVGElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({ width: 0, height: 0 } as DOMRect)

      const result = makeSvgSizeAdaptive(svgElement) as SVGElement

      expect(result.hasAttribute('viewBox')).toBe(false)
      expect(result.style.maxWidth).toBe('100pt') // Falls back to width attribute
      expect(result.getAttribute('width')).toBe('100%')

      spy.mockRestore()
    })

    it('should return the element unchanged if it is not an SVGElement', () => {
      const divElement = document.createElement('div')
      const originalOuterHTML = divElement.outerHTML
      const result = makeSvgSizeAdaptive(divElement)

      expect(result.outerHTML).toBe(originalOuterHTML)
    })
  })

  describe('getImageBlobFromSource', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
      fetchMock.mockReset().mockResolvedValue({
        blob: async () => new Blob(['remote'], { type: 'image/webp' })
      })
      ipcMocks.request.mockResolvedValue({
        content: new Uint8Array([1, 2, 3]),
        mime: 'image/png',
        version: { mtime: 1, size: 3 }
      })
      vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('reads image blobs from base64 data URLs', async () => {
      const blob = await getImageBlobFromSource('data:image/png;base64,aGVsbG8=')

      expect(blob.type).toBe('image/png')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(ipcMocks.request).not.toHaveBeenCalled()
    })

    it('decodes non-base64 inline data URLs without fetching', async () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100%"><text>hello</text></svg>'

      const blob = await getImageBlobFromSource(`data:image/svg+xml,${svg}`)

      expect(blob.type).toBe('image/svg+xml')
      expect(blob.size).toBe(new TextEncoder().encode(svg).length)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reads image blobs from file URLs', async () => {
      const blob = await getImageBlobFromSource('file:///tmp/example.png')

      expect(ipcMocks.request).toHaveBeenCalledWith('file.read', {
        handle: { kind: 'path', path: '/tmp/example.png' },
        options: { encoding: 'binary' }
      })
      expect(blob.type).toBe('image/png')
    })

    it('reads image blobs from remote URLs', async () => {
      const blob = await getImageBlobFromSource('https://example.com/image.webp')

      expect(fetchMock).toHaveBeenCalledWith('https://example.com/image.webp')
      expect(blob.type).toBe('image/webp')
    })

    it('throws on a data URL with no media type', async () => {
      await expect(getImageBlobFromSource('data:;base64,aGVsbG8=')).rejects.toThrow('Invalid image data URL')
    })
  })
})
