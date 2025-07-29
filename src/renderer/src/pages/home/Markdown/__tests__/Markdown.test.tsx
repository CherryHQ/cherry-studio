import 'katex/dist/katex.min.css'

import type { MainTextMessageBlock, ThinkingMessageBlock, TranslationMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Markdown from '../Markdown'

// Mock dependencies
const mockUseSettings = vi.fn()
const mockUseTranslation = vi.fn()

// Mock hooks
vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => mockUseSettings()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

// Mock services
vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    EDIT_CODE_BLOCK: 'EDIT_CODE_BLOCK'
  },
  EventEmitter: {
    emit: vi.fn()
  }
}))

// Mock utilities
vi.mock('@renderer/utils', () => ({
  parseJSON: vi.fn((str) => {
    try {
      return JSON.parse(str || '{}')
    } catch {
      return {}
    }
  })
}))

vi.mock('@renderer/utils/formats', () => ({
  removeSvgEmptyLines: vi.fn((str) => str)
}))

vi.mock('@renderer/utils/markdown', () => ({
  findCitationInChildren: vi.fn(() => '{"id": 1, "url": "https://example.com"}'),
  getCodeBlockId: vi.fn(() => 'code-block-1'),
  processLatexBrackets: vi.fn((str) => str)
}))

// Mock components with more realistic behavior
vi.mock('../CodeBlock', () => ({
  __esModule: true,
  default: ({ id, onSave, children }: any) => (
    <div data-testid="code-block" data-id={id}>
      <code>{children}</code>
      <button type="button" onClick={() => onSave(id, 'new content')}>
        Save
      </button>
    </div>
  )
}))

vi.mock('../ImagePreview', () => ({
  __esModule: true,
  default: (props: any) => <img data-testid="image-preview" {...props} />
}))

vi.mock('../Link', () => ({
  __esModule: true,
  default: ({ citationData, children, ...props }: any) => (
    <a data-testid="citation-link" data-citation={citationData} {...props}>
      {children}
    </a>
  )
}))

vi.mock('../Table', () => ({
  __esModule: true,
  default: ({ children, blockId }: any) => (
    <div data-testid="table-component" data-block-id={blockId}>
      <table>{children}</table>
      <button type="button" data-testid="copy-table-button">
        Copy Table
      </button>
    </div>
  )
}))

vi.mock('@renderer/components/MarkdownShadowDOMRenderer', () => ({
  __esModule: true,
  default: ({ children }: any) => <div data-testid="shadow-dom">{children}</div>
}))

// Mock plugins
vi.mock('remark-gfm', () => ({ __esModule: true, default: vi.fn() }))
vi.mock('remark-cjk-friendly', () => ({ __esModule: true, default: vi.fn() }))
vi.mock('remark-math', () => ({ __esModule: true, default: vi.fn() }))
vi.mock('rehype-katex', () => ({ __esModule: true, default: vi.fn() }))
vi.mock('rehype-mathjax', () => ({ __esModule: true, default: vi.fn() }))
vi.mock('rehype-raw', () => ({ __esModule: true, default: vi.fn() }))

// Mock custom plugins
vi.mock('../plugins/remarkDisableConstructs', () => ({
  __esModule: true,
  default: vi.fn()
}))

// Mock ReactMarkdown with realistic rendering
vi.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children, components, className }: any) => (
    <div data-testid="markdown-content" className={className}>
      {children}
      {/* Simulate component rendering */}
      {components?.a && <span data-testid="has-link-component">link</span>}
      {components?.code && (
        <div data-testid="has-code-component">
          {components.code({ children: 'test code', node: { position: { start: { line: 1 } } } })}
        </div>
      )}
      {components?.table && (
        <div data-testid="has-table-component">
          {components.table({ children: 'test table', node: { position: { start: { line: 1 } } } })}
        </div>
      )}
      {components?.img && <span data-testid="has-img-component">img</span>}
      {components?.style && <span data-testid="has-style-component">style</span>}
    </div>
  )
}))

