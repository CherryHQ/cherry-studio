import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  captureDiv,
  captureScrollableDiv,
  captureScrollableDivAsBlob,
  captureScrollableDivAsDataURL,
  compressImage,
  convertToBase64
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
})
