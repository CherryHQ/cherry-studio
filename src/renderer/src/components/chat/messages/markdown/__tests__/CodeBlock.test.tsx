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
    isOpenFenceBlock: vi.fn(),
    usePreference: vi.fn().mockReturnValue([true]),
    isWin: false,
    CodeBlockView: vi.fn(({ onSave, children }) => (
      <div>
        <code>{children}</code>
        <button type="button" onClick={() => onSave('new code content')}>
          Save
        </button>
      </div>
    )),
    HtmlArtifactsCard: vi.fn(({ onSave, html }) => (
      <div>
        <div>{html}</div>
        <button type="button" onClick={() => onSave('new html content')}>
          Save HTML
        </button>
      </div>
    ))
  }
})

vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => mocks.messageListActions
}))

vi.mock('@renderer/config/constant', () => ({
  get isWin() {
    return mocks.isWin
  }
}))

vi.mock('@renderer/utils/markdown', () => ({
  getCodeBlockId: mocks.getCodeBlockId,
  isOpenFenceBlock: mocks.isOpenFenceBlock
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => mocks.usePreference()
}))

vi.mock('@renderer/components/CodeBlockView', () => ({
  CodeBlockView: mocks.CodeBlockView,
  HtmlArtifactsCard: mocks.HtmlArtifactsCard
}))

vi.mock('../Markdown', () => ({
  useMarkdownBlockContext: vi.fn(() => null)
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
    // Default mock return values
    mocks.getCodeBlockId.mockReturnValue('test-code-block-id')
    mocks.isOpenFenceBlock.mockReturnValue(false)
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
    })

    it.each(['/home/user/project/src/index.ts', '/tmp/test.log', '/var/log/app.log', '/etc/nginx/nginx.conf'])(
      'should detect %s as a file path',
      (path) => {
        render(<CodeBlock {...defaultProps} className={undefined} children={path} />)
        expect(screen.getByTestId('clickable-file-path')).toBeInTheDocument()
      }
    )

    it.each(['inline code', '/single-segment', '//comment style', 'not/absolute/path', '/path with spaces/file.ts'])(
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
  })
})
