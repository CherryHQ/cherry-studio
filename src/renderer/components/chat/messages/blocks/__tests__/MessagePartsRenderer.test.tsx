import type { CherryMessagePart } from '@shared/data/types/message'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageListProvider } from '../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem, type MessageListProviderValue } from '../../types'
import { PartsProvider } from '../MessagePartsContext'

// ============================================================================
// Mocks — keep minimal, only mock what prevents module loading
// ============================================================================

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('@data/hooks/usePreference', () => ({ usePreference: vi.fn(() => [false, vi.fn()]) }))
const mockIsActiveTurnTarget = vi.hoisted(() => vi.fn(() => false))
vi.mock('@renderer/hooks/useIsActiveTurnTarget', () => ({
  useIsActiveTurnTarget: () => mockIsActiveTurnTarget()
}))
vi.mock('@renderer/types/file', () => ({
  FILE_TYPE: { IMAGE: 'image', VIDEO: 'video', AUDIO: 'audio', TEXT: 'text', DOCUMENT: 'document', OTHER: 'other' }
}))

// motion/react — provide motion.create so Spinner.tsx module loads
vi.mock('motion/react', () => {
  const Div = ({ ref, children, ...p }: any) => (
    <div ref={ref} {...p}>
      {children}
    </div>
  )
  const proxy = new Proxy({ div: Div, create: (C: any) => C }, { get: (t, k) => (t as any)[k] ?? Div })
  return { AnimatePresence: ({ children }: any) => <>{children}</>, motion: proxy }
})

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: any) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, number>) => {
      if (key === 'message.tools.groupHeader') {
        return `${params?.count} tool calls`
      }
      if (key === 'message.tools.thinkingHeader') return 'Thinking...'
      return key
    }
  })
}))

// Leaf component mocks — render data-testid with key props for assertions
vi.mock('@renderer/components/chat/messages/markdown/ChatMarkdown', () => ({
  __esModule: true,
  default: ({ block, postProcess }: any) => (
    <div data-testid="mock-markdown">{postProcess ? postProcess(block.content) : block.content}</div>
  ),
  MarkdownBlockContext: React.createContext(null)
}))

vi.mock('../ImageBlock', () => ({
  __esModule: true,
  default: ({ images, isSingle }: any) => (
    <div data-testid="mock-image-block" data-images={JSON.stringify(images)} data-single={String(isSingle)} />
  )
}))

vi.mock('../../tools/MessageTools', () => ({
  __esModule: true,
  canRenderMessageTool: (toolResponse: any) =>
    !(toolResponse?.tool?.type === 'provider' && toolResponse?.tool?.name === 'web__search'),
  default: ({ toolResponse }: any) => (
    <div
      data-testid="mock-message-tools"
      data-status={toolResponse?.status}
      data-tool-type={toolResponse?.tool?.type}
      data-tool-name={toolResponse?.tool?.name}
      data-server-name={toolResponse?.tool?.serverName ?? ''}
    />
  )
}))

vi.mock('../../tools/toolResponse', () => ({
  buildToolResponseFromPart: (part: any, fallbackId?: string) => {
    const t = part.type as string
    if (!t.startsWith('tool-') && t !== 'dynamic-tool') return null
    const id = part.toolCallId ?? fallbackId
    if (!id) return null
    const name = part.toolName || t.replace(/^tool-/, '') || 'unknown'
    const out = part.output
    const meta = out && typeof out === 'object' && out.metadata ? out.metadata : undefined
    const isMcp = meta?.type === 'mcp' || t === 'dynamic-tool'
    const status =
      part.state === 'output-available'
        ? 'done'
        : part.state === 'output-error'
          ? 'error'
          : part.state === 'input-available'
            ? 'invoking'
            : 'pending'
    return {
      id,
      toolCallId: id,
      tool: {
        id,
        name,
        type: part.toolType ?? (isMcp ? 'mcp' : 'builtin'),
        ...(isMcp ? { serverId: meta?.serverId ?? 'unknown', serverName: meta?.serverName ?? 'MCP' } : {})
      },
      arguments: part.input,
      status,
      response: part.state === 'output-error' ? { isError: true } : (out?.content ?? out)
    }
  }
}))

vi.mock('../../frame/MessageVideo', () => ({
  __esModule: true,
  default: ({ url, filePath }: any) => (
    <div data-testid="mock-message-video" data-url={url ?? ''} data-file-path={filePath ?? ''} />
  )
}))

vi.mock('../ErrorBlock', () => ({
  __esModule: true,
  default: ({ error }: any) => <div data-testid="mock-error-block" data-error-message={error?.message ?? ''} />
}))

