import 'katex/dist/katex.min.css'

import { combineReducers, configureStore } from '@reduxjs/toolkit'
import settingsReducer, { SettingsState } from '@renderer/store/settings'
import type { MainTextMessageBlock, ThinkingMessageBlock, TranslationMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { render, RenderOptions, RenderResult, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Markdown from '../Markdown'

interface TestRootState {
  settings: SettingsState
}

const makeTestStore = (preloadedState?: Partial<TestRootState>) =>
  configureStore({
    reducer: combineReducers({
      settings: settingsReducer
    }),
    preloadedState: preloadedState
  })

type TestAppStore = ReturnType<typeof makeTestStore>

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialState?: Partial<TestRootState>
  store?: TestAppStore
}

// Custom render function with Redux Provider
function customRender(
  ui: React.ReactElement,
  options: CustomRenderOptions = {}
): RenderResult & { store: TestAppStore } {
  const { initialState, store = options.store || makeTestStore(initialState), ...renderOptions } = options

  function Wrapper({ children }: { children: React.ReactNode }) {
    return <Provider store={store}>{children}</Provider>
  }
  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    store
  }
}

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
  }),
  uuid: vi.fn(() => 'mock-uuid')
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
      <table>{children}</table>
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
vi.mock('remark-alert', () => ({ __esModule: true, default: vi.fn() }))
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

vi.mock('../plugins/rehypeHeadingIds', () => ({
  __esModule: true,
  default: vi.fn()
}))

vi.mock('../plugins/rehypeScalableSvg', () => ({
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
  beforeEach(async () => {
    vi.clearAllMocks()

    // Default settings
    mockUseSettings.mockReturnValue({ mathEngine: 'KaTeX', mathEnableSingleDollar: true })
    mockUseTranslation.mockReturnValue({
      t: (key: string) => (key === 'message.chat.completion.paused' ? 'Paused' : key)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rendering', () => {
    it('should render markdown content with correct structure', () => {
      const block = createMainTextBlock({ content: 'Test content' })
      const { container } = customRender(<Markdown block={block} />)

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

      expect(() => customRender(<Markdown block={block} />)).not.toThrow()

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown).toBeInTheDocument()
    })

    it('should show paused message when content is empty and status is paused', () => {
      const block = createMainTextBlock({
        content: '',
        status: MessageBlockStatus.PAUSED
      })
      customRender(<Markdown block={block} />)

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown).toHaveTextContent('Paused')
    })

    it('should prioritize actual content over paused status', () => {
      const block = createMainTextBlock({
        content: 'Real content',
        status: MessageBlockStatus.PAUSED
      })
      customRender(<Markdown block={block} />)

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown).toHaveTextContent('Real content')
      expect(markdown).not.toHaveTextContent('Paused')
    })

    it('should match snapshot', () => {
      const { container } = customRender(<Markdown block={createMainTextBlock()} />)
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
        customRender(<Markdown block={block} />)

        const markdown = screen.getByTestId('markdown-content')
        expect(markdown).toBeInTheDocument()
        expect(markdown).toHaveTextContent(expectedContent)
      })
    })
  })

  describe('math engine configuration', () => {
    it('should configure KaTeX when mathEngine is KaTeX', () => {
      mockUseSettings.mockReturnValue({ mathEngine: 'KaTeX', mathEnableSingleDollar: true })

      customRender(<Markdown block={createMainTextBlock()} />)

      // Component should render successfully with KaTeX configuration
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })

    it('should configure MathJax when mathEngine is MathJax', () => {
      mockUseSettings.mockReturnValue({ mathEngine: 'MathJax', mathEnableSingleDollar: true })

      customRender(<Markdown block={createMainTextBlock()} />)

      // Component should render successfully with MathJax configuration
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })

    it('should not load math plugins when mathEngine is none', () => {
      mockUseSettings.mockReturnValue({ mathEngine: 'none', mathEnableSingleDollar: true })

      customRender(<Markdown block={createMainTextBlock()} />)

      // Component should render successfully without math plugins
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })
  })

  describe('custom components', () => {
    it('should integrate Link component for citations', () => {
      customRender(<Markdown block={createMainTextBlock()} />)

      expect(screen.getByTestId('has-link-component')).toBeInTheDocument()
    })

    it('should integrate CodeBlock component', () => {
      customRender(<Markdown block={createMainTextBlock()} />)
      expect(screen.getByTestId('has-code-component')).toBeInTheDocument()
    })

    it('should integrate Table component with copy functionality', () => {
      const block = createMainTextBlock({ id: 'test-block-456' })
      customRender(<Markdown block={block} />)

      expect(screen.getByTestId('has-table-component')).toBeInTheDocument()

      const tableComponent = screen.getByTestId('table-component')
      expect(tableComponent).toHaveAttribute('data-block-id', 'test-block-456')
    })

    it('should integrate ImageViewer component', () => {
      customRender(<Markdown block={createMainTextBlock()} />)

      expect(screen.getByTestId('has-img-component')).toBeInTheDocument()
    })

    it('should handle style tags with Shadow DOM', () => {
      const block = createMainTextBlock({ content: '<style>body { color: red; }</style>' })
      customRender(<Markdown block={block} />)

      expect(screen.getByTestId('has-style-component')).toBeInTheDocument()
    })
  })

  describe('HTML content support', () => {
    it('should handle mixed markdown and HTML content', () => {
      const block = createMainTextBlock({
        content: '# Header\n<div>HTML content</div>\n**Bold text**'
      })

      expect(() => customRender(<Markdown block={block} />)).not.toThrow()

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

      expect(() => customRender(<Markdown block={block} />)).not.toThrow()

      const markdown = screen.getByTestId('markdown-content')
      expect(markdown).toBeInTheDocument()
    })
  })

  describe('component behavior', () => {
    it('should re-render when content changes', () => {
      const { rerender, store } = customRender(<Markdown block={createMainTextBlock({ content: 'Initial' })} />)

      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Initial')

      rerender(
        <Provider store={store}>
          <Markdown block={createMainTextBlock({ content: 'Updated' })} />
        </Provider>
      )

      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Updated')
    })

    it('should re-render when math engine changes', () => {
      mockUseSettings.mockReturnValue({ mathEngine: 'KaTeX', mathEnableSingleDollar: true })
      const { rerender, store } = customRender(<Markdown block={createMainTextBlock({ content: 'Initial' })} />)

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()

      mockUseSettings.mockReturnValue({ mathEngine: 'MathJax', mathEnableSingleDollar: true })
      rerender(
        <Provider store={store}>
          <Markdown block={createMainTextBlock({ content: 'Updated' })} />
        </Provider>
      )

      // Should still render correctly with new math engine
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })
  })
})
