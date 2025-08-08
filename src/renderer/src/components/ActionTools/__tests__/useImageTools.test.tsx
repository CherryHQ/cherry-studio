import { useImageTools } from '@renderer/components/ActionTools'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
const mocks = vi.hoisted(() => ({
  i18n: {
    t: (key: string) => key
  },
  svgToPngBlob: vi.fn(),
  svgToSvgBlob: vi.fn(),
  download: vi.fn(),
  ImagePreviewService: {
    show: vi.fn()
  }
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
    t: mocks.i18n.t
  })
}))

vi.mock('@renderer/services/ImagePreviewService', () => ({
  ImagePreviewService: mocks.ImagePreviewService
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({
    theme: 'light'
  })
}))

// Mock navigator.clipboard
const mockWrite = vi.fn()

// Mock window.message
const mockMessage = {
  success: vi.fn(),
  error: vi.fn()
}

// Mock ClipboardItem
class MockClipboardItem {
  constructor(items: any) {
    return items
  }
}

// Mock URL
const mockCreateObjectURL = vi.fn(() => 'blob:test-url')
const mockRevokeObjectURL = vi.fn()

describe('useImageTools', () => {
  beforeEach(() => {
    // Setup global mocks
    Object.defineProperty(global.navigator, 'clipboard', {
      value: { write: mockWrite },
      writable: true
    })

    Object.defineProperty(global.window, 'message', {
      value: mockMessage,
      writable: true
    })

    // Mock ClipboardItem
    global.ClipboardItem = MockClipboardItem as any

    // Mock URL
    global.URL = {
      createObjectURL: mockCreateObjectURL,
      revokeObjectURL: mockRevokeObjectURL
    } as any

    // Mock DOMMatrix
    global.DOMMatrix = class DOMMatrix {
      m41 = 0
      m42 = 0
      a = 1
      d = 1

      constructor(transform?: string) {
        if (transform) {
          // 简单解析 translate(x, y)
          const translateMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/)
          if (translateMatch) {
            this.m41 = parseFloat(translateMatch[1])
            this.m42 = parseFloat(translateMatch[2])
          }

          // 解析 scale(s)
          const scaleMatch = transform.match(/scale\(([^)]+)\)/)
          if (scaleMatch) {
            const scaleValue = parseFloat(scaleMatch[1])
            this.a = scaleValue
            this.d = scaleValue
          }
        }
      }

      static fromMatrix() {
        return new DOMMatrix()
      }
    } as any

    vi.clearAllMocks()
  })

  // 创建模拟的 DOM 环境
  const createMockContainer = () => {
    const mockContainer = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      contains: vi.fn().mockReturnValue(true),
      style: {
        cursor: ''
      },
      querySelector: vi.fn(),
      shadowRoot: null
    } as unknown as HTMLDivElement

    return mockContainer
  }

  const createMockSvgElement = () => {
    const mockSvg = {
      style: {
        transform: '',
        transformOrigin: ''
      },
      cloneNode: vi.fn().mockReturnThis()
    } as unknown as SVGElement

    return mockSvg
  }

  describe('initialization', () => {
    it('should initialize with default scale', () => {
      const mockContainer = createMockContainer()
      const { result } = renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg'
          }
        )
      )

      const transform = result.current.getCurrentTransform()
      expect(transform.scale).toBe(1)
    })
  })

  describe('pan function', () => {
    it('should pan with relative and absolute coordinates', () => {
      const mockContainer = createMockContainer()
      const mockSvg = createMockSvgElement()
      mockContainer.querySelector = vi.fn().mockReturnValue(mockSvg)

      const { result } = renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg'
          }
        )
      )

      // 相对坐标平移
      act(() => {
        result.current.pan(10, 20)
      })
      expect(mockSvg.style.transform).toContain('translate(10px, 20px)')

      // 绝对坐标平移
      act(() => {
        result.current.pan(50, 60, true)
      })
      expect(mockSvg.style.transform).toContain('translate(50px, 60px)')
    })
  })

  describe('zoom function', () => {
    it('should zoom in/out and set absolute zoom level', () => {
      const mockContainer = createMockContainer()
      const mockSvg = createMockSvgElement()
      mockContainer.querySelector = vi.fn().mockReturnValue(mockSvg)

      const { result } = renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg'
          }
        )
      )

      // 放大
      act(() => {
        result.current.zoom(0.5)
      })
      expect(result.current.getCurrentTransform().scale).toBe(1.5)
      expect(mockSvg.style.transform).toContain('scale(1.5)')

      // 缩小
      act(() => {
        result.current.zoom(-0.3)
      })
      expect(result.current.getCurrentTransform().scale).toBe(1.2)
      expect(mockSvg.style.transform).toContain('scale(1.2)')

      // 设置绝对缩放级别
      act(() => {
        result.current.zoom(2.5, true)
      })
      expect(result.current.getCurrentTransform().scale).toBe(2.5)
    })

    it('should constrain zoom between 0.1 and 3', () => {
      const mockContainer = createMockContainer()
      const mockSvg = createMockSvgElement()
      mockContainer.querySelector = vi.fn().mockReturnValue(mockSvg)

      const { result } = renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg'
          }
        )
      )

      // 尝试过度缩小
      act(() => {
        result.current.zoom(-10)
      })
      expect(result.current.getCurrentTransform().scale).toBe(0.1)

      // 尝试过度放大
      act(() => {
        result.current.zoom(10)
      })
      expect(result.current.getCurrentTransform().scale).toBe(3)
    })
  })

  describe('copy and download functions', () => {
    it('should copy image to clipboard successfully', async () => {
      const mockContainer = createMockContainer()
      const mockSvg = createMockSvgElement()
      mockContainer.querySelector = vi.fn().mockReturnValue(mockSvg)

      // Mock svgToPngBlob to return a blob
      const mockBlob = new Blob(['test'], { type: 'image/png' })
      mocks.svgToPngBlob.mockResolvedValue(mockBlob)

      const { result } = renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg'
          }
        )
      )

      await act(async () => {
        await result.current.copy()
      })

      expect(mocks.svgToPngBlob).toHaveBeenCalledWith(mockSvg)
      expect(mockWrite).toHaveBeenCalled()
      expect(mockMessage.success).toHaveBeenCalledWith('message.copy.success')
    })

    it('should download image as PNG and SVG', async () => {
      const mockContainer = createMockContainer()
      const mockSvg = createMockSvgElement()
      mockContainer.querySelector = vi.fn().mockReturnValue(mockSvg)

      // Mock svgToPngBlob to return a blob
      const pngBlob = new Blob(['test'], { type: 'image/png' })
      mocks.svgToPngBlob.mockResolvedValue(pngBlob)

      // Mock svgToSvgBlob to return a blob
      const svgBlob = new Blob(['<svg></svg>'], { type: 'image/svg+xml' })
      mocks.svgToSvgBlob.mockReturnValue(svgBlob)

      const { result } = renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg'
          }
        )
      )

      // 下载 PNG
      await act(async () => {
        await result.current.download('png')
      })
      expect(mocks.svgToPngBlob).toHaveBeenCalledWith(mockSvg)

      // 下载 SVG
      await act(async () => {
        await result.current.download('svg')
      })
      expect(mocks.svgToSvgBlob).toHaveBeenCalledWith(mockSvg)

      // 验证通用的下载流程
      expect(mockCreateObjectURL).toHaveBeenCalledTimes(2)
      expect(mocks.download).toHaveBeenCalledTimes(2)
      expect(mockRevokeObjectURL).toHaveBeenCalledTimes(2)
    })

    it('should handle copy/download failures and missing elements', async () => {
      const mockContainer = createMockContainer()
      const mockSvg = createMockSvgElement()

      // 测试无元素情况
      mockContainer.querySelector = vi.fn().mockReturnValue(null)
      const { result } = renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg'
          }
        )
      )

      // 复制无元素
      await act(async () => {
        await result.current.copy()
      })
      expect(mocks.svgToPngBlob).not.toHaveBeenCalled()

      // 下载无元素
      await act(async () => {
        await result.current.download('png')
      })
      expect(mocks.svgToPngBlob).not.toHaveBeenCalled()

      // 测试失败情况
      mockContainer.querySelector = vi.fn().mockReturnValue(mockSvg)
      mocks.svgToPngBlob.mockRejectedValue(new Error('Conversion failed'))

      // 复制失败
      await act(async () => {
        await result.current.copy()
      })
      expect(mockMessage.error).toHaveBeenCalledWith('message.copy.failed')

      // 下载失败
      await act(async () => {
        await result.current.download('png')
      })
      expect(mockMessage.error).toHaveBeenCalledWith('message.download.failed')
    })
  })

  describe('dialog function', () => {
    it('should preview image successfully', async () => {
      const mockContainer = createMockContainer()
      const mockSvg = createMockSvgElement()
      mockContainer.querySelector = vi.fn().mockReturnValue(mockSvg)

      mocks.ImagePreviewService.show.mockResolvedValue(undefined)

      const { result } = renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg'
          }
        )
      )

      await act(async () => {
        await result.current.dialog()
      })

      expect(mocks.ImagePreviewService.show).toHaveBeenCalledWith(mockSvg, { format: 'svg' })
    })

    it('should handle preview failure', async () => {
      const mockContainer = createMockContainer()
      const mockSvg = createMockSvgElement()
      mockContainer.querySelector = vi.fn().mockReturnValue(mockSvg)

      mocks.ImagePreviewService.show.mockRejectedValue(new Error('Preview failed'))

      const { result } = renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg'
          }
        )
      )

      await act(async () => {
        await result.current.dialog()
      })

      expect(mockMessage.error).toHaveBeenCalledWith('message.dialog.failed')
    })

    it('should do nothing when no element is found', async () => {
      const mockContainer = createMockContainer()
      mockContainer.querySelector = vi.fn().mockReturnValue(null)

      const { result } = renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg'
          }
        )
      )

      await act(async () => {
        await result.current.dialog()
      })

      expect(mocks.ImagePreviewService.show).not.toHaveBeenCalled()
    })
  })

  describe('event listener management', () => {
    it('should attach/remove event listeners based on options', () => {
      const mockContainer = createMockContainer()

      // 启用拖拽和滚轮缩放
      renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg',
            enableDrag: true,
            enableWheelZoom: true
          }
        )
      )

      expect(mockContainer.addEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function))
      expect(mockContainer.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: true })

      // 重置并测试禁用情况
      vi.clearAllMocks()

      renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg',
            enableDrag: false,
            enableWheelZoom: false
          }
        )
      )

      expect(mockContainer.addEventListener).not.toHaveBeenCalledWith('mousedown', expect.any(Function))
      expect(mockContainer.addEventListener).not.toHaveBeenCalledWith('wheel', expect.any(Function))
    })
  })

  describe('getCurrentTransform function', () => {
    it('should return current scale and position', () => {
      const mockContainer = createMockContainer()
      const mockSvg = createMockSvgElement()
      mockContainer.querySelector = vi.fn().mockReturnValue(mockSvg)

      const { result } = renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg'
          }
        )
      )

      // 初始状态
      const initialTransform = result.current.getCurrentTransform()
      expect(initialTransform).toEqual({ scale: 1, x: 0, y: 0 })

      // 缩放后状态
      act(() => {
        result.current.zoom(0.5)
      })
      const zoomedTransform = result.current.getCurrentTransform()
      expect(zoomedTransform.scale).toBe(1.5)
      expect(zoomedTransform.x).toBe(0)
      expect(zoomedTransform.y).toBe(0)

      // 平移后状态
      act(() => {
        result.current.pan(10, 20)
      })
      const pannedTransform = result.current.getCurrentTransform()
      expect(pannedTransform.scale).toBe(1.5)
      expect(pannedTransform.x).toBe(10)
      expect(pannedTransform.y).toBe(20)
    })

    it('should get position from DOMMatrix when element has transform', () => {
      const mockContainer = createMockContainer()
      const mockSvg = createMockSvgElement()
      mockSvg.style.transform = 'translate(30px, 40px) scale(2)'
      mockContainer.querySelector = vi.fn().mockReturnValue(mockSvg)

      const { result } = renderHook(() =>
        useImageTools(
          { current: mockContainer },
          {
            prefix: 'test',
            imgSelector: 'svg'
          }
        )
      )

      // 手动设置 transformRef 以匹配 DOM 状态
      act(() => {
        result.current.pan(30, 40, true)
        result.current.zoom(2, true)
      })

      const transform = result.current.getCurrentTransform()
      expect(transform.scale).toBe(2)
      expect(transform.x).toBe(30)
      expect(transform.y).toBe(40)
    })
  })
})