describe('Markdown', () => {
  let mockEventEmitter: any

  beforeEach(async () => {
    vi.clearAllMocks()

    // Default settings
    mockUseSettings.mockReturnValue({ mathEngine: 'KaTeX' })
    mockUseTranslation.mockReturnValue({
      t: (key: string) => (key === 'message.chat.completion.paused' ? 'Paused' : key)
    })

    // Get mocked EventEmitter
    const { EventEmitter } = await import('@renderer/services/EventService')
    mockEventEmitter = EventEmitter
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Test data helpers
  const createMainTextBlock = (overrides: Partial<MainTextMessageBlock> = {}): MainTextMessageBlock => ({
    id: 'test-block-1',
    messageId: 'test-message-1',
    type: MessageBlockType.MAIN_TEXT,
    status: MessageBlockStatus.SUCCESS,
    createdAt: new Date().toISOString(),
    content: '# Test Markdown\n\nThis is **bold** text.',
    ...overrides
  })

  describe('rendering', () => {
    it('should render markdown content with correct structure', () => {
      const block = createMainTextBlock({ content: 'Test content' })
      const { container } = render(<Markdown block={block} />)

      // Check that the outer container has the markdown class
      const markdownContainer = container.querySelector('.markdown')
      expect(markdownContainer).toBeInTheDocument()

      // Check that the markdown content is rendered inside
      const markdownContent = screen.getByTestId('markdown-content')
      expect(markdownContent).toBeInTheDocument()
      expect(markdownContent).toHaveTextContent('Test content')
    })

    it('should handle empty content gracefully', () => {
      const block = createMainTextBlock({ content: '' })

      expect(() => render(<Markdown block={block} />)).not.toThrow()

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown).toBeInTheDocument()
    })

    it('should show paused message when content is empty and status is paused', () => {
      const block = createMainTextBlock({
        content: '',
        status: MessageBlockStatus.PAUSED
      })
      render(<Markdown block={block} />)

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown).toHaveTextContent('Paused')
    })

    it('should prioritize actual content over paused status', () => {
      const block = createMainTextBlock({
        content: 'Real content',
        status: MessageBlockStatus.PAUSED
      })
      render(<Markdown block={block} />)

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown).toHaveTextContent('Real content')
      expect(markdown).not.toHaveTextContent('Paused')
    })

    it('should match snapshot', () => {
      const { container } = render(<Markdown block={createMainTextBlock()} />)
      expect(container.firstChild).toMatchSnapshot()
    })
  })

  describe('block type support', () => {
    const testCases = [
      {
        name: 'MainTextMessageBlock',
        block: createMainTextBlock({ content: 'Main text content' }),
        expectedContent: 'Main text content'
      },
      {
        name: 'ThinkingMessageBlock',
        block: {
          id: 'thinking-1',
          messageId: 'msg-1',
          type: MessageBlockType.THINKING,
          status: MessageBlockStatus.SUCCESS,
          createdAt: new Date().toISOString(),
          content: 'Thinking content',
          thinking_millsec: 5000
        } as ThinkingMessageBlock,
        expectedContent: 'Thinking content'
      },
      {
        name: 'TranslationMessageBlock',
        block: {
          id: 'translation-1',
          messageId: 'msg-1',
          type: MessageBlockType.TRANSLATION,
          status: MessageBlockStatus.SUCCESS,
          createdAt: new Date().toISOString(),
          content: 'Translated content',
          targetLanguage: 'en'
        } as TranslationMessageBlock,
        expectedContent: 'Translated content'
      }
    ]

    testCases.forEach(({ name, block, expectedContent }) => {
      it(`should handle ${name} correctly`, () => {
        render(<Markdown block={block} />)

        const markdown = screen.getByTestId('markdown-content')
        expect(markdown).toBeInTheDocument()
        expect(markdown).toHaveTextContent(expectedContent)
      })
    })
  })

  describe('math engine configuration', () => {
    it('should configure KaTeX when mathEngine is KaTeX', () => {
      mockUseSettings.mockReturnValue({ mathEngine: 'KaTeX' })

      render(<Markdown block={createMainTextBlock()} />)

      // Component should render successfully with KaTeX configuration
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })

    it('should configure MathJax when mathEngine is MathJax', () => {
      mockUseSettings.mockReturnValue({ mathEngine: 'MathJax' })

      render(<Markdown block={createMainTextBlock()} />)

      // Component should render successfully with MathJax configuration
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })

    it('should not load math plugins when mathEngine is none', () => {
      mockUseSettings.mockReturnValue({ mathEngine: 'none' })

      render(<Markdown block={createMainTextBlock()} />)

      // Component should render successfully without math plugins
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })
  })

  describe('custom components', () => {
    it('should integrate Link component for citations', () => {
      render(<Markdown block={createMainTextBlock()} />)

      expect(screen.getByTestId('has-link-component')).toBeInTheDocument()
    })

    it('should integrate CodeBlock component with edit functionality', () => {
      const block = createMainTextBlock({ id: 'test-block-123' })
      render(<Markdown block={block} />)

      expect(screen.getByTestId('has-code-component')).toBeInTheDocument()

      // Test code block edit event
      const saveButton = screen.getByText('Save')
      saveButton.click()

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('EDIT_CODE_BLOCK', {
        msgBlockId: 'test-block-123',
        codeBlockId: 'code-block-1',
        newContent: 'new content'
      })
    })

    it('should integrate Table component with copy functionality', () => {
      const block = createMainTextBlock({ id: 'test-block-456' })
      render(<Markdown block={block} />)

      expect(screen.getByTestId('has-table-component')).toBeInTheDocument()

      const tableComponent = screen.getByTestId('table-component')
      expect(tableComponent).toHaveAttribute('data-block-id', 'test-block-456')
    })

    it('should integrate ImagePreview component', () => {
      render(<Markdown block={createMainTextBlock()} />)

      expect(screen.getByTestId('has-img-component')).toBeInTheDocument()
    })

    it('should handle style tags with Shadow DOM', () => {
      const block = createMainTextBlock({ content: '<style>body { color: red; }</style>' })
      render(<Markdown block={block} />)

      expect(screen.getByTestId('has-style-component')).toBeInTheDocument()
    })
  })

  describe('HTML content support', () => {
    it('should handle mixed markdown and HTML content', () => {
      const block = createMainTextBlock({
        content: '# Header\n<div>HTML content</div>\n**Bold text**'
      })

      expect(() => render(<Markdown block={block} />)).not.toThrow()

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown).toBeInTheDocument()
      expect(markdown).toHaveTextContent('# Header')
      expect(markdown).toHaveTextContent('HTML content')
      expect(markdown).toHaveTextContent('**Bold text**')
    })

    it('should handle malformed content gracefully', () => {
      const block = createMainTextBlock({
        content: '<unclosed-tag>content\n# Invalid markdown **unclosed'
      })

      expect(() => render(<Markdown block={block} />)).not.toThrow()

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown).toBeInTheDocument()
    })
  })

  describe('component behavior', () => {
    it('should re-render when content changes', () => {
      const { rerender } = render(<Markdown block={createMainTextBlock({ content: 'Initial' })} />)

      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Initial')

      rerender(<Markdown block={createMainTextBlock({ content: 'Updated' })} />)

      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Updated')
    })

    it('should re-render when math engine changes', () => {
      mockUseSettings.mockReturnValue({ mathEngine: 'KaTeX' })
      const { rerender } = render(<Markdown block={createMainTextBlock()} />)

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()

      mockUseSettings.mockReturnValue({ mathEngine: 'MathJax' })
      rerender(<Markdown block={createMainTextBlock()} />)

      // Should still render correctly with new math engine
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })
  })
})
