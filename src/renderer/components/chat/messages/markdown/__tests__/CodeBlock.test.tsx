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
    mocks.messageListActions = { saveCodeBlock: mocks.saveCodeBlock }
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

    it('should render without a message list provider', () => {
      mocks.messageListActions = undefined

      expect(() => render(<CodeBlock {...defaultProps} />)).not.toThrow()
      fireEvent.click(screen.getByText('Save'))
      expect(mocks.saveCodeBlock).not.toHaveBeenCalled()
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

      expect(mocks.saveCodeBlock).toHaveBeenCalledOnce()
      expect(mocks.saveCodeBlock).toHaveBeenCalledWith({
        msgBlockId: 'test-msg-block-id',
        originalContent: 'console.log("hello world")',
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

      expect(mocks.saveCodeBlock).toHaveBeenCalledOnce()
      expect(mocks.saveCodeBlock).toHaveBeenCalledWith({
        msgBlockId: 'test-msg-block-id',
        originalContent: '<h1>Hello</h1>',
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
        originalContent: '<h1>Hello</h1>',
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
