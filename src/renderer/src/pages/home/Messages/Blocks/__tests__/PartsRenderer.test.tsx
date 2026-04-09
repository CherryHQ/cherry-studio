import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { PartsContext } from '../V2Contexts'

// Mock dependencies
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: vi.fn(() => [false, vi.fn()])
}))

vi.mock('@renderer/utils/messageUtils/is', () => ({
  isMessageProcessing: vi.fn(() => false)
}))

// Mock motion/react to skip animations
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  motion: {
    div: ({ ref, children, ...props }) => (
      <div ref={ref} {...props}>
        {children}
      </div>
    )
  }
}))

// Mock ErrorBoundary
vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: any) => <>{children}</>
}))

// Mock Markdown to capture rendered content
vi.mock('@renderer/pages/home/Markdown/Markdown', () => ({
  __esModule: true,
  default: ({ block, postProcess }: any) => (
    <div data-testid="mock-markdown">{postProcess ? postProcess(block.content) : block.content}</div>
  ),
  MarkdownBlockContext: React.createContext(null)
}))

// Mock ImageBlock
vi.mock('../ImageBlock', () => ({
  __esModule: true,
  default: ({ images, isSingle, isPending }: any) => (
    <div
      data-testid="mock-image-block"
      data-images={JSON.stringify(images)}
      data-single={isSingle}
      data-pending={isPending}>
      ImageBlock
    </div>
  )
}))

// Mock lazy-loaded legacy components
vi.mock('../CitationBlock', () => ({ __esModule: true, default: () => <div>CitationBlock</div> }))
vi.mock('../ErrorBlock', () => ({ __esModule: true, default: () => <div>ErrorBlock</div> }))
vi.mock('../FileBlock', () => ({ __esModule: true, default: () => <div>FileBlock</div> }))
vi.mock('../ToolBlock', () => ({ __esModule: true, default: () => <div>ToolBlock</div> }))
vi.mock('../ToolBlockGroup', () => ({ __esModule: true, default: () => <div>ToolBlockGroup</div> }))
vi.mock('../VideoBlock', () => ({ __esModule: true, default: () => <div>VideoBlock</div> }))
vi.mock('../BlockErrorFallback', () => ({ __esModule: true, default: () => <div>Error</div> }))
vi.mock('../PlaceholderBlock', () => ({ __esModule: true, default: () => <div>Placeholder</div> }))

// Import after mocks
import PartsRenderer from '../PartsRenderer'

// Test helpers
const createMessage = (overrides: Partial<Message> = {}): Message =>
  ({
    id: 'msg-1',
    role: 'assistant',
    assistantId: 'asst-1',
    topicId: 'topic-1',
    createdAt: new Date().toISOString(),
    type: 'text',
    status: 'success',
    blocks: [],
    ...overrides
  }) as Message

const renderWithParts = (parts: CherryMessagePart[], message?: Message) => {
  const msg = message ?? createMessage()
  const partsMap = { [msg.id]: parts }
  return render(
    <PartsContext value={partsMap}>
      <PartsRenderer message={msg} />
    </PartsContext>
  )
}

