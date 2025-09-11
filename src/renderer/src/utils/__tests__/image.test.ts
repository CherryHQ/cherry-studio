import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  captureElement,
  captureScrollable,
  captureScrollableAsBlob,
  captureScrollableAsDataURL,
  compressImage,
  convertToBase64,
  makeSvgSizeAdaptive
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

// mock window.toast
beforeEach(() => {
  window.toast = {
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
      await expect(captureScrollable(ref)).rejects.toBeUndefined()
      expect(window.toast.error).toHaveBeenCalled()
    })
  })

  describe('captureScrollableAsDataURL', () => {
    it('should return data url when canvas exists', async () => {
      const div = document.createElement('div')
      Object.defineProperty(div, 'scrollWidth', { value: 100, configurable: true })
      Object.defineProperty(div, 'scrollHeight', { value: 100, configurable: true })
      const ref = { current: div } as React.RefObject<HTMLDivElement>
      const result = await captureScrollableAsDataURL(ref)
      expect(result).toMatch(/^data:image\/png;base64/)
    })

    it('should return undefined when canvas is undefined', async () => {
      const ref = { current: null } as unknown as React.RefObject<HTMLDivElement>
      const result = await captureScrollableAsDataURL(ref)
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
})
