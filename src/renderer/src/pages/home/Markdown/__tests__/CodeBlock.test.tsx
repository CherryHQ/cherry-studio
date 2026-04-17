import { MessageBlockStatus } from '@renderer/types/newMessage'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CodeBlock from '../CodeBlock'

// Hoisted mocks
const mocks = vi.hoisted(() => ({
  EventEmitter: {
    emit: vi.fn()
  },
  getCodeBlockId: vi.fn(),
  isOpenFenceBlock: vi.fn(),
  selectById: vi.fn(),
  useSettings: vi.fn().mockReturnValue({ codeFancyBlock: true }),
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
}))

// Mock modules
vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: { EDIT_CODE_BLOCK: 'EDIT_CODE_BLOCK' },
  EventEmitter: mocks.EventEmitter
}))

vi.mock('@renderer/utils/markdown', () => ({
  getCodeBlockId: mocks.getCodeBlockId,
  isOpenFenceBlock: mocks.isOpenFenceBlock
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn(() => ({})) // Mock store, state doesn't matter here
  }
}))

vi.mock('@renderer/store/messageBlock', () => ({
  messageBlocksSelectors: {
    selectById: mocks.selectById
  }
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => mocks.useSettings()
}))

vi.mock('@renderer/components/CodeBlockView', () => ({
  CodeBlockView: mocks.CodeBlockView,
  HtmlArtifactsCard: mocks.HtmlArtifactsCard
}))

// Mock ClickableFilePath
vi.mock('@renderer/pages/home/Messages/Tools/MessageAgentTools/ClickableFilePath', () => ({
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
    // Default mock return values
    mocks.getCodeBlockId.mockReturnValue('test-code-block-id')
    mocks.isOpenFenceBlock.mockReturnValue(false)
    mocks.selectById.mockReturnValue({
      id: 'test-msg-block-id',
      status: MessageBlockStatus.SUCCESS
    })
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
  })

  describe('save', () => {
    it('should call EventEmitter with correct payload when saving a standard code block', () => {
      render(<CodeBlock {...defaultProps} />)

      // Simulate clicking the save button inside the mocked CodeBlockView
      const saveButton = screen.getByText('Save')
      fireEvent.click(saveButton)

      // Verify getCodeBlockId was called
      expect(mocks.getCodeBlockId).toHaveBeenCalledWith(defaultProps.node.position.start)

      // Verify EventEmitter.emit was called
      expect(mocks.EventEmitter.emit).toHaveBeenCalledOnce()
      expect(mocks.EventEmitter.emit).toHaveBeenCalledWith('EDIT_CODE_BLOCK', {
        msgBlockId: 'test-msg-block-id',
        codeBlockId: 'test-code-block-id',
        newContent: 'new code content'
      })
    })

    it('should call EventEmitter with correct payload when saving an HTML block', () => {
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

      // Verify EventEmitter.emit was called
      expect(mocks.EventEmitter.emit).toHaveBeenCalledOnce()
      expect(mocks.EventEmitter.emit).toHaveBeenCalledWith('EDIT_CODE_BLOCK', {
        msgBlockId: 'test-msg-block-id',
        codeBlockId: 'test-code-block-id',
        newContent: 'new html content'
      })
    })
  })
})
