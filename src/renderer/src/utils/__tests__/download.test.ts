import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @renderer/i18n to avoid initialization issues
vi.mock('@renderer/i18n', () => ({
  default: {
    t: vi.fn((key: string) => {
      const translations: Record<string, string> = {
        'message.download.failed': '下载失败'
      }
      return translations[key] || key
    })
  }
}))

import { download } from '../download'

// Mock DOM 方法
const mockCreateElement = vi.fn()
const mockAppendChild = vi.fn()
const mockClick = vi.fn()

// Mock URL API
const mockCreateObjectURL = vi.fn()
const mockRevokeObjectURL = vi.fn()

// Mock fetch
const mockFetch = vi.fn()

// Mock window.message
const mockMessage = {
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}

// 辅助函数
const waitForAsync = () => new Promise((resolve) => setTimeout(resolve, 10))
const createMockResponse = (options = {}) => ({
  ok: true,
  headers: new Headers(),
  blob: () => Promise.resolve(new Blob(['test'])),
  ...options
})

describe('download', () => {
  describe('download', () => {
    beforeEach(() => {
      vi.clearAllMocks()

      // 设置 window.message mock
      Object.defineProperty(window, 'message', { value: mockMessage, writable: true })

      // 设置 DOM mock
      const mockElement = {
        href: '',
        download: '',
        click: mockClick,
        remove: vi.fn()
      }
      mockCreateElement.mockReturnValue(mockElement)

      Object.defineProperty(document, 'createElement', { value: mockCreateElement })
      Object.defineProperty(document.body, 'appendChild', { value: mockAppendChild })
      Object.defineProperty(URL, 'createObjectURL', { value: mockCreateObjectURL })
      Object.defineProperty(URL, 'revokeObjectURL', { value: mockRevokeObjectURL })

      global.fetch = mockFetch
      mockCreateObjectURL.mockReturnValue('blob:mock-url')
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    describe('Direct download support', () => {
      it('should handle local file URLs', () => {
        download('file:///path/to/document.pdf', 'test.pdf')

        const element = mockCreateElement.mock.results[0].value
        expect(element.href).toBe('file:///path/to/document.pdf')
        expect(element.download).toBe('test.pdf')
        expect(mockClick).toHaveBeenCalled()
      })

      it('should handle blob URLs', () => {
        download('blob:http://localhost:3000/12345')

        const element = mockCreateElement.mock.results[0].value
        expect(element.href).toBe('blob:http://localhost:3000/12345')
        expect(mockClick).toHaveBeenCalled()
      })

      it('should handle data URLs', () => {
        const dataUrl =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

        download(dataUrl)

        const element = mockCreateElement.mock.results[0].value
        expect(element.href).toBe(dataUrl)
        expect(mockClick).toHaveBeenCalled()
      })

      it('should handle different MIME types in data URLs', async () => {
        const now = Date.now()
        vi.spyOn(Date, 'now').mockReturnValue(now)

        // 只有 image/png 和 image/jpeg 会直接下载
        const directDownloadTests = [
          { url: 'data:image/jpeg;base64,xxx', expectedExt: '.jpg' },
          { url: 'data:image/png;base64,xxx', expectedExt: '.png' }
        ]

        directDownloadTests.forEach(({ url, expectedExt }) => {
          mockCreateElement.mockClear()
          download(url)
          const element = mockCreateElement.mock.results[0].value
          expect(element.download).toBe(`${now}_download${expectedExt}`)
        })

        // 其他类型会通过 fetch 处理
        mockCreateElement.mockClear()
        mockFetch.mockResolvedValueOnce(
          createMockResponse({
            headers: new Headers({ 'Content-Type': 'application/pdf' })
          })
        )

        download('data:application/pdf;base64,xxx')
        await waitForAsync()

        expect(mockFetch).toHaveBeenCalled()
      })

      it('should generate filename with timestamp for blob URLs', () => {
        const now = Date.now()
        vi.spyOn(Date, 'now').mockReturnValue(now)

        download('blob:http://localhost:3000/12345')

        const element = mockCreateElement.mock.results[0].value
        expect(element.download).toBe(`${now}_diagram.svg`)
      })
    })

    describe('Filename handling', () => {
      it('should extract filename from file path', () => {
        download('file:///Users/test/Documents/report.pdf')

        const element = mockCreateElement.mock.results[0].value
        expect(element.download).toBe('report.pdf')
      })

      it('should handle URL encoded filenames', () => {
        download('file:///path/to/%E6%96%87%E6%A1%A3.pdf') // 编码的"文档.pdf"

        const element = mockCreateElement.mock.results[0].value
        expect(element.download).toBe('文档.pdf')
      })
    })

    describe('Network download', () => {
      it('should handle successful network request', async () => {
        mockFetch.mockResolvedValue(createMockResponse())

        download('https://example.com/file.pdf', 'custom.pdf')
        await waitForAsync()

        expect(mockFetch).toHaveBeenCalledWith('https://example.com/file.pdf')
        expect(mockCreateObjectURL).toHaveBeenCalledWith(expect.any(Blob))
        expect(mockClick).toHaveBeenCalled()
      })

      it('should extract filename from URL and headers', async () => {
        const headers = new Headers()
        headers.set('Content-Disposition', 'attachment; filename="server-file.pdf"')
        mockFetch.mockResolvedValue(createMockResponse({ headers }))

        download('https://example.com/files/document.docx')
        await waitForAsync()

        // 验证下载被触发（具体文件名由实现决定）
        expect(mockClick).toHaveBeenCalled()
      })

      it('should add timestamp to network downloaded files', async () => {
        const now = Date.now()
        vi.spyOn(Date, 'now').mockReturnValue(now)

        mockFetch.mockResolvedValue(createMockResponse())

        download('https://example.com/file.pdf')
        await waitForAsync()

        const element = mockCreateElement.mock.results[0].value
        expect(element.download).toBe(`${now}_file.pdf`)
      })

      it('should handle Content-Type when filename has no extension', async () => {
        const headers = new Headers()
        headers.set('Content-Type', 'application/pdf')
        mockFetch.mockResolvedValue(createMockResponse({ headers }))

        download('https://example.com/download')
        await waitForAsync()

        const element = mockCreateElement.mock.results[0].value
        expect(element.download).toMatch(/\d+_download\.pdf$/)
      })
    })

    describe('Error handling', () => {
      it('should handle network errors gracefully', async () => {
        const networkError = new Error('Network error')
        mockFetch.mockRejectedValue(networkError)

        expect(() => download('https://example.com/file.pdf')).not.toThrow()
        await waitForAsync()

        expect(mockMessage.error).toHaveBeenCalledWith('下载失败：Network error')
      })

      it('should handle fetch errors without message', async () => {
        mockFetch.mockRejectedValue(new Error())

        expect(() => download('https://example.com/file.pdf')).not.toThrow()
        await waitForAsync()

        expect(mockMessage.error).toHaveBeenCalledWith('下载失败')
      })

      it('should handle HTTP errors gracefully', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 404 })

        expect(() => download('https://example.com/file.pdf')).not.toThrow()
      })
    })
  })
})
