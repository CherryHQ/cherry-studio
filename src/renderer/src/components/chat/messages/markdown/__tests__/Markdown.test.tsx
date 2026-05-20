import 'katex/dist/katex.min.css'

import type * as MarkdownUtils from '@renderer/utils/markdown'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MarkdownSource } from '../Markdown'
import Markdown from '../Markdown'

// Mock dependencies
const mockMathSettings = vi.hoisted(() => ({
  current: { mathEnableSingleDollar: true }
}))
const mockStreamdown = vi.hoisted(() => ({
  defaultRemarkPlugins: {
    gfm: [vi.fn(), {}],
    codeMeta: vi.fn()
  },
  props: vi.fn()
}))
const mockUseTranslation = vi.fn()

// Mock hooks
vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => ({
    mathEnableSingleDollar: mockMathSettings.current.mathEnableSingleDollar
  })
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
    emit: vi.fn(),
    on: vi.fn()
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

vi.mock('@renderer/utils/markdown', async (importOriginal) => ({
  findCitationInChildren: vi.fn(() => '{"id": 1, "url": "https://example.com"}'),
  getCodeBlockId: vi.fn(() => 'code-block-1'),
  processLatexBrackets: vi.fn((str) => str),
  // Real splitter — its boundary correctness is unit-tested separately;
  // here the integration test needs the genuine split-while-streaming wiring.
  splitMarkdownBlocks: (await importOriginal<typeof MarkdownUtils>()).splitMarkdownBlocks
}))

// Mock components with more realistic behavior
vi.mock('../CodeBlock', () => ({
  __esModule: true,
  default: ({ children, blockId }: any) => (
    <div data-testid="code-block" data-block-id={blockId}>
      <code>{children}</code>
    </div>
  )
}))

vi.mock('@renderer/components/ImageViewer', () => ({
  __esModule: true,
  default: (props: any) => <img data-testid="image-viewer" {...props} />
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
      <table>
        <tbody>
          <tr>
            <td>{children}</td>
          </tr>
        </tbody>
      </table>
      <button type="button" data-testid="copy-table-button">
        Copy Table
      </button>
    </div>
  )
}))

vi.mock('../MarkdownSvgRenderer', () => ({
  __esModule: true,
  default: ({ children }: any) => <div data-testid="svg-renderer">{children}</div>
}))

vi.mock('@renderer/components/MarkdownShadowDOMRenderer', () => ({
  __esModule: true,
  default: ({ children }: any) => <div data-testid="shadow-dom">{children}</div>
}))

// Mock plugins
vi.mock('remark-github-blockquote-alert', () => ({ __esModule: true, default: vi.fn() }))
vi.mock('@streamdown/code', () => ({ code: vi.fn() }))
vi.mock('@streamdown/cjk', () => ({ cjk: vi.fn() }))
vi.mock('@streamdown/math', () => ({ createMathPlugin: vi.fn(() => vi.fn()), math: vi.fn() }))
vi.mock('@streamdown/mermaid', () => ({ mermaid: vi.fn() }))

vi.mock('../plugins/rehypeHeadingIds', () => ({
  __esModule: true,
  default: vi.fn()
}))

vi.mock('../plugins/rehypeScalableSvg', () => ({
  __esModule: true,
  default: vi.fn()
}))

