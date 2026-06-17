import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CodeBlock from '../CodeBlock'

// Hoisted mocks
const mocks = vi.hoisted(() => {
  const saveCodeBlock = vi.fn()

  return {
    saveCodeBlock,
    messageListActions: { saveCodeBlock } as any,
    getCodeBlockId: vi.fn(),
    isCodeFenceIncomplete: false,
    renderConfig: { codeFancyBlock: true },
    messageListUi: { readonly: false },
    isWin: false,
    CodeBlockView: vi.fn(({ onSave, children }) => (
      <div>
        <code>{children}</code>
        <button type="button" onClick={() => onSave('new code content')}>
          Save
        </button>
      </div>
    )),
    HtmlArtifactsCard: vi.fn(({ onSave, html, isStreaming }) => (
      <div>
        <div>{html}</div>
        <div data-testid="html-streaming-state">{String(isStreaming)}</div>
        <button type="button" onClick={() => onSave('new html content')}>
          Save HTML
        </button>
      </div>
    ))
  }
})

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => mocks.renderConfig,
  useOptionalMessageListActions: () => mocks.messageListActions,
  useOptionalMessageListUi: () => mocks.messageListUi
}))

vi.mock('@renderer/config/constant', () => ({
  get isWin() {
    return mocks.isWin
  }
}))

vi.mock('@renderer/utils/markdown', () => ({
  getCodeBlockId: mocks.getCodeBlockId
}))

vi.mock('streamdown', () => ({
  useIsCodeFenceIncomplete: () => mocks.isCodeFenceIncomplete
}))

vi.mock('@renderer/components/CodeBlockView', () => ({
  CodeBlockView: mocks.CodeBlockView,
  HtmlArtifactsCard: mocks.HtmlArtifactsCard
}))

// Mock message parts context — returns null by default
vi.mock('@renderer/components/chat/messages/blocks', () => ({
  useResolveBlock: vi.fn(() => null)
}))

// Mock ClickableFilePath
vi.mock('@renderer/components/chat/messages/tools/agent/ClickableFilePath', () => ({
  ClickableFilePath: ({ path }: { path: string }) => <span data-testid="clickable-file-path">{path}</span>
}))

