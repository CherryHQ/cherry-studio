import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CodeBlock from '../CodeBlock'

// Hoisted mocks
const mocks = vi.hoisted(() => {
  const navigateToRoute = vi.fn()
  const saveCodeBlock = vi.fn()

  return {
    navigateToRoute,
    saveCodeBlock,
    messageListActions: { navigateToRoute, saveCodeBlock } as any,
    getCodeBlockId: vi.fn(),
    isCodeFenceIncomplete: false,
    renderConfig: { codeFancyBlock: true },
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
    )),
    MessageHtmlArtifact: vi.fn(({ html, onSave, editable, isStreaming }) => (
      <div data-testid="message-html-artifact">
        <span>{html}</span>
        <span data-testid="message-html-streaming-state">{String(isStreaming)}</span>
        <button type="button" disabled={!editable} onClick={() => onSave('new inline html content')}>
          Save Inline HTML
        </button>
      </div>
    ))
  }
})

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => mocks.renderConfig,
  useOptionalMessageListActions: () => mocks.messageListActions
}))

vi.mock('@renderer/utils/platform', () => ({
  platform: 'darwin',
  get isWin() {
    return mocks.isWin
  }
}))

vi.mock('@renderer/utils/markdownLight', () => ({
  getCodeBlockId: mocks.getCodeBlockId
}))

vi.mock('streamdown', () => ({
  useIsCodeFenceIncomplete: () => mocks.isCodeFenceIncomplete
}))

vi.mock('@renderer/components/CodeBlockView/CodeBlockView', () => ({
  CodeBlockView: mocks.CodeBlockView
}))

vi.mock('@renderer/components/CodeBlockView/HtmlArtifactsCard', () => ({
  default: mocks.HtmlArtifactsCard
}))

vi.mock('@renderer/components/chat/messages/blocks/MessageHtmlArtifact', () => ({
  MessageHtmlArtifact: mocks.MessageHtmlArtifact
}))

