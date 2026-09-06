import { type Canvas, createCanvas } from '@napi-rs/canvas'
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
  IMAGE_CAPTURE_ATTRIBUTE,
  imageInputToPreviewUrl,
  makeSvgSizeAdaptive,
  MAX_ENTITY_IMAGE_UPLOAD_BYTES,
  prepareEntityImageBytes,
  transformImageToPng
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
  describe('transformImageToPng', () => {
    const sourcePixels = [
      ['A', [255, 0, 0, 255]],
      ['B', [0, 255, 0, 255]],
      ['C', [0, 0, 255, 255]],
      ['D', [255, 255, 0, 255]],
      ['E', [255, 0, 255, 255]],
      ['F', [0, 255, 255, 255]]
    ] as const
    const labelByRgb = new Map(sourcePixels.map(([label, [red, green, blue]]) => [`${red},${green},${blue}`, label]))
    let closeBitmap: ReturnType<typeof vi.fn>
    let outputCanvas: Canvas

    beforeEach(() => {
      const sourceCanvas = createCanvas(2, 3)
      const sourceContext = sourceCanvas.getContext('2d')
      const sourceImageData = sourceContext.createImageData(2, 3)
      sourceImageData.data.set(sourcePixels.flatMap(([, rgba]) => rgba))
      sourceContext.putImageData(sourceImageData, 0, 0)
      closeBitmap = vi.fn()
      Object.assign(sourceCanvas, { close: closeBitmap })
      vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(sourceCanvas))

      const createElement = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
        if (tagName !== 'canvas') {
          return createElement(tagName, options)
        }

        outputCanvas = createCanvas(1, 1)
        Object.assign(outputCanvas, {
          toBlob: (callback: BlobCallback, type?: string) => callback(new Blob(['png'], { type }))
        })
        return outputCanvas as unknown as HTMLCanvasElement
      }) as typeof document.createElement)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it.each([
      ['rotation=90', { flipX: false, flipY: false, rotation: 90 }, 3, 2, ['E', 'C', 'A', 'F', 'D', 'B']],
      ['rotation=180', { flipX: false, flipY: false, rotation: 180 }, 2, 3, ['F', 'E', 'D', 'C', 'B', 'A']],
      ['rotation=270', { flipX: false, flipY: false, rotation: 270 }, 3, 2, ['B', 'D', 'F', 'A', 'C', 'E']],
      ['rotation=-90', { flipX: false, flipY: false, rotation: -90 }, 3, 2, ['B', 'D', 'F', 'A', 'C', 'E']],
      ['flipX', { flipX: true, flipY: false, rotation: 0 }, 2, 3, ['B', 'A', 'D', 'C', 'F', 'E']],
      ['flipY', { flipX: false, flipY: true, rotation: 0 }, 2, 3, ['E', 'F', 'C', 'D', 'A', 'B']]
    ])('bakes $0 into the output dimensions and pixels', async (_name, transform, width, height, expectedPixels) => {
      const result = await transformImageToPng(new Blob(['source'], { type: 'image/png' }), transform)
      const imageData = outputCanvas.getContext('2d').getImageData(0, 0, outputCanvas.width, outputCanvas.height)
      const actualPixels = Array.from({ length: outputCanvas.width * outputCanvas.height }, (_, index) => {
        const offset = index * 4
        return labelByRgb.get(`${imageData.data[offset]},${imageData.data[offset + 1]},${imageData.data[offset + 2]}`)
      })

      expect(result.type).toBe('image/png')
      expect([outputCanvas.width, outputCanvas.height]).toEqual([width, height])
      expect(actualPixels).toEqual(expectedPixels)
      expect(closeBitmap).toHaveBeenCalledOnce()
    })

    it('expands the output canvas to preserve image corners at an arbitrary angle', async () => {
      await transformImageToPng(new Blob(['source'], { type: 'image/png' }), {
        flipX: false,
        flipY: false,
        rotation: 45
      })

      expect([outputCanvas.width, outputCanvas.height]).toEqual([4, 4])
    })
  })

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

    it('marks the capture root during capture and removes the marker afterward', async () => {
      const finalCanvas = { toDataURL: vi.fn(() => 'final') } as unknown as HTMLCanvasElement
      const div = document.createElement('div')
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })

      vi.mocked(htmlToImage.toCanvas).mockImplementation(async (node) => {
        expect(node.hasAttribute(IMAGE_CAPTURE_ATTRIBUTE)).toBe(true)
        return finalCanvas
      })

      const ref = { current: div } as React.RefObject<HTMLDivElement>
      await expect(captureScrollable(ref)).resolves.toBe(finalCanvas)
      expect(div.hasAttribute(IMAGE_CAPTURE_ATTRIBUTE)).toBe(false)
    })

    it('removes the capture marker when capture fails', async () => {
      vi.mocked(htmlToImage.toCanvas).mockRejectedValue(new Error('capture failed'))

      const div = document.createElement('div')
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>

      await expect(captureScrollable(ref)).rejects.toThrow('capture failed')
      expect(div.hasAttribute(IMAGE_CAPTURE_ATTRIBUTE)).toBe(false)
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
        options: { mode: 'full', encoding: 'binary' }
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

    it('applies full-content styles only to the html-to-image clone', async () => {
      const div = document.createElement('div')
      div.style.height = '120px'
      div.style.maxHeight = '240px'
      div.style.overflow = 'auto'
      div.style.position = 'relative'
      div.scrollTop = 32
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 360, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>

      vi.mocked(htmlToImage.toCanvas).mockImplementation(async (_node, options) => {
        expect(options).toMatchObject({
          width: 100,
          height: 360,
          canvasWidth: 100,
          canvasHeight: 360,
          style: {
            height: 'auto',
            maxHeight: 'none',
            overflow: 'visible',
            position: 'static',
            scrollbarWidth: 'none'
          }
        })
        expect(div.style.height).toBe('120px')
        expect(div.style.maxHeight).toBe('240px')
        expect(div.style.overflow).toBe('auto')
        expect(div.style.position).toBe('relative')
        expect(div.scrollTop).toBe(32)
        return { toDataURL: vi.fn(() => 'final') } as unknown as HTMLCanvasElement
      })

      await captureScrollable(ref)
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

  describe('imageInputToPreviewUrl', () => {
    let previewBlob: Blob | undefined
    let createObjectUrlDescriptor: PropertyDescriptor | undefined
    const readBlob = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsText(blob)
      })

    beforeEach(() => {
      previewBlob = undefined
      createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: vi.fn((blob: Blob) => {
          previewBlob = blob
          return 'blob:svg-preview'
        })
      })
    })

    afterEach(() => {
      if (createObjectUrlDescriptor) {
        Object.defineProperty(URL, 'createObjectURL', createObjectUrlDescriptor)
      } else {
        Reflect.deleteProperty(URL, 'createObjectURL')
      }
    })

    it('restores viewBox dimensions on a responsive SVG preview without mutating the live node', async () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 960 480')
      svg.setAttribute('width', '100%')
      svg.style.maxWidth = '960px'
      svg.innerHTML = '<text x="20" y="40">First line</text><text x="20" y="80">Second line</text>'

      await expect(imageInputToPreviewUrl(svg, { format: 'svg' })).resolves.toBe('blob:svg-preview')

      expect(svg.getAttribute('width')).toBe('100%')
      expect(svg.hasAttribute('height')).toBe(false)

      const previewSvg = new DOMParser().parseFromString(await readBlob(previewBlob!), 'image/svg+xml').documentElement
      expect(previewSvg.getAttribute('width')).toBe('960')
      expect(previewSvg.getAttribute('height')).toBe('480')
      expect(previewSvg.getAttribute('viewBox')).toBe('0 0 960 480')
      expect(previewSvg.textContent).toContain('First line')
      expect(previewSvg.textContent).toContain('Second line')
    })

    it('preserves an SVG that already has positive intrinsic dimensions', async () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 800 400')
      svg.setAttribute('width', '320px')
      svg.setAttribute('height', '180px')

      await imageInputToPreviewUrl(svg, { format: 'svg' })

      const previewSvg = new DOMParser().parseFromString(await readBlob(previewBlob!), 'image/svg+xml').documentElement
      expect(previewSvg.getAttribute('width')).toBe('320px')
      expect(previewSvg.getAttribute('height')).toBe('180px')
    })

    it.each([
      ['width only', '1600', null],
      ['height only', null, '900'],
      ['relative width', '20em', null],
      ['signed and trailing-decimal lengths', '+320', '180.']
    ])('preserves valid %s SVG sizing', async (_label, width, height) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 16 9')
      if (width !== null) svg.setAttribute('width', width)
      if (height !== null) svg.setAttribute('height', height)

      await imageInputToPreviewUrl(svg, { format: 'svg' })

      const previewSvg = new DOMParser().parseFromString(await readBlob(previewBlob!), 'image/svg+xml').documentElement
      expect(previewSvg.getAttribute('width')).toBe(width)
      expect(previewSvg.getAttribute('height')).toBe(height)
    })

    it('replaces a non-finite SVG length with finite viewBox dimensions', async () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 800 400')
      svg.setAttribute('width', '1e309px')

      await imageInputToPreviewUrl(svg, { format: 'svg' })

      const previewSvg = new DOMParser().parseFromString(await readBlob(previewBlob!), 'image/svg+xml').documentElement
      expect(previewSvg.getAttribute('width')).toBe('800')
      expect(previewSvg.getAttribute('height')).toBe('400')
    })

    it.each(['NaN 0 800 400', '0 Infinity 800 400'])(
      'does not derive intrinsic dimensions from an invalid viewBox origin: %s',
      async (viewBox) => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('viewBox', viewBox)
        svg.setAttribute('width', '100%')

        await imageInputToPreviewUrl(svg, { format: 'svg' })

        const previewSvg = new DOMParser().parseFromString(
          await readBlob(previewBlob!),
          'image/svg+xml'
        ).documentElement
        expect(previewSvg.getAttribute('width')).toBe('100%')
        expect(previewSvg.hasAttribute('height')).toBe(false)
      }
    )
  })

  describe('getImageBlobFromSource', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
      fetchMock.mockReset().mockResolvedValue({
        ok: true,
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
        options: { mode: 'full', encoding: 'binary' }
      })
      expect(blob.type).toBe('image/png')
    })

    it('reads image blobs from remote URLs', async () => {
      const blob = await getImageBlobFromSource('https://example.com/image.webp')

      expect(fetchMock).toHaveBeenCalledWith('https://example.com/image.webp')
      expect(blob.type).toBe('image/webp')
    })

    it('throws on a non-ok remote response instead of returning the error page', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404, blob: async () => new Blob(['gone']) })

      await expect(getImageBlobFromSource('https://example.com/gone.webp')).rejects.toThrow('404')
    })

    it('throws when a 200 response carries non-image content (proxy/login page)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(['<html>signin</html>'], { type: 'text/html' })
      })

      await expect(getImageBlobFromSource('https://cdn.example.com/wallpaper.png')).rejects.toThrow('not an image')
    })

    it('accepts a remote blob with an empty content type', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['bytes']) })

      const blob = await getImageBlobFromSource('https://example.com/unknown.bin')

      expect(blob.type).toBe('')
    })

    it('accepts a remote image served as octet-stream (mislabelled, not a non-image)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(['imagedata'], { type: 'application/octet-stream' })
      })

      const blob = await getImageBlobFromSource('https://cdn.example.com/mislabeled.png')

      expect(blob.type).toBe('application/octet-stream')
    })

    it('trims the content type before judging it (stray whitespace does not reject an image)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(['png'], { type: ' image/png' })
      })

      const blob = await getImageBlobFromSource('https://cdn.example.com/padded.png')

      expect(blob.type).toBe(' image/png')
    })

    it('rejects a non-image content type carrying header parameters', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(['<html/>'], { type: 'text/html; charset=utf-8' })
      })

      await expect(getImageBlobFromSource('https://cdn.example.com/signin')).rejects.toThrow('not an image')
    })

    it('accepts an octet-stream local file (extension-less entries are real images)', async () => {
      ipcMocks.request.mockResolvedValueOnce({
        content: new Uint8Array([1, 2, 3]),
        mime: 'application/octet-stream',
        version: { mtime: 1, size: 3 }
      })

      const blob = await getImageBlobFromSource('file:///data/Files/noext')

      expect(blob.type).toBe('application/octet-stream')
    })

    it('throws on a data URL with no media type', async () => {
      await expect(getImageBlobFromSource('data:;base64,aGVsbG8=')).rejects.toThrow('Invalid image data URL')
    })
  })

  describe('captureScrollableImage (native compositor capture)', () => {
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect

    const stubGeometry = (el: HTMLElement, width: number, height: number) => {
      Object.defineProperty(el, 'scrollWidth', { value: width, configurable: true })
      Object.defineProperty(el, 'scrollHeight', { value: height, configurable: true })
      el.getBoundingClientRect = () => rect(10, 20, width, height)
    }

    const originalDocumentElementRect = document.documentElement.getBoundingClientRect.bind(document.documentElement)

    afterEach(() => {
      document.documentElement.getBoundingClientRect = originalDocumentElementRect
    })

    it('returns the native capture result without touching the html-to-image pipeline', async () => {
      ipcMocks.request.mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,bmF0aXZl' })
      const div = document.createElement('div')
      stubGeometry(div, 800, 600)
      document.documentElement.getBoundingClientRect = () => rect(0, 0, 4000, 3000)

      const result = await captureScrollableAsDataUrl({ current: div })

      expect(result).toBe('data:image/png;base64,bmF0aXZl')
      expect(ipcMocks.request).toHaveBeenCalledWith('window.capture_screenshot', {
        clip: { x: 10, y: 20, width: 800, height: 600 },
        scale: 1
      })
      expect(htmlToImage.toCanvas).not.toHaveBeenCalled()
    })

    it('restores inline styles and the capture marker after a native capture', async () => {
      ipcMocks.request.mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,bmF0aXZl' })
      const div = document.createElement('div')
      stubGeometry(div, 800, 600)
      document.documentElement.getBoundingClientRect = () => rect(0, 0, 4000, 3000)

      await captureScrollableAsDataUrl({ current: div })

      expect(div.style.overflow).toBe('')
      expect(div.style.height).toBe('')
      expect(div.style.maxHeight).toBe('')
      expect(div.hasAttribute(IMAGE_CAPTURE_ATTRIBUTE)).toBe(false)
    })

    it('falls back to the html-to-image pipeline when the native path rejects', async () => {
      ipcMocks.request.mockRejectedValueOnce(new Error('CDP attach failed'))
      const div = document.createElement('div')
      stubGeometry(div, 800, 600)
      document.documentElement.getBoundingClientRect = () => rect(0, 0, 4000, 3000)

      const result = await captureScrollableAsDataUrl({ current: div })

      expect(result).toBe('data:image/png;base64,xxx')
      expect(htmlToImage.toCanvas).toHaveBeenCalled()
    })

    it('skips the native path for an element with no measurable size', async () => {
      const div = document.createElement('div')

      const result = await captureScrollableAsDataUrl({ current: div })

      expect(ipcMocks.request).not.toHaveBeenCalled()
      expect(result).toBe('data:image/png;base64,xxx')
    })

    it('skips the native path when the clip would exceed composited-surface limits', async () => {
      const div = document.createElement('div')
      stubGeometry(div, 20000, 100)
      document.documentElement.getBoundingClientRect = () => rect(0, 0, 40000, 3000)

      await captureScrollableAsDataUrl({ current: div })

      expect(ipcMocks.request).not.toHaveBeenCalled()
      expect(htmlToImage.toCanvas).toHaveBeenCalled()
    })

    it('feeds the native data URL to the blob callback via fetch', async () => {
      ipcMocks.request.mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,bmF0aXZl' })
      const div = document.createElement('div')
      stubGeometry(div, 800, 600)
      document.documentElement.getBoundingClientRect = () => rect(0, 0, 4000, 3000)

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({ blob: async () => new Blob(['native'], { type: 'image/png' }) } as Response)

      const blob = await new Promise<Blob | null>((resolve) =>
        captureScrollableAsBlob({ current: div }, (result) => resolve(result))
      )

      expect(fetchSpy).toHaveBeenCalledWith('data:image/png;base64,bmF0aXZl')
      expect(blob).toBeInstanceOf(Blob)
      expect(blob?.type).toBe('image/png')
      fetchSpy.mockRestore()
    })
  })
})
