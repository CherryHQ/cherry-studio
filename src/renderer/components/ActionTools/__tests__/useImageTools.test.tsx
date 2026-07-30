import { useImageTools } from '@renderer/components/ActionTools'
import { toast } from '@renderer/services/toast'
import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  svgToPngBlob: vi.fn(),
  svgToSvgBlob: vi.fn(),
  download: vi.fn(),
  showImagePreview: vi.fn()
}))

vi.mock('@renderer/utils/image', () => ({
  svgToPngBlob: mocks.svgToPngBlob,
  svgToSvgBlob: mocks.svgToSvgBlob
}))

vi.mock('@renderer/utils/download', () => ({
  download: mocks.download
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/services/ImagePreviewService', () => ({
  ImagePreviewService: {
    show: mocks.showImagePreview
  }
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'light'
  })
}))

const writeToClipboard = vi.fn()
const createObjectURL = vi.fn()
const revokeObjectURL = vi.fn()

class MockClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}

class MockDOMMatrix {
  m41 = 0
  m42 = 0

  constructor(transform?: string) {
    const translate = transform?.match(/translate\(([^,]+),\s*([^)]+)\)/)
    if (translate) {
      this.m41 = Number.parseFloat(translate[1])
      this.m42 = Number.parseFloat(translate[2])
    }
  }
}

const createImageFixture = () => {
  const container = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  container.appendChild(svg)
  document.body.appendChild(container)

  return {
    container,
    svg,
    containerRef: { current: container }
  }
}

describe('useImageTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.svgToPngBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    mocks.svgToSvgBlob.mockReturnValue(new Blob(['svg'], { type: 'image/svg+xml' }))
    mocks.download.mockResolvedValue(undefined)
    mocks.showImagePreview.mockResolvedValue(undefined)
    writeToClipboard.mockResolvedValue(undefined)
    createObjectURL.mockReturnValue('blob:test-image')

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: writeToClipboard }
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL
    })
    vi.stubGlobal('ClipboardItem', MockClipboardItem)
    vi.stubGlobal('DOMMatrix', MockDOMMatrix)
    vi.spyOn(Date, 'now').mockReturnValue(1234)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('applies pan and bounded zoom transformations', () => {
    const { svg, containerRef } = createImageFixture()
    const { result } = renderHook(() => useImageTools(containerRef, { prefix: 'diagram', imgSelector: 'svg' }))

    act(() => {
      result.current.pan(12, 8, true)
      result.current.pan(-2, 4)
      result.current.zoom(0.5)
    })

    expect(result.current.getCurrentTransform()).toEqual({ scale: 1.5, x: 10, y: 12 })
    expect(svg.style.transform).toBe('translate(10px, 12px) scale(1.5)')

    act(() => {
      result.current.zoom(10, true)
    })
    expect(result.current.getCurrentTransform().scale).toBe(3)

    act(() => {
      result.current.zoom(-10, true)
    })
    expect(result.current.getCurrentTransform().scale).toBe(0.1)
  })

  it('supports dragging and modifier-wheel zoom', () => {
    const { container, svg, containerRef } = createImageFixture()
    const { result } = renderHook(() =>
      useImageTools(containerRef, {
        prefix: 'diagram',
        imgSelector: 'svg',
        enableDrag: true,
        enableWheelZoom: true
      })
    )

    fireEvent.mouseDown(container, { button: 0, clientX: 10, clientY: 20 })
    fireEvent.mouseMove(document, { clientX: 25, clientY: 35 })
    fireEvent.mouseUp(document, { clientX: 25, clientY: 35 })
    fireEvent.wheel(svg, { bubbles: true, ctrlKey: true, deltaY: -1 })

    expect(result.current.getCurrentTransform()).toEqual({ scale: 1.1, x: 15, y: 15 })
    expect(svg.style.transform).toBe('translate(15px, 15px) scale(1.1)')
    expect(container.style.cursor).toBe('default')
  })

  it('copies a clean PNG representation to the clipboard', async () => {
    const { svg, containerRef } = createImageFixture()
    const { result } = renderHook(() => useImageTools(containerRef, { prefix: 'diagram', imgSelector: 'svg' }))
    svg.style.transform = 'translate(20px, 10px) scale(2)'
    svg.style.transformOrigin = 'top left'

    await act(() => result.current.copy())

    const convertedSvg = mocks.svgToPngBlob.mock.calls[0][0] as SVGElement
    expect(convertedSvg).not.toBe(svg)
    expect(convertedSvg.style.transform).toBe('')
    expect(convertedSvg.style.transformOrigin).toBe('')
    expect(writeToClipboard).toHaveBeenCalledWith([expect.any(MockClipboardItem)])
    expect(toast.success).toHaveBeenCalledWith('message.copy.success')
  })

  it('downloads clean SVG and PNG representations', async () => {
    const { svg, containerRef } = createImageFixture()
    const { result } = renderHook(() => useImageTools(containerRef, { prefix: 'diagram', imgSelector: 'svg' }))
    svg.style.transform = 'translate(20px, 10px) scale(2)'

    await act(async () => {
      await result.current.download('svg')
      await result.current.download('png')
    })

    expect(mocks.svgToSvgBlob).toHaveBeenCalledOnce()
    expect(mocks.svgToPngBlob).toHaveBeenCalledOnce()
    expect(mocks.download).toHaveBeenNthCalledWith(1, 'blob:test-image', 'diagram-1234.svg')
    expect(mocks.download).toHaveBeenNthCalledWith(2, 'blob:test-image', 'diagram-1234.png')
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('opens a clean SVG in the image preview', async () => {
    const { svg, containerRef } = createImageFixture()
    const { result } = renderHook(() => useImageTools(containerRef, { prefix: 'diagram', imgSelector: 'svg' }))
    svg.style.transform = 'translate(20px, 10px) scale(2)'

    await act(() => result.current.dialog())

    const previewSvg = mocks.showImagePreview.mock.calls[0][0] as SVGElement
    expect(previewSvg).not.toBe(svg)
    expect(previewSvg.style.transform).toBe('')
    expect(mocks.showImagePreview).toHaveBeenCalledWith(previewSvg, { format: 'svg' })
  })

  it('reports failures from copy, download, and preview actions', async () => {
    const { containerRef } = createImageFixture()
    const { result } = renderHook(() => useImageTools(containerRef, { prefix: 'diagram', imgSelector: 'svg' }))
    mocks.svgToPngBlob.mockRejectedValue(new Error('conversion failed'))
    mocks.showImagePreview.mockRejectedValue(new Error('preview failed'))

    await act(async () => {
      await result.current.copy()
      await result.current.download('png')
      await result.current.dialog()
    })

    expect(toast.error).toHaveBeenCalledWith('message.copy.failed')
    expect(toast.error).toHaveBeenCalledWith('message.download.failed')
    expect(toast.error).toHaveBeenCalledWith('message.dialog.failed')
  })
})
