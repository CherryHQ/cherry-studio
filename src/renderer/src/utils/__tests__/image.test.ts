import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  captureDiv,
  captureScrollableDiv,
  captureScrollableDivAsBlob,
  captureScrollableDivAsDataURL,
  compressImage,
  convertToBase64,
  makeSvgScalable
} from '../image'

// mock 依赖
vi.mock('browser-image-compression', () => ({
  default: vi.fn(() => Promise.resolve(new File(['compressed'], 'compressed.png', { type: 'image/png' })))
}))
vi.mock('html-to-image', () => ({
  toCanvas: vi.fn(() =>
    Promise.resolve({
      toDataURL: vi.fn(() => 'data:image/png;base64,xxx'),
      toBlob: vi.fn((cb) => cb(new Blob(['blob'], { type: 'image/png' })))
    })
  )
}))

// mock window.message
beforeEach(() => {
  window.message = {
    error: vi.fn()
  } as any
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

  describe('compressImage', () => {
    it('should compress image file', async () => {
      const file = new File(['img'], 'img.png', { type: 'image/png' })
      const result = await compressImage(file)
      expect(result).toBeInstanceOf(File)
      expect(result.name).toBe('compressed.png')
    })
  })

  describe('captureDiv', () => {
    it('should return image data url when divRef.current exists', async () => {
      const ref = { current: document.createElement('div') } as React.RefObject<HTMLDivElement>
      const result = await captureDiv(ref)
      expect(result).toMatch(/^data:image\/png;base64/)
    })

    it('should return undefined when divRef.current is null', async () => {
      const ref = { current: null } as unknown as React.RefObject<HTMLDivElement>
      const result = await captureDiv(ref)
      expect(result).toBeUndefined()
    })
  })

  describe('captureScrollableDiv', () => {
    it('should return canvas when divRef.current exists', async () => {
      const div = document.createElement('div')
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>
      const result = await captureScrollableDiv(ref)
      expect(result).toBeTruthy()
      expect(typeof (result as HTMLCanvasElement).toDataURL).toBe('function')
    })

    it('should return undefined when divRef.current is null', async () => {
      const ref = { current: null } as unknown as React.RefObject<HTMLDivElement>
      const result = await captureScrollableDiv(ref)
      expect(result).toBeUndefined()
    })

    it('should reject if dimension too large', async () => {
      const div = document.createElement('div')
      Object.defineProperty(div, 'scrollWidth', { value: 40000, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 40000, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>
      await expect(captureScrollableDiv(ref)).rejects.toBeUndefined()
      expect(window.message.error).toHaveBeenCalled()
    })
  })

  describe('captureScrollableDivAsDataURL', () => {
    it('should return data url when canvas exists', async () => {
      const div = document.createElement('div')
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>
      const result = await captureScrollableDivAsDataURL(ref)
      expect(result).toMatch(/^data:image\/png;base64/)
    })

    it('should return undefined when canvas is undefined', async () => {
      const ref = { current: null } as unknown as React.RefObject<HTMLDivElement>
      const result = await captureScrollableDivAsDataURL(ref)
      expect(result).toBeUndefined()
    })
  })

  describe('captureScrollableDivAsBlob', () => {
    it('should call func with blob when canvas exists', async () => {
      const div = document.createElement('div')
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>
      const func = vi.fn()
      await captureScrollableDivAsBlob(ref, func)
      expect(func).toHaveBeenCalled()
      expect(func.mock.calls[0][0]).toBeInstanceOf(Blob)
    })

    it('should not call func when canvas is undefined', async () => {
      const ref = { current: null } as unknown as React.RefObject<HTMLDivElement>
      const func = vi.fn()
      await captureScrollableDivAsBlob(ref, func)
      expect(func).not.toHaveBeenCalled()
    })
  })

  describe('makeSvgScalable', () => {
    const createSvgElement = (svgString: string): SVGElement => {
      const div = document.createElement('div')
      div.innerHTML = svgString
      return div.querySelector('svg') as SVGElement
    }

    it('should add viewBox and remove width/height when viewBox is missing', () => {
      const svgElement = createSvgElement('<svg width="800" height="600"></svg>')
      const result = makeSvgScalable(svgElement)

      expect(result.getAttribute('viewBox')).toBe('0 0 800 600')
      expect(result.hasAttribute('width')).toBe(false)
      expect(result.hasAttribute('height')).toBe(false)
    })

    it('should not overwrite existing viewBox but still remove width/height', () => {
      const svgElement = createSvgElement('<svg viewBox="0 0 50 50" width="800" height="600"></svg>')
      const result = makeSvgScalable(svgElement)

      expect(result.getAttribute('viewBox')).toBe('0 0 50 50')
      expect(result.hasAttribute('width')).toBe(false)
      expect(result.hasAttribute('height')).toBe(false)
    })

    it('should not add viewBox for non-numeric width/height but still remove them', () => {
      const svgElement = createSvgElement('<svg width="100%" height="auto"></svg>')
      const result = makeSvgScalable(svgElement)

      expect(result.hasAttribute('viewBox')).toBe(false)
      expect(result.hasAttribute('width')).toBe(false)
      expect(result.hasAttribute('height')).toBe(false)
    })

    it('should do nothing if width, height, and viewBox are missing', () => {
      const svgElement = createSvgElement('<svg><circle cx="50" cy="50" r="40" /></svg>')
      const originalOuterHTML = svgElement.outerHTML
      const result = makeSvgScalable(svgElement)

      // Check that no attributes were added
      expect(result.hasAttribute('viewBox')).toBe(false)
      expect(result.hasAttribute('width')).toBe(false)
      expect(result.hasAttribute('height')).toBe(false)
      // Check that the content is unchanged
      expect(result.outerHTML).toBe(originalOuterHTML)
    })

    it('should not add viewBox if only one dimension is present', () => {
      const svgElement = createSvgElement('<svg height="600"></svg>')
      const result = makeSvgScalable(svgElement)

      expect(result.hasAttribute('viewBox')).toBe(false)
      expect(result.hasAttribute('height')).toBe(false)
    })

    it('should return the element unchanged if it is not an SVGElement', () => {
      const divElement = document.createElement('div')
      divElement.setAttribute('width', '100')
      divElement.setAttribute('height', '100')

      const originalOuterHTML = divElement.outerHTML
      const result = makeSvgScalable(divElement)

      // Check that the element is the same object
      expect(result).toBe(divElement)
      // Check that the content is unchanged
      expect(result.outerHTML).toBe(originalOuterHTML)
      // Verify no viewBox was added
      expect(result.hasAttribute('viewBox')).toBe(false)
    })
  })
})