vi.mock('../ThinkingBlock', () => ({
  __esModule: true,
  default: ({ content }: any) => <div data-testid="mock-thinking-block">{content}</div>
}))

vi.mock('../../frame/MessageAttachments', () => ({
  __esModule: true,
  default: ({ file }: any) => <div data-testid="mock-attachments" data-file-name={file?.name ?? ''} />
}))

vi.mock('../ToolBlockGroup', () => ({
  __esModule: true,
  ToolBlockGroupContent: ({ items }: any) => (
    <div data-testid="mock-tool-group-content" data-count={items?.length ?? 0}>
      {items?.map((item: any) => (
        <div
          key={item.id}
          data-testid="mock-message-tools"
          data-status={item.toolResponse?.status}
          data-tool-type={item.toolResponse?.tool?.type}
          data-tool-name={item.toolResponse?.tool?.name}
          data-server-name={item.toolResponse?.tool?.serverName ?? ''}
        />
      ))}
    </div>
  ),
  ToolBlockGroupHeaderContent: ({ activityLabel, summary, items }: any) => (
    <span>{activityLabel ?? summary ?? `${items?.length ?? 0} tool calls`}</span>
  ),
  default: ({ items }: any) => <div data-testid="mock-tool-group" data-count={items?.length ?? 0} />
}))

vi.mock('../BlockErrorFallback', () => ({ __esModule: true, default: () => null }))
vi.mock('../PlaceholderBlock', () => ({
  __esModule: true,
  default: ({ createdAt, status }: any) => (
    <div data-testid="mock-placeholder" data-created-at={createdAt} data-status={status} />
  )
}))

// ============================================================================
// Setup
// ============================================================================

import MessagePartsRenderer from '../MessagePartsRenderer'

const msg = (overrides: Partial<MessageListItem> = {}): MessageListItem =>
  ({
    id: 'msg-1',
    role: 'assistant',
    assistantId: 'a',
    topicId: 't',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'success',
    ...overrides
  }) as MessageListItem

const renderParts = (parts: CherryMessagePart[], message?: MessageListItem) => {
  const m = message ?? msg()
  const value: MessageListProviderValue = {
    state: {
      topic: { id: m.topicId, name: 'Topic' } as MessageListProviderValue['state']['topic'],
      messages: [m],
      partsByMessageId: { [m.id]: parts },
      messageNavigation: 'none',
      estimateSize: 400,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: defaultMessageRenderConfig,
      getMessageActivityState: () => ({
        isProcessing: false,
        isStreamTarget: false,
        isApprovalAnchor: false
      })
    },
    actions: {},
    meta: { selectionLayer: false }
  }

  return render(
    <MessageListProvider value={value}>
      <PartsProvider value={{ [m.id]: parts }}>
        <MessagePartsRenderer message={m} />
      </PartsProvider>
    </MessageListProvider>
  )
}

// ============================================================================
// Tests
// ============================================================================