describe('CodeBlock', () => {
  const defaultProps = {
    blockId: 'test-msg-block-id',
    node: {
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 2, column: 1, offset: 2 },
        value: 'console.log("hello world")'
      }
    },
    children: 'console.log("hello world")',
    className: 'language-javascript'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isWin = false
    mocks.messageListActions = { saveCodeBlock: mocks.saveCodeBlock }
    mocks.messageListUi = { readonly: false }
    // Default mock return values
    mocks.getCodeBlockId.mockReturnValue('test-code-block-id')
    mocks.isCodeFenceIncomplete = false
  })

  describe('rendering', () => {
    it('should render a snapshot', () => {
      const { container } = render(<CodeBlock {...defaultProps} />)
      expect(container).toMatchSnapshot()
    })

    it('should render inline code when no language match is found', () => {
      const inlineProps = {
        ...defaultProps,
        className: undefined,
        children: 'inline code'
      }
      render(<CodeBlock {...inlineProps} />)

      const codeElement = screen.getByText('inline code')
      expect(codeElement.tagName).toBe('CODE')
      expect(codeElement).not.toHaveAttribute('style')
      expect(codeElement).toHaveClass('whitespace-pre-wrap!')
      expect(mocks.CodeBlockView).not.toHaveBeenCalled()
    })

    it('should render without a message list provider', () => {
      mocks.messageListActions = undefined

      expect(() => render(<CodeBlock {...defaultProps} />)).not.toThrow()
      fireEvent.click(screen.getByText('Save'))
      expect(mocks.saveCodeBlock).not.toHaveBeenCalled()
    })

    it('should render ClickableFilePath for absolute file paths', () => {
      const pathProps = {
        ...defaultProps,
        className: undefined,
        children: '/Users/foo/bar.tsx'
      }
      render(<CodeBlock {...pathProps} />)

      expect(screen.getByTestId('clickable-file-path')).toBeInTheDocument()
      expect(screen.getByText('/Users/foo/bar.tsx')).toBeInTheDocument()
      expect(screen.getByTestId('clickable-file-path').closest('code')).not.toHaveAttribute('style')
      expect(screen.getByTestId('clickable-file-path').closest('code')).toHaveClass('break-all!')
    })

    it('should render ClickableFilePath for workspace-relative file paths', () => {
      render(<CodeBlock {...defaultProps} className={undefined} children="src/renderer/src/index.tsx" />)

      expect(screen.getByTestId('clickable-file-path')).toBeInTheDocument()
      expect(screen.getByText('src/renderer/src/index.tsx')).toBeInTheDocument()
    })

    it('should render ClickableFilePath for file paths with a line suffix', () => {
      render(<CodeBlock {...defaultProps} className={undefined} children="src/renderer/src/index.tsx:42:5" />)

      expect(screen.getByTestId('clickable-file-path')).toBeInTheDocument()
      expect(screen.getByText('src/renderer/src/index.tsx')).toBeInTheDocument()
    })

    it('should render ClickableFilePath for absolute file paths wrapped in backticks', () => {
      render(<CodeBlock {...defaultProps} className={undefined} children="`/Users/foo/bar.tsx`" />)

      expect(screen.getByTestId('clickable-file-path')).toBeInTheDocument()
      expect(screen.getByText('/Users/foo/bar.tsx')).toBeInTheDocument()
    })

    it.each([
      '/home/user/project/src/index.ts',
      '/tmp/test.log',
      '/var/log/app.log',
      '/etc/nginx/nginx.conf',
      '/path with spaces/file.ts',
      '/Users/suyao/Library/Application Support/CherryStudioDev/.claude/skills/guizang-ppt-skill/',
      './src/index.ts',
      '../packages/ui/src/button.tsx',
      '../packages/ui/src/'
    ])('should detect %s as a file path', (path) => {
      render(<CodeBlock {...defaultProps} className={undefined} children={path} />)
      expect(screen.getByTestId('clickable-file-path')).toBeInTheDocument()
    })

    it('should render ClickableFilePath for text code fences containing a single path', () => {
      const path = '/Users/suyao/Library/Application Support/CherryStudioDev/.claude/skills/guizang-ppt-skill/'
      render(<CodeBlock {...defaultProps} className="language-text" children={path} />)

      expect(screen.getByTestId('clickable-file-path')).toBeInTheDocument()
      expect(screen.getByText(path)).toBeInTheDocument()
      expect(mocks.CodeBlockView).not.toHaveBeenCalled()
    })

    it.each(['inline code', '/single-segment', '//comment style', 'not/absolute/path'])(
      'should NOT detect %s as a file path',
      (text) => {
        render(<CodeBlock {...defaultProps} className={undefined} children={text} />)
        expect(screen.queryByTestId('clickable-file-path')).not.toBeInTheDocument()
      }
    )

    it.each(['/home/user/project/src/index.ts', '/tmp/test.log', '/var/log/app.log', '/etc/nginx/nginx.conf'])(
      'should NOT detect %s as a file path on Windows',
      (path) => {
        mocks.isWin = true
        render(<CodeBlock {...defaultProps} className={undefined} children={path} />)
        expect(screen.queryByTestId('clickable-file-path')).not.toBeInTheDocument()
      }
    )

    it('should render mermaid code fences with the app code block view', () => {
      render(<CodeBlock {...defaultProps} className="language-mermaid" children="graph TD; A-->B;" />)

      expect(screen.getByText('graph TD; A-->B;')).toBeInTheDocument()
      expect(mocks.CodeBlockView).toHaveBeenCalled()
      expect(mocks.CodeBlockView.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          language: 'mermaid',
          children: 'graph TD; A-->B;',
          editable: true
        })
      )
      expect(mocks.HtmlArtifactsCard).not.toHaveBeenCalled()
    })

    it('should pass editable=false for standard code blocks in readonly surfaces', () => {
      mocks.messageListUi = { readonly: true }

      render(<CodeBlock {...defaultProps} />)

      expect(mocks.CodeBlockView).toHaveBeenCalledWith(
        expect.objectContaining({
          editable: false
        }),
        undefined
      )
    })

    it('should pass editable=false for standard code blocks when saving is unavailable', () => {
      mocks.messageListActions = {}

      render(<CodeBlock {...defaultProps} />)

      expect(mocks.CodeBlockView).toHaveBeenCalledWith(
        expect.objectContaining({
          editable: false
        }),
        undefined
      )
    })

    it('should pass editable=false for HTML artifacts in readonly surfaces', () => {
      mocks.messageListUi = { readonly: true }
      const htmlProps = {
        ...defaultProps,
        className: 'language-html',
        children: '<h1>Hello</h1>'
      }

      render(<CodeBlock {...htmlProps} />)

      expect(mocks.HtmlArtifactsCard).toHaveBeenCalledWith(
        expect.objectContaining({
          editable: false
        }),
        undefined
      )
    })
  })

  describe('save', () => {
    it('should call saveCodeBlock with correct payload when saving a standard code block', () => {
      render(<CodeBlock {...defaultProps} />)

      // Simulate clicking the save button inside the mocked CodeBlockView
      const saveButton = screen.getByText('Save')
      fireEvent.click(saveButton)

      // Verify getCodeBlockId was called
      expect(mocks.getCodeBlockId).toHaveBeenCalledWith(defaultProps.node.position.start)

      expect(mocks.saveCodeBlock).toHaveBeenCalledOnce()
      expect(mocks.saveCodeBlock).toHaveBeenCalledWith({
        msgBlockId: 'test-msg-block-id',
        codeBlockId: 'test-code-block-id',
        newContent: 'new code content'
      })
    })

    it('should call saveCodeBlock with correct payload when saving an HTML block', () => {
      const htmlProps = {
        ...defaultProps,
        className: 'language-html',
        children: '<h1>Hello</h1>'
      }
      render(<CodeBlock {...htmlProps} />)

      // Simulate clicking the save button inside the mocked HtmlArtifactsCard
      const saveButton = screen.getByText('Save HTML')
      fireEvent.click(saveButton)

      // Verify getCodeBlockId was called
      expect(mocks.getCodeBlockId).toHaveBeenCalledWith(htmlProps.node.position.start)

      expect(mocks.saveCodeBlock).toHaveBeenCalledOnce()
      expect(mocks.saveCodeBlock).toHaveBeenCalledWith({
        msgBlockId: 'test-msg-block-id',
        codeBlockId: 'test-code-block-id',
        newContent: 'new html content'
      })
    })

    it('should pass Streamdown incomplete fence state to HTML artifact cards', () => {
      mocks.isCodeFenceIncomplete = true
      const htmlProps = {
        ...defaultProps,
        className: 'language-html',
        children: '<h1>Hello</h1>'
      }

      render(<CodeBlock {...htmlProps} />)

      expect(screen.getByTestId('html-streaming-state')).toHaveTextContent('true')
    })
  })
})