// Mock ClickableFilePath
vi.mock('@renderer/components/chat/messages/tools/shared/ClickableFilePath', () => ({
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
    mocks.messageListActions = { navigateToRoute: mocks.navigateToRoute, saveCodeBlock: mocks.saveCodeBlock }
    // Default mock return values
    mocks.getCodeBlockId.mockReturnValue('test-code-block-id')
    mocks.isCodeFenceIncomplete = false
  })

  describe('rendering', () => {
    it('should render inline code when no language match is found', () => {
      const inlineProps = {
        ...defaultProps,
        className: undefined,
        children: 'inline code'
      }
      render(<CodeBlock {...inlineProps} />)

      const codeElement = screen.getByText('inline code')
      expect(codeElement.tagName).toBe('CODE')
      expect(mocks.CodeBlockView).not.toHaveBeenCalled()
    })

    it('should render streamed inline code whose children are animate spans', () => {
      // Animate spans make children elements — and they persist post-settle (streamdown#570).
      render(<CodeBlock {...defaultProps} className={undefined} children={<span data-sd-animate="true">npm i</span>} />)

      expect(screen.getByText('npm i').tagName).toBe('SPAN')
      expect(mocks.CodeBlockView).not.toHaveBeenCalled()
    })

    it('should render streamed multi-word inline code as a span array', () => {
      render(
        <CodeBlock
          {...defaultProps}
          className={undefined}
          children={[
            <span key="1" data-sd-animate="true">
              npm
            </span>,
            ' ',
            <span key="2" data-sd-animate="true">
              i
            </span>
          ]}
        />
      )

      expect(screen.getByText('npm').tagName).toBe('SPAN')
      expect(screen.getByText('i', { exact: false }).tagName).toBe('SPAN')
    })

    it('keeps the path faded while an unclosed tail fence holds the block open', () => {
      // Widget swaps race the per-tick span rebuild, so a still-growing block stays faded.
      mocks.isCodeFenceIncomplete = true
      render(
        <CodeBlock
          {...defaultProps}
          className={undefined}
          isStreaming
          children={<span data-sd-animate="true">/Users/foo/bar.tsx</span>}
        />
      )

      expect(screen.queryByTestId('clickable-file-path')).not.toBeInTheDocument()
      expect(screen.getByText('/Users/foo/bar.tsx').tagName).toBe('SPAN')
    })

    it('promotes a settled animate-span path to the clickable file chip', () => {
      render(
        <CodeBlock
          {...defaultProps}
          className={undefined}
          children={<span data-sd-animate="true">/Users/foo/bar.tsx</span>}
        />
      )

      expect(screen.getByTestId('clickable-file-path')).toBeInTheDocument()
    })

    it('promotes once the block settles even while the part streams', () => {
      mocks.isCodeFenceIncomplete = false
      render(
        <CodeBlock
          {...defaultProps}
          className={undefined}
          isStreaming
          children={<span data-sd-animate="true">/Users/foo/bar.tsx</span>}
        />
      )

      expect(screen.getByTestId('clickable-file-path')).toBeInTheDocument()
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
    })

    it('should render known app routes as navigation entries instead of file paths', () => {
      render(<CodeBlock {...defaultProps} className={undefined} children="/app/chat" />)

      expect(screen.queryByTestId('clickable-file-path')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button'))
      expect(mocks.navigateToRoute).toHaveBeenCalledWith({ path: '/app/chat', query: undefined })
    })

    it('should keep unknown app-like paths as file paths', () => {
      render(<CodeBlock {...defaultProps} className={undefined} children="/app/not-a-route" />)

      expect(screen.getByTestId('clickable-file-path')).toBeInTheDocument()
    })

    it.each(['/settings/skills', '/settings/channels'])(
      'should render known settings route %s as a navigation entry',
      (path) => {
        render(<CodeBlock {...defaultProps} className={undefined} children={path} />)

        expect(screen.queryByTestId('clickable-file-path')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button'))
        expect(mocks.navigateToRoute).toHaveBeenCalledWith({ path, query: undefined })
      }
    )

    it.each([
      '/app/mini-app/example',
      '/app/paintings/example',
      '/settings/mcp/example/details',
      '/settings/scheduled-tasks/task-1'
    ])('should render declared dynamic route %s as a navigation entry', (path) => {
      render(<CodeBlock {...defaultProps} className={undefined} children={path} />)

      expect(screen.queryByTestId('clickable-file-path')).not.toBeInTheDocument()
    })

    it.each(['/app/chat/not-a-route', '/app/mini-app/example/details', '/settings/provider/not-a-route'])(
      'should keep undeclared descendant %s as a file path',
      (path) => {
        render(<CodeBlock {...defaultProps} className={undefined} children={path} />)

        expect(screen.getByTestId('clickable-file-path')).toBeInTheDocument()
      }
    )

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
      '/Users/suyao/Library/Application Support/CherryStudioDev/.claude/skills/guizang-ppt-skill/',
      './src/index.ts',
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

    it('should NOT detect a POSIX path as a file path on Windows', () => {
      mocks.isWin = true
      render(<CodeBlock {...defaultProps} className={undefined} children="/home/user/project/src/index.ts" />)
      expect(screen.queryByTestId('clickable-file-path')).not.toBeInTheDocument()
    })

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

    it('should pass Streamdown incomplete fence state to standard code blocks', () => {
      mocks.isCodeFenceIncomplete = true

      render(<CodeBlock {...defaultProps} />)

      expect(mocks.CodeBlockView).toHaveBeenCalledWith(
        expect.objectContaining({
          isStreaming: true
        }),
        undefined
      )
    })

    it('should pass parent streaming state to standard code blocks after the fence is complete', () => {
      mocks.isCodeFenceIncomplete = false

      render(<CodeBlock {...defaultProps} isStreaming />)

      expect(mocks.CodeBlockView).toHaveBeenCalledWith(
        expect.objectContaining({
          isStreaming: true
        }),
        undefined
      )
    })

    it('should pass editable=false for HTML artifacts when saving is unavailable', () => {
      mocks.messageListActions = {}
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

    it('renders completed HTML directly in its original Markdown position', () => {
      render(
        <CodeBlock
          {...defaultProps}
          className="language-html"
          children="<h1>Hello</h1>"
          inlineHtmlPreviewMode="ready"
        />
      )

      expect(mocks.HtmlArtifactsCard).not.toHaveBeenCalled()
      expect(mocks.MessageHtmlArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          artifactId: 'test-msg-block-id:test-code-block-id',
          editable: true,
          html: '<h1>Hello</h1>',
          kind: 'fragment',
          isStreaming: false,
          onSave: expect.any(Function)
        }),
        undefined
      )
    })

    it('classifies a completed HTML document so the view can gate it', () => {
      const html =
        '<!doctype html><html><head><link rel="stylesheet" href="https://example.com/style.css"></head></html>'
      render(<CodeBlock {...defaultProps} className="language-html" children={html} inlineHtmlPreviewMode="ready" />)

      expect(mocks.HtmlArtifactsCard).not.toHaveBeenCalled()
      expect(mocks.MessageHtmlArtifact).toHaveBeenCalledWith(
        expect.objectContaining({ html, kind: 'document', isStreaming: false }),
        undefined
      )
    })

    it('classifies active markup embedded in prose as a fragment, never gated', () => {
      const html = '<script>document.body.textContent = "interactive"</script>'
      render(<CodeBlock {...defaultProps} className="language-html" children={html} inlineHtmlPreviewMode="ready" />)

      expect(mocks.HtmlArtifactsCard).not.toHaveBeenCalled()
      expect(mocks.MessageHtmlArtifact).toHaveBeenCalledWith(
        expect.objectContaining({ html, kind: 'fragment', isStreaming: false }),
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

    it('should call saveCodeBlock when saving an inline HTML artifact', () => {
      render(
        <CodeBlock
          {...defaultProps}
          className="language-html"
          children="<h1>Hello</h1>"
          inlineHtmlPreviewMode="ready"
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Save Inline HTML' }))

      expect(mocks.saveCodeBlock).toHaveBeenCalledWith({
        msgBlockId: 'test-msg-block-id',
        codeBlockId: 'test-code-block-id',
        newContent: 'new inline html content'
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

    it('renders a streaming fenced HTML fragment in the existing message artifact view', () => {
      render(
        <CodeBlock {...defaultProps} className="language-html" inlineHtmlPreviewMode="generating">
          {'<div><h1>Hello</h1></div>'}
        </CodeBlock>
      )

      expect(mocks.HtmlArtifactsCard).not.toHaveBeenCalled()
      expect(mocks.CodeBlockView).not.toHaveBeenCalled()
      expect(mocks.MessageHtmlArtifact).toHaveBeenCalledWith(
        expect.objectContaining({ html: '<div><h1>Hello</h1></div>', kind: 'fragment', isStreaming: true }),
        undefined
      )
      expect(screen.getByTestId('message-html-streaming-state')).toHaveTextContent('true')
    })

    it('keeps a streaming HTML document in the display-only source view', () => {
      const html = '<!doctype html><html><body><h1>Hello</h1></body></html>'
      render(
        <CodeBlock {...defaultProps} className="language-html" inlineHtmlPreviewMode="generating">
          {html}
        </CodeBlock>
      )

      expect(mocks.HtmlArtifactsCard).not.toHaveBeenCalled()
      expect(mocks.MessageHtmlArtifact).not.toHaveBeenCalled()
      expect(mocks.CodeBlockView).toHaveBeenCalledWith(
        expect.objectContaining({
          children: html,
          editable: false,
          language: 'html',
          isStreaming: true,
          maxHeight: 350,
          showToolbar: false
        }),
        undefined
      )
    })

    it('renders an empty streaming fence without crashing', () => {
      expect(() =>
        render(
          <CodeBlock
            blockId={defaultProps.blockId}
            node={defaultProps.node}
            className="language-html"
            inlineHtmlPreviewMode="generating"
          />
        )
      ).not.toThrow()

      expect(mocks.CodeBlockView).not.toHaveBeenCalled()
      expect(mocks.MessageHtmlArtifact).not.toHaveBeenCalled()
    })

    it('holds the surface until a streamed prefix can be classified', () => {
      const partial = '<!doc'
      render(
        <CodeBlock {...defaultProps} className="language-html" inlineHtmlPreviewMode="generating">
          {partial}
        </CodeBlock>
      )

      expect(mocks.CodeBlockView).not.toHaveBeenCalled()
      expect(mocks.MessageHtmlArtifact).not.toHaveBeenCalled()
    })

    it('falls back to the fragment surface for unclassifiable but completed HTML', () => {
      render(
        <CodeBlock {...defaultProps} className="language-html" inlineHtmlPreviewMode="ready">
          {'plain text in an html fence'}
        </CodeBlock>
      )

      expect(mocks.MessageHtmlArtifact).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'fragment', isStreaming: false }),
        undefined
      )
    })
  })
})
