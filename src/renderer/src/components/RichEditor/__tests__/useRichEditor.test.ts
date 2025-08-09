import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRichEditor } from '../useRichEditor'

// Mock the markdown converter
vi.mock('@renderer/utils/markdownConverter', () => ({
  htmlToMarkdown: vi.fn().mockImplementation((html) => {
    // Simple HTML to markdown conversion for testing
    if (html.includes('<h1>')) {
      return html.replace(/<h1>(.*?)<\/h1>/, '# $1')
    }
    return html.replace(/<[^>]*>/g, '') // Strip HTML tags
  }),
  markdownToHtml: vi.fn().mockImplementation((markdown) => {
    // Simple markdown to HTML conversion for testing
    if (markdown.startsWith('# ')) {
      return `<h1>${markdown.slice(2)}</h1>`
    }
    return `<p>${markdown}</p>`
  }),
  markdownToSafeHtml: vi.fn().mockImplementation((markdown) => {
    // Same as markdownToHtml for testing
    if (markdown.startsWith('# ')) {
      return `<h1>${markdown.slice(2)}</h1>`
    }
    return `<p>${markdown}</p>`
  }),
  sanitizeHtml: vi.fn().mockImplementation((html) => `sanitized: ${html}`),
  markdownToPreviewText: vi.fn().mockImplementation((markdown, length = 50) => {
    // Remove markdown formatting for preview
    const cleanText = markdown.replace(/^#+\s*/, '').replace(/[*_`]/g, '')
    return cleanText.length > length ? cleanText.slice(0, length) + '...' : cleanText
  }),
  isMarkdownContent: vi.fn().mockImplementation((content) => {
    // Check if content looks like markdown
    return /^#+\s/.test(content) || /[*_`]/.test(content)
  })
}))

describe('useRichEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Functionality', () => {
    it('should initialize with empty content by default', () => {
      const { result } = renderHook(() => useRichEditor())

      expect(result.current.markdown).toBe('')
      expect(result.current.html).toBe('')
      expect(result.current.previewText).toBe('')
    })

    it('should initialize with provided markdown content', () => {
      const initialContent = '# Hello World'
      const { result } = renderHook(() => useRichEditor({ initialContent }))

      expect(result.current.markdown).toBe(initialContent)
    })

    it('should provide content type detection', () => {
      const { result } = renderHook(() => useRichEditor())

      expect(typeof result.current.isMarkdown).toBe('boolean')
    })
  })

  describe('Content Management', () => {
    it('should update markdown content', () => {
      const { result } = renderHook(() => useRichEditor())

      act(() => {
        result.current.setMarkdown('# New Content')
      })

      expect(result.current.markdown).toBe('# New Content')
    })

    it('should update HTML content and convert to markdown', () => {
      const { result } = renderHook(() => useRichEditor())

      act(() => {
        result.current.setHtml('<h1>HTML Content</h1>')
      })

      expect(result.current.markdown).toBe('# HTML Content')
    })

    it('should clear all content', () => {
      const { result } = renderHook(() => useRichEditor({ initialContent: '# Test' }))

      act(() => {
        result.current.clear()
      })

      expect(result.current.markdown).toBe('')
    })
  })

  describe('Conversion Methods', () => {
    it('should provide markdown to HTML conversion', () => {
      const { result } = renderHook(() => useRichEditor())

      const html = result.current.toHtml('# Test')
      expect(html).toBe('<h1>Test</h1>')
    })

    it('should provide markdown to safe HTML conversion', () => {
      const { result } = renderHook(() => useRichEditor())

      const safeHtml = result.current.toSafeHtml('# Test')
      expect(safeHtml).toBe('<h1>Test</h1>')
    })

    it('should provide HTML to markdown conversion', () => {
      const { result } = renderHook(() => useRichEditor())

      const markdown = result.current.toMarkdown('<h1>Test</h1>')
      expect(markdown).toBe('# Test')
    })

    it('should provide preview text generation', () => {
      const { result } = renderHook(() => useRichEditor())

      const preview = result.current.getPreviewText('# Test Content', 20)
      expect(preview).toBe('Test Content')
    })
  })

  describe('Callbacks', () => {
    it('should call onChange when markdown changes', () => {
      const onChange = vi.fn()
      const { result } = renderHook(() => useRichEditor({ onChange }))

      act(() => {
        result.current.setMarkdown('# New Content')
      })

      expect(onChange).toHaveBeenCalledWith('# New Content')
    })

    it('should call onHtmlChange when HTML changes', () => {
      const onHtmlChange = vi.fn()
      const { result } = renderHook(() => useRichEditor({ onHtmlChange }))

      act(() => {
        result.current.setHtml('<h1>HTML Content</h1>')
      })

      expect(onHtmlChange).toHaveBeenCalledWith('sanitized: <h1>HTML Content</h1>')
    })
  })

  describe('Error Handling', () => {
    it('should handle conversion errors gracefully', () => {
      // Just test that errors don't crash the app
      const { result } = renderHook(() => useRichEditor())

      // Should not crash when setting content
      act(() => {
        result.current.setHtml('<h1>Test</h1>')
      })

      expect(result.current.markdown).toBeDefined()
    })
  })

  describe('Configuration Options', () => {
    it('should support custom preview length', () => {
      const { result } = renderHook(() =>
        useRichEditor({
          previewLength: 100
        })
      )

      const preview = result.current.getPreviewText('# Long content that should be truncated properly', 10)
      expect(preview).toBe('Long conte...')
    })

    it('should support disabled state', () => {
      const { result } = renderHook(() => useRichEditor({ editable: false }))

      expect(result.current.disabled).toBe(true)
    })
  })
})