describe('MessagePartsRenderer', () => {
  beforeEach(() => {
    mockIsActiveTurnTarget.mockReturnValue(false)
  })

  // -- empty --
  it('renders nothing for empty parts', () => {
    const { container } = renderParts([])
    expect(container.innerHTML).toBe('')
  })

  it('shows the preparing placeholder before any parts arrive', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    renderParts([], msg({ status: 'pending' }))

    expect(screen.getByTestId('mock-placeholder')).toHaveAttribute('data-status', 'preparing')
    expect(screen.getByTestId('mock-placeholder')).toHaveAttribute('data-created-at', '2026-01-01T00:00:00Z')
  })

  it('shows the thinking placeholder while reasoning is the latest activity', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    renderParts([{ type: 'reasoning', text: 'thinking', state: 'streaming' } as unknown as CherryMessagePart])

    expect(screen.getByTestId('mock-placeholder')).toHaveAttribute('data-status', 'thinking')
  })

  it('shows the tool placeholder while a tool call is the latest activity', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    renderParts([
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'Read', state: 'input-available', input: {} }
    ] as unknown as CherryMessagePart[])

    expect(screen.getByTestId('mock-placeholder')).toHaveAttribute('data-status', 'usingTools')
  })

  it('shows the generating placeholder after answer text starts streaming', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    renderParts([{ type: 'text', text: 'partial answer' } as unknown as CherryMessagePart])

    expect(screen.getByTestId('mock-placeholder')).toHaveAttribute('data-status', 'generating')
  })

  // -- text --
  it('renders text part via Markdown', () => {
    renderParts([{ type: 'text', text: 'hello world' } as unknown as CherryMessagePart])
    expect(screen.getByTestId('mock-markdown').textContent).toContain('hello world')
  })

  // -- data-code --
  it('renders data-code as markdown code fence', () => {
    renderParts([
      { type: 'data-code', data: { content: 'console.log(1)', language: 'js' } } as unknown as CherryMessagePart
    ])
    const md = screen.getByTestId('mock-markdown')
    expect(md.textContent).toContain('```js')
    expect(md.textContent).toContain('console.log(1)')
  })

  // -- images --
  it('renders single image with isSingle=true', () => {
    renderParts([
      { type: 'file', url: 'https://img.test/a.png', mediaType: 'image/png' } as unknown as CherryMessagePart
    ])
    const el = screen.getByTestId('mock-image-block')
    expect(el.getAttribute('data-single')).toBe('true')
    expect(el.getAttribute('data-images')).toBe('["https://img.test/a.png"]')
  })

  it('renders multiple images as group with isSingle=false', () => {
    renderParts([
      { type: 'file', url: 'https://img.test/a.png', mediaType: 'image/png' },
      { type: 'file', url: 'https://img.test/b.jpg', mediaType: 'image/jpeg' }
    ] as unknown as CherryMessagePart[])
    const blocks = screen.getAllByTestId('mock-image-block')
    expect(blocks).toHaveLength(2)
    blocks.forEach((b) => expect(b.getAttribute('data-single')).toBe('false'))
  })

  it('skips image parts without url', () => {
    renderParts([{ type: 'file', mediaType: 'image/png' } as unknown as CherryMessagePart])
    expect(screen.queryByTestId('mock-image-block')).toBeNull()
  })

  // -- non-image file --
  it('renders non-image file as attachment', () => {
    renderParts([
      {
        type: 'file',
        url: 'file:///doc.pdf',
        mediaType: 'application/pdf',
        filename: 'doc.pdf'
      } as unknown as CherryMessagePart
    ])
    expect(screen.queryByTestId('mock-image-block')).toBeNull()
    expect(screen.getByTestId('mock-attachments').getAttribute('data-file-name')).toBe('doc.pdf')
  })

  // -- tool (single) --
  it('renders single dynamic-tool via MessageTools', () => {
    renderParts([
      {
        type: 'dynamic-tool',
        toolCallId: 'tc-1',
        toolName: 'search',
        state: 'output-available',
        input: { q: 'hi' },
        output: { content: 'ok', metadata: { serverName: 'S', serverId: 's1', type: 'mcp' } }
      } as unknown as CherryMessagePart
    ])
    const el = screen.getByTestId('mock-message-tools')
    expect(el.getAttribute('data-status')).toBe('done')
    expect(el.getAttribute('data-tool-name')).toBe('search')
    expect(el.getAttribute('data-server-name')).toBe('S')
  })

  it('hides tool parts that belong to a parent agent flow', () => {
    renderParts([
      {
        type: 'dynamic-tool',
        toolCallId: 'parent',
        toolName: 'Agent',
        state: 'output-available',
        input: { description: 'Explore project' },
        output: {}
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'child',
        toolName: 'Read',
        state: 'output-available',
        output: {},
        callProviderMetadata: {
          'claude-code': {
            parentToolCallId: 'parent'
          }
        }
      },
      {
        type: 'text',
        text: 'child text',
        providerMetadata: {
          'claude-code': {
            parentToolCallId: 'parent'
          }
        }
      }
    ] as unknown as CherryMessagePart[])

    const tools = screen.getAllByTestId('mock-message-tools')
    expect(tools).toHaveLength(1)
    expect(tools[0].getAttribute('data-tool-name')).toBe('Agent')
    expect(screen.queryByText('child text')).toBeNull()
  })

  // -- tool group --
  it('renders multiple tool parts as ToolBlockGroup', () => {
    renderParts([
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 't1', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 't2', state: 'output-available', output: {} }
    ] as unknown as CherryMessagePart[])
    expect(screen.getByTestId('mock-tool-group').getAttribute('data-count')).toBe('2')
  })

  it('renders grouped dynamic-tool parts without persisted toolCallId using fallback ids', () => {
    renderParts([
      { type: 'dynamic-tool', toolName: 'TodoWrite', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolName: 'WebSearch', state: 'output-available', output: {} }
    ] as unknown as CherryMessagePart[])
    expect(screen.getByTestId('mock-tool-group').getAttribute('data-count')).toBe('2')
  })

  it('filters hidden tool responses inside ToolBlockGroup', () => {
    renderParts([
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'visible-tool', state: 'output-available', output: {} },
      {
        type: 'dynamic-tool',
        toolCallId: 'hidden-web-search',
        toolName: 'web__search',
        toolType: 'provider',
        state: 'output-available',
        output: {}
      },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'another-visible-tool', state: 'output-available', output: {} }
    ] as unknown as CherryMessagePart[])

    expect(screen.getByTestId('mock-tool-group').getAttribute('data-count')).toBe('2')
  })

  it('collapses completed tool history before final result', () => {
    renderParts([
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'text', text: 'reading package metadata' },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'output-available', output: {} },
      { type: 'text', text: 'final answer' }
    ] as unknown as CherryMessagePart[])

    const historyButton = screen.getByRole('button', { name: '2 tool calls' })
    expect(screen.getByTestId('mock-markdown').textContent).toContain('final answer')
    expect(screen.queryByText(/checking project files/)).toBeNull()
    expect(screen.queryByText(/reading package metadata/)).toBeNull()

    fireEvent.click(historyButton)

    expect(document.getElementById(historyButton.getAttribute('aria-controls') ?? '')).toHaveClass(
      'mt-1.5 flex w-full flex-col gap-2 [&_.message-thought-container]:mb-0! [&_.message-thought-container]:mt-0! [&>.block-wrapper:empty]:hidden'
    )
    expect(screen.getAllByTestId('mock-message-tools')).toHaveLength(2)
    expect(screen.getAllByTestId('mock-markdown').map((node) => node.textContent)).toEqual([
      'checking project files',
      'reading package metadata',
      'final answer'
    ])
  })

  it('expands completed history tool runs without nesting another ToolBlockGroup', () => {
    renderParts([
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'output-available', output: {} },
      { type: 'text', text: 'final answer' }
    ] as unknown as CherryMessagePart[])

    const historyButton = screen.getByRole('button', { name: '2 tool calls' })
    expect(screen.getByTestId('mock-markdown')).toHaveTextContent('final answer')
    expect(screen.queryByTestId('mock-tool-group')).toBeNull()

    fireEvent.click(historyButton)

    expect(screen.queryByTestId('mock-tool-group')).toBeNull()
    expect(screen.getByTestId('mock-tool-group-content').getAttribute('data-count')).toBe('2')
    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      'list',
      'read'
    ])
  })

  it('collapses reasoning after the final tool before final result', () => {
    renderParts([
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'reasoning', text: 'deep thought after tool', state: 'done' },
      { type: 'text', text: 'final answer' }
    ] as unknown as CherryMessagePart[])

    const historyButton = screen.getByRole('button', { name: '1 tool calls' })
    expect(screen.getByTestId('mock-markdown').textContent).toContain('final answer')
    expect(screen.queryByText(/checking project files/)).toBeNull()
    expect(screen.queryByTestId('mock-thinking-block')).toBeNull()

    fireEvent.click(historyButton)

    expect(screen.getByTestId('mock-thinking-block')).toHaveTextContent('deep thought after tool')
    expect(screen.getAllByTestId('mock-markdown').map((node) => node.textContent)).toEqual([
      'checking project files',
      'final answer'
    ])
  })

  it('marks consecutive reasoning blocks for consistent spacing', () => {
    renderParts([
      { type: 'reasoning', text: 'first thought', state: 'done' },
      { type: 'reasoning', text: 'second thought', state: 'done' }
    ] as unknown as CherryMessagePart[])

    const thinkingBlocks = screen.getAllByTestId('mock-thinking-block')
    expect(thinkingBlocks).toHaveLength(2)

    const wrappers = thinkingBlocks.map((block) => block.closest('.block-wrapper'))
    expect(wrappers[0]).toHaveClass('message-thought-wrapper')
    expect(wrappers[1]).toHaveClass('message-thought-wrapper')
  })

  it('does not render an empty wrapper for tool responses hidden by the tool renderer', () => {
    const { container } = renderParts([
      { type: 'reasoning', text: 'first thought', state: 'done' },
      {
        type: 'dynamic-tool',
        toolCallId: 'hidden-web-search',
        toolName: 'web__search',
        toolType: 'provider',
        state: 'output-available',
        output: {}
      },
      { type: 'reasoning', text: 'second thought', state: 'done' }
    ] as unknown as CherryMessagePart[])

    expect(screen.getAllByTestId('mock-thinking-block')).toHaveLength(2)
    expect(screen.queryByTestId('mock-message-tools')).toBeNull()
    expect(container.querySelectorAll('.block-wrapper')).toHaveLength(2)
  })

  it('collapses tool history while message is pending and keeps the final answer visible', () => {
    renderParts(
      [
        { type: 'text', text: 'checking project files' },
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
        { type: 'text', text: 'final answer' }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    const historyButton = screen.getByRole('button', { name: '1 tool calls' })
    expect(historyButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('mock-markdown')).toHaveTextContent('final answer')
    expect(screen.queryByText(/checking project files/)).toBeNull()

    fireEvent.click(historyButton)

    expect(historyButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByTestId('mock-markdown').map((node) => node.textContent)).toEqual([
      'checking project files',
      'final answer'
    ])
  })

  it('collapses thinking content with active tool history before the final result exists', () => {
    renderParts(
      [
        { type: 'reasoning', text: 'thinking before tool', state: 'streaming' },
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'input-available', input: {} }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    const historyButton = screen.getByRole('button', { name: '1 tool calls' })
    expect(historyButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('thinking before tool')).toBeNull()
    expect(screen.queryByTestId('mock-message-tools')).toBeNull()

    fireEvent.click(historyButton)

    expect(historyButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('mock-thinking-block')).toHaveTextContent('thinking before tool')
    expect(screen.getByTestId('mock-message-tools').getAttribute('data-tool-name')).toBe('list')
  })

  it('shows thinking as the top-level history title while reasoning is streaming after a tool', () => {
    renderParts(
      [
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
        { type: 'reasoning', text: 'thinking after tool', state: 'streaming' }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    const historyButton = screen.getByRole('button', { name: 'Thinking...' })
    expect(historyButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('mock-thinking-block')).toBeNull()

    fireEvent.click(historyButton)

    expect(historyButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('mock-thinking-block')).toHaveTextContent('thinking after tool')
    expect(screen.getByTestId('mock-message-tools').getAttribute('data-tool-name')).toBe('list')
  })

  // -- data-video --
  it('renders data-video with filePath', () => {
    renderParts([{ type: 'data-video', data: { filePath: '/tmp/v.mp4' } } as unknown as CherryMessagePart])
    const el = screen.getByTestId('mock-message-video')
    expect(el.getAttribute('data-file-path')).toBe('/tmp/v.mp4')
  })

  it('renders data-video with url', () => {
    renderParts([{ type: 'data-video', data: { url: 'https://v.test/v.mp4' } } as unknown as CherryMessagePart])
    expect(screen.getByTestId('mock-message-video').getAttribute('data-url')).toBe('https://v.test/v.mp4')
  })

  // -- data-error --
  it('renders data-error as ErrorBlock', () => {
    renderParts([{ type: 'data-error', data: { name: 'Err', message: 'boom' } } as unknown as CherryMessagePart])
    expect(screen.getByTestId('mock-error-block').getAttribute('data-error-message')).toBe('boom')
  })

  // -- data-citation --
  it('returns nothing for data-citation (embedded in text)', () => {
    const { container } = renderParts([{ type: 'data-citation', data: {} } as unknown as CherryMessagePart])
    // Should render the AnimatePresence wrapper but no visible content
    expect(container.querySelector('[data-testid]')).toBeNull()
  })

  // -- source-url / step-start --
  it('skips source-url and step-start parts', () => {
    const { container } = renderParts([
      { type: 'source-url' } as unknown as CherryMessagePart,
      { type: 'step-start' } as unknown as CherryMessagePart
    ])
    expect(container.querySelector('[data-testid]')).toBeNull()
  })

  // -- text with citations --
  it('passes citation references through to MainTextBlock', () => {
    renderParts([
      {
        type: 'text',
        text: 'cited [1]',
        providerMetadata: {
          cherry: {
            references: [
              {
                category: 'citation',
                citationType: 'web',
                content: { source: 'websearch', results: [{ url: 'https://ex.com', title: 'Ex' }] }
              }
            ]
          }
        }
      } as unknown as CherryMessagePart
    ])
    const md = screen.getByTestId('mock-markdown')
    expect(md.textContent).toContain('data-citation')
    expect(md.textContent).toContain('https://ex.com')
  })

  it('renders user text composer metadata as inline token chips', () => {
    renderParts(
      [
        {
          type: 'text',
          text: 'Open ',
          providerMetadata: {
            cherry: {
              composer: {
                version: 1,
                tokens: [{ id: 'kb-1', kind: 'knowledge', label: 'Docs', index: 0, textOffset: 5 }]
              }
            }
          }
        } as unknown as CherryMessagePart
      ],
      msg({ role: 'user' })
    )

    expect(screen.getByText('Docs')).toBeInTheDocument()
    expect(document.querySelector('[data-composer-token-kind="knowledge"]')).toBeInTheDocument()
  })
})