describe('PartsRenderer', () => {
  describe('data-code rendering', () => {
    it('should render data-code part with language as markdown code fence', () => {
      const codePart = {
        type: 'data-code',
        data: { content: 'console.log("hello")', language: 'javascript' }
      } as unknown as CherryMessagePart

      renderWithParts([codePart])

      const markdown = screen.getByTestId('mock-markdown')
      expect(markdown).toBeInTheDocument()
      expect(markdown.textContent).toContain('```javascript')
      expect(markdown.textContent).toContain('console.log("hello")')
      expect(markdown.textContent).toContain('```')
    })

    it('should render data-code part without language', () => {
      const codePart = {
        type: 'data-code',
        data: { content: 'some code' }
      } as unknown as CherryMessagePart

      renderWithParts([codePart])

      const markdown = screen.getByTestId('mock-markdown')
      expect(markdown).toBeInTheDocument()
      expect(markdown.textContent).toContain('```')
      expect(markdown.textContent).toContain('some code')
    })

    it('should render data-code part with empty content', () => {
      const codePart = {
        type: 'data-code',
        data: { content: '', language: 'python' }
      } as unknown as CherryMessagePart

      renderWithParts([codePart])

      const markdown = screen.getByTestId('mock-markdown')
      expect(markdown).toBeInTheDocument()
      expect(markdown.textContent).toContain('```python')
    })
  })

  describe('image file part rendering', () => {
    it('should render single image file part with isSingle=true', () => {
      const imagePart = {
        type: 'file',
        url: 'https://example.com/image.png',
        mediaType: 'image/png'
      } as unknown as CherryMessagePart

      renderWithParts([imagePart])

      const imageBlock = screen.getByTestId('mock-image-block')
      expect(imageBlock).toBeInTheDocument()
      expect(imageBlock.getAttribute('data-images')).toBe('["https://example.com/image.png"]')
      expect(imageBlock.getAttribute('data-single')).toBe('true')
    })

    it('should render multiple image file parts as a group', () => {
      const images = [
        { type: 'file', url: 'https://example.com/a.png', mediaType: 'image/png' },
        { type: 'file', url: 'https://example.com/b.jpg', mediaType: 'image/jpeg' }
      ] as unknown as CherryMessagePart[]

      renderWithParts(images)

      const imageBlocks = screen.getAllByTestId('mock-image-block')
      expect(imageBlocks).toHaveLength(2)
      imageBlocks.forEach((block) => {
        expect(block.getAttribute('data-single')).toBe('false')
      })
    })

    it('should skip image file parts with no url', () => {
      const imagePart = {
        type: 'file',
        mediaType: 'image/png'
        // no url
      } as unknown as CherryMessagePart

      renderWithParts([imagePart])

      expect(screen.queryByTestId('mock-image-block')).not.toBeInTheDocument()
    })

    it('should skip image file parts with empty url', () => {
      const imagePart = {
        type: 'file',
        url: '',
        mediaType: 'image/png'
      } as unknown as CherryMessagePart

      renderWithParts([imagePart])

      expect(screen.queryByTestId('mock-image-block')).not.toBeInTheDocument()
    })

    it('should not treat non-image file parts as images', () => {
      const filePart = {
        type: 'file',
        url: 'https://example.com/doc.pdf',
        mediaType: 'application/pdf'
      } as unknown as CherryMessagePart

      renderWithParts([filePart])

      // Should NOT render as ImageBlock — should fall through to legacy FileBlock
      expect(screen.queryByTestId('mock-image-block')).not.toBeInTheDocument()
    })

    it('should handle mixed valid and invalid image parts in a group', () => {
      const images = [
        { type: 'file', url: 'https://example.com/a.png', mediaType: 'image/png' },
        { type: 'file', url: '', mediaType: 'image/jpeg' }, // invalid: empty url
        { type: 'file', url: 'https://example.com/c.gif', mediaType: 'image/gif' }
      ] as unknown as CherryMessagePart[]

      renderWithParts(images)

      // Only 2 valid images should render
      const imageBlocks = screen.getAllByTestId('mock-image-block')
      expect(imageBlocks).toHaveLength(2)
    })
  })

  describe('returns null for empty parts', () => {
    it('should return null when no parts exist', () => {
      const msg = createMessage()
      const { container } = render(
        <PartsContext value={{ [msg.id]: [] }}>
          <PartsRenderer message={msg} />
        </PartsContext>
      )
      expect(container.innerHTML).toBe('')
    })
  })

  describe('text citation rendering', () => {
    it('should preserve citation tagging for text part with web references', () => {
      const textPart = {
        type: 'text',
        text: '这是一段带引用的文本 [1]',
        providerMetadata: {
          cherry: {
            references: [
              {
                category: 'citation',
                citationType: 'web',
                content: {
                  source: 'websearch',
                  results: [{ url: 'https://example.com', title: 'Example' }]
                }
              }
            ]
          }
        }
      } as unknown as CherryMessagePart

      renderWithParts([textPart])

      const markdown = screen.getByTestId('mock-markdown')
      expect(markdown.textContent).toContain('data-citation')
      expect(markdown.textContent).toContain('https://example.com')
    })
  })
})