// Mock Streamdown with realistic rendering
vi.mock('streamdown', () => ({
  Streamdown: (props: any) => {
    const { children, components, className } = props
    mockStreamdown.props(props)
    return (
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
  },
  defaultRehypePlugins: {
    raw: vi.fn(),
    sanitize: [vi.fn(), { tagNames: [], attributes: {}, protocols: {} }],
    harden: vi.fn()
  },
  defaultRemarkPlugins: mockStreamdown.defaultRemarkPlugins,
  defaultUrlTransform: vi.fn((url: string) => url),
  useIsCodeFenceIncomplete: vi.fn(() => false)
}))

describe('Markdown', () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    // Default settings
    mockMathSettings.current = { mathEnableSingleDollar: true }
    mockUseTranslation.mockReturnValue({
      t: (key: string) => (key === 'message.chat.completion.paused' ? 'Paused' : key)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Test data helpers
  const createMarkdownSource = (overrides: Partial<MarkdownSource> = {}): MarkdownSource => ({
    id: 'test-block-1',
    status: 'success',
    content: '# Test Markdown\n\nThis is **bold** text.',
    ...overrides
  })

  describe('rendering', () => {
    it('should render markdown content with correct structure', () => {
      const block = createMarkdownSource({ content: 'Test content' })
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
      const block = createMarkdownSource({ content: '' })

      expect(() => render(<Markdown block={block} />)).not.toThrow()

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown).toBeInTheDocument()
    })

    it('should show paused message when content is empty and status is paused', () => {
      const block = createMarkdownSource({
        content: '',
        status: 'paused'
      })
      render(<Markdown block={block} />)

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown).toHaveTextContent('Paused')
    })

    it('should prioritize actual content over paused status', () => {
      const block = createMarkdownSource({
        content: 'Real content',
        status: 'paused'
      })
      render(<Markdown block={block} />)

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown).toHaveTextContent('Real content')
      expect(markdown).not.toHaveTextContent('Paused')
    })

    it('should match snapshot', () => {
      const { container } = render(<Markdown block={createMarkdownSource()} />)
      expect(container.firstChild).toMatchSnapshot()
    })

    it('should keep Streamdown default remark plugins for GFM tables', () => {
      render(
        <Markdown
          block={createMarkdownSource({
            content: '| A | B |\n|---|---|\n| 1 | 2 |'
          })}
        />
      )

      const props = mockStreamdown.props.mock.calls[0][0]
      expect(props.remarkPlugins).toEqual(expect.arrayContaining(Object.values(mockStreamdown.defaultRemarkPlugins)))
    })
  })

  describe('block type support', () => {
    const testCases = [
      {
        name: 'MainTextMessageBlock',
        block: createMarkdownSource({ content: 'Main text content' }),
        expectedContent: 'Main text content'
      },
      {
        name: 'ThinkingMessageBlock',
        block: createMarkdownSource({
          id: 'thinking-1',
          content: 'Thinking content'
        }),
        expectedContent: 'Thinking content'
      },
      {
        name: 'TranslationMessageBlock',
        block: createMarkdownSource({
          id: 'translation-1',
          content: 'Translated content'
        }),
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

  describe('math plugin configuration', () => {
    it('should configure KaTeX math rendering', () => {
      mockMathSettings.current = { mathEnableSingleDollar: true }

      render(<Markdown block={createMarkdownSource()} />)

      // Component should render successfully with KaTeX configuration.
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })
  })

  describe('custom components', () => {
    it('should integrate Link component for citations', () => {
      render(<Markdown block={createMarkdownSource()} />)

      expect(screen.getByTestId('has-link-component')).toBeInTheDocument()
    })

    it('should integrate CodeBlock component', () => {
      render(<Markdown block={createMarkdownSource()} />)
      expect(screen.getByTestId('has-code-component')).toBeInTheDocument()
    })

    it('should integrate Table component with copy functionality', () => {
      const block = createMarkdownSource({ id: 'test-block-456' })
      render(<Markdown block={block} />)

      expect(screen.getByTestId('has-table-component')).toBeInTheDocument()

      const tableComponent = screen.getByTestId('table-component')
      expect(tableComponent).toHaveAttribute('data-block-id', 'test-block-456')
    })

    it('should integrate ImageViewer component', () => {
      render(<Markdown block={createMarkdownSource()} />)

      expect(screen.getByTestId('has-img-component')).toBeInTheDocument()
    })

    it('should handle style tags with Shadow DOM', () => {
      const block = createMarkdownSource({ content: '<style>body { color: red; }</style>' })
      render(<Markdown block={block} />)

      expect(screen.getByTestId('has-style-component')).toBeInTheDocument()
    })
  })

  describe('HTML content support', () => {
    it('should handle mixed markdown and HTML content', () => {
      const block = createMarkdownSource({
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
      const block = createMarkdownSource({
        content: '<unclosed-tag>content\n# Invalid markdown **unclosed'
      })

      expect(() => render(<Markdown block={block} />)).not.toThrow()

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown).toBeInTheDocument()
    })
  })

  describe('component behavior', () => {
    it('should re-render when content changes', () => {
      const { rerender } = render(<Markdown block={createMarkdownSource({ content: 'Initial' })} />)

      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Initial')

      rerender(<Markdown block={createMarkdownSource({ content: 'Updated' })} />)

      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Updated')
    })

    it('should re-render when math single-dollar setting changes', () => {
      mockMathSettings.current = { mathEnableSingleDollar: true }
      const { rerender } = render(<Markdown block={createMarkdownSource()} />)

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()

      mockMathSettings.current = { mathEnableSingleDollar: false }
      rerender(<Markdown block={createMarkdownSource()} />)

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })
  })

  // The streaming O(n²) regression guard. The mocked react-markdown renders
  // one `markdown-content` node per `<ReactMarkdown>` instance, i.e. one per
  // `MarkdownBlock`. So the testid count == number of memoized blocks.
  //
  // Correctness of the block boundaries themselves (tables / $$ math / fenced
  // code never split) is covered exhaustively by the `splitMarkdownBlocks`
  // unit tests in utils/markdown.test.ts. Here we only assert the wiring:
  // split into many blocks while streaming, collapse to one when done — and
  // that the rendered text still reconstructs the original (no loss).
  describe('block-level streaming split', () => {
    it('renders the whole message as ONE block when not streaming', () => {
      const block = createMarkdownSource({
        content: '# Title\n\nFirst paragraph.\n\nSecond paragraph.',
        status: 'success'
      })
      render(<Markdown block={block} />)

      // Single instance ⇒ output path byte-identical to the pre-refactor
      // single <ReactMarkdown>; existing getByTestId-singular tests rely on it.
      expect(screen.getAllByTestId('markdown-content')).toHaveLength(1)
    })

    it('splits into multiple memoized blocks while streaming', () => {
      const content = '# Title\n\nFirst paragraph.\n\nSecond paragraph.'
      const block = createMarkdownSource({ content, status: 'streaming' })
      render(<Markdown block={block} />)

      const blocks = screen.getAllByTestId('markdown-content')
      expect(blocks.length).toBeGreaterThan(1)
      // Every segment still rendered (nothing dropped by the split); exact
      // join-invariant is asserted in the splitter unit tests.
      const allText = blocks.map((b) => b.textContent).join('')
      expect(allText).toContain('# Title')
      expect(allText).toContain('First paragraph.')
      expect(allText).toContain('Second paragraph.')
    })
  })
})
