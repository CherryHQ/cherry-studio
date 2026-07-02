import type { CherryMessagePart } from '@shared/data/types/message'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
const mockTopicStreamState = vi.hoisted(() => ({ status: undefined as string | undefined, isPending: false }))
const mockThinkingBlockMounted = vi.hoisted(() => vi.fn())
vi.mock('@renderer/hooks/useIsActiveTurnTarget', () => ({
  useIsActiveTurnTarget: () => mockIsActiveTurnTarget()
}))
vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({
    status: mockTopicStreamState.status,
    activeExecutions: [],
    awaitingApprovalAnchors: [],
    isPending: mockTopicStreamState.isPending,
    isFulfilled: false,
    markSeen: vi.fn()
  })
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
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, number>) => {
      if (key === 'message.tools.groupHeader') {
        return `${params?.count} tool calls`
      }
      if (key === 'message.tools.runningHeader') return 'Working…'
      if (key === 'message.tools.thinkingHeader') return 'Thinking...'
      if (key === 'common.preview') return 'Preview'
      if (key === 'common.collapse') return '收起'
      if (key === 'common.close') return 'Close'
      if (key === 'common.reasoning_content') return 'Reasoning content'
      if (key === 'chat.input.tools.open_file') return 'Open File'
      if (key === 'chat.input.tools.open_file_error') return 'Failed to open file'
      return key
    }
  })
}))

vi.mock('@iconify/react', () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />
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
    toolResponse?.tool?.name !== 'report_artifacts' &&
    !(toolResponse?.tool?.type === 'provider' && toolResponse?.tool?.name === 'web_search'),
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
  default: function ThinkingBlockMock({ content, thinkingMs, thoughtsTokens }: any) {
    React.useEffect(() => {
      mockThinkingBlockMounted()
    }, [])
    return (
      <div
        data-testid="mock-thinking-block"
        data-thinking-ms={String(thinkingMs)}
        data-thoughts-tokens={String(thoughtsTokens ?? '')}>
        {content}
      </div>
    )
  }
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
  ToolBlockGroupHeaderContent: ({
    activityLabel,
    elapsedText,
    summary,
    items,
    isLiveProgress,
    preferSummary,
    showLatestWhenComplete
  }: any) => (
    <span
      data-live={String(!!isLiveProgress)}
      data-prefer-summary={String(!!preferSummary)}
      data-show-latest={String(!!showLatestWhenComplete)}>
      {preferSummary
        ? (summary ?? `${items?.length ?? 0} tool calls`)
        : (activityLabel ??
          (showLatestWhenComplete ? items?.at(-1)?.toolResponse?.tool?.name : undefined) ??
          summary ??
          `${items?.length ?? 0} tool calls`)}
      {elapsedText ? ` · ${elapsedText}` : ''}
    </span>
  )
}))

vi.mock('../BlockErrorFallback', () => ({ __esModule: true, default: () => null }))
vi.mock('../PlaceholderBlock', () => ({
  __esModule: true,
  default: ({ createdAt, status }: any) => (
    <div data-testid="mock-placeholder" data-created-at={createdAt} data-status={status} />
  ),
  formatPlaceholderElapsed: () => '1 second',
  usePlaceholderElapsedMs: () => 1200
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

const renderPartsTree = (
  parts: CherryMessagePart[],
  message?: MessageListItem,
  actions: MessageListProviderValue['actions'] = {},
  renderConfig: MessageListProviderValue['state']['renderConfig'] = defaultMessageRenderConfig
) => {
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
      renderConfig,
      getMessageActivityState: () => ({
        isProcessing: false,
        isStreamTarget: false,
        isApprovalAnchor: false
      })
    },
    actions,
    meta: { selectionLayer: false }
  }

  return (
    <MessageListProvider value={value}>
      <PartsProvider value={{ [m.id]: parts }}>
        <MessagePartsRenderer message={m} />
      </PartsProvider>
    </MessageListProvider>
  )
}

const renderParts = (
  parts: CherryMessagePart[],
  message?: MessageListItem,
  actions: MessageListProviderValue['actions'] = {},
  renderConfig: MessageListProviderValue['state']['renderConfig'] = defaultMessageRenderConfig
) => render(renderPartsTree(parts, message, actions, renderConfig))

// ============================================================================
// Tests
// ============================================================================

describe('MessagePartsRenderer', () => {
  beforeEach(() => {
    mockIsActiveTurnTarget.mockReturnValue(false)
    mockTopicStreamState.status = undefined
    mockTopicStreamState.isPending = false
    mockThinkingBlockMounted.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it('does not show a duplicate thinking placeholder when reasoning is the latest activity', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    const { container } = renderParts(
      [{ type: 'reasoning', text: 'thinking', state: 'streaming' } as unknown as CherryMessagePart],
      msg({ status: 'pending' })
    )

    expect(screen.queryByTestId('mock-placeholder')).toBeNull()
    expect(screen.getByRole('button', { name: 'Thinking... · 1 second' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(screen.getByTestId('tool-history-preview')).getByTestId('mock-thinking-block')).toBeInTheDocument()
    expect(
      Array.from(
        container.querySelectorAll('[data-testid="mock-placeholder"], [data-testid="mock-thinking-block"]')
      ).map((node) => node.getAttribute('data-testid'))
    ).toEqual(['mock-thinking-block'])
  })

  it('shows the tool placeholder while a tool call is the latest activity', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    renderParts(
      [
        {
          type: 'dynamic-tool',
          toolCallId: 'a',
          toolName: 'Read',
          state: 'input-available',
          input: { path: 'package.json' },
          output: { metadata: { serverName: 'S', serverId: 's1', type: 'mcp' } }
        }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    // The live tool history stays collapsed and shows a bounded preview instead
    // of the generic processing placeholder.
    expect(screen.getByRole('button', { name: '1 tool calls · 1 second' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('mock-placeholder')).toBeNull()
    expect(within(screen.getByTestId('tool-history-preview')).getByTestId('mock-message-tools')).toBeInTheDocument()
  })

  it('does not show a generating placeholder once answer text exists while streaming', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    const { container } = renderParts([{ type: 'text', text: 'partial answer' } as unknown as CherryMessagePart])

    expect(screen.queryByTestId('mock-placeholder')).toBeNull()
    expect(
      Array.from(container.querySelectorAll('[data-testid="mock-markdown"], [data-testid="mock-placeholder"]')).map(
        (node) => node.getAttribute('data-testid')
      )
    ).toEqual(['mock-markdown'])
  })

  // -- text --
  it('renders text part via Markdown', () => {
    renderParts([{ type: 'text', text: 'hello world' } as unknown as CherryMessagePart])
    expect(screen.getByTestId('mock-markdown').textContent).toContain('hello world')
  })

  it('renders a compaction anchor as a separator without a placeholder', () => {
    renderParts([
      {
        type: 'data-compaction-anchor',
        data: { trigger: 'auto', completedAt: '2026-06-09T12:00:00.000Z' }
      } as unknown as CherryMessagePart
    ])

    expect(screen.getByRole('separator')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-placeholder')).toBeNull()
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

  // -- tool runs (bare runs at the top level, no surrounding answer) --
  it('renders a bare multi-tool run inline', () => {
    renderParts([
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 't1', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 't2', state: 'output-available', output: {} }
    ] as unknown as CherryMessagePart[])

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByTestId('mock-tool-group-content').getAttribute('data-count')).toBe('2')
    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      't1',
      't2'
    ])
  })

  it('renders a lone tool call inline without a fold', () => {
    renderParts([
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'only-tool', state: 'output-available', output: {} }
    ] as unknown as CherryMessagePart[])

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByTestId('mock-message-tools').getAttribute('data-tool-name')).toBe('only-tool')
  })

  it('renders grouped tool parts inline when tool history collapse is disabled', () => {
    renderParts(
      [
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 't1', state: 'output-available', output: {} },
        { type: 'dynamic-tool', toolCallId: 'b', toolName: 't2', state: 'output-available', output: {} }
      ] as unknown as CherryMessagePart[],
      undefined,
      {},
      { ...defaultMessageRenderConfig, collapseCompletedToolHistory: false }
    )

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByTestId('mock-tool-group')).toBeNull()
    expect(screen.getByTestId('mock-tool-group-content').getAttribute('data-count')).toBe('2')
    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      't1',
      't2'
    ])
  })

  it('renders a bare multi-tool run without persisted toolCallId inline', () => {
    renderParts([
      { type: 'dynamic-tool', toolName: 'TodoWrite', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolName: 'WebSearch', state: 'output-available', output: {} }
    ] as unknown as CherryMessagePart[])

    expect(screen.getByTestId('mock-tool-group-content').getAttribute('data-count')).toBe('2')
    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      'TodoWrite',
      'WebSearch'
    ])
  })

  it('counts only renderable tools in a bare tool run (hidden tools excluded)', () => {
    renderParts([
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'visible-tool', state: 'output-available', output: {} },
      {
        type: 'dynamic-tool',
        toolCallId: 'hidden-web-search',
        toolName: 'web_search',
        toolType: 'provider',
        state: 'output-available',
        output: {}
      },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'another-visible-tool', state: 'output-available', output: {} }
    ] as unknown as CherryMessagePart[])

    expect(screen.getByTestId('mock-tool-group-content').getAttribute('data-count')).toBe('2')
    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      'visible-tool',
      'another-visible-tool'
    ])
  })

  it('renders report_artifacts at the end of the full message instead of inline', () => {
    const openArtifactFile = vi.fn()
    const openPath = vi.fn()
    const { container } = renderParts(
      [
        { type: 'text', text: 'before tool' },
        {
          type: 'dynamic-tool',
          toolCallId: 'report',
          toolName: 'report_artifacts',
          state: 'output-available',
          input: {
            summary: 'Created final outputs',
            artifacts: [{ path: 'dist/report.md', description: 'Report' }]
          },
          output: {}
        },
        { type: 'text', text: 'final answer' }
      ] as unknown as CherryMessagePart[],
      undefined,
      { openArtifactFile, openPath }
    )

    expect(screen.queryByTestId('mock-message-tools')).toBeNull()
    expect(screen.getByRole('button', { name: 'Preview report.md' })).toBeInTheDocument()
    expect(screen.getByText('report.md')).toBeInTheDocument()

    const text = container.textContent ?? ''
    expect(text.indexOf('final answer')).toBeGreaterThan(-1)
    expect(text.indexOf('report.md')).toBeGreaterThan(text.indexOf('final answer'))

    fireEvent.click(screen.getByRole('button', { name: 'Preview report.md' }))
    expect(openArtifactFile).toHaveBeenCalledWith('dist/report.md')

    fireEvent.click(screen.getByRole('button', { name: 'Open File report.md' }))
    expect(openPath).toHaveBeenCalledWith('dist/report.md')
  })

  it('wraps a multi-step process behind one outer fold (labelled with the total count) once the final answer exists', () => {
    renderParts([
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'output-available', output: {} },
      { type: 'text', text: 'rewriting renderer' },
      { type: 'dynamic-tool', toolCallId: 'c', toolName: 'edit', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolCallId: 'd', toolName: 'bash', state: 'output-available', output: {} },
      { type: 'text', text: 'final answer' }
    ] as unknown as CherryMessagePart[])

    // Only the outer fold (total tool count) + the final answer show at the top level.
    const outerButton = screen.getByRole('button', { name: '4 tool calls' })
    expect(outerButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByTestId('tool-history-divider')).toHaveLength(1)
    expect(screen.getByTestId('tool-history-divider')).toHaveClass('w-full')
    expect(screen.getByTestId('tool-history-divider').parentElement).toHaveClass('w-full')
    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.getByTestId('mock-markdown').textContent).toBe('final answer')
    expect(screen.queryByText('checking project files')).toBeNull()
    expect(screen.queryByText('rewriting renderer')).toBeNull()
    expect(screen.queryByRole('button', { name: '2 tool calls' })).toBeNull()

    fireEvent.click(outerButton)

    // Expanding reveals the narration text and tool cards directly, in order.
    expect(screen.getAllByTestId('tool-history-divider')).toHaveLength(1)
    expect(screen.getAllByTestId('mock-markdown').map((node) => node.textContent)).toEqual([
      'checking project files',
      'rewriting renderer',
      'final answer'
    ])
    expect(screen.queryByRole('button', { name: '2 tool calls' })).toBeNull()
    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      'list',
      'read',
      'edit',
      'bash'
    ])
    expect(screen.queryByRole('button', { name: '收起' })).toBeNull()
  })

  it('shows a bottom 收起 divider after expanding more than ten tool calls', () => {
    const toolParts = Array.from({ length: 11 }, (_, index) => ({
      type: 'dynamic-tool',
      toolCallId: `tool-${index}`,
      toolName: `tool-${index}`,
      state: 'output-available',
      output: {}
    }))

    renderParts([...toolParts, { type: 'text', text: 'final answer' }] as unknown as CherryMessagePart[])

    const foldButton = screen.getByRole('button', { name: '11 tool calls' })
    expect(foldButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '收起' })).toBeNull()
    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.queryByTestId('mock-message-tools')).toBeNull()

    fireEvent.click(foldButton)

    const collapseButton = screen.getByRole('button', { name: '收起' })
    expect(collapseButton).toBeInTheDocument()
    expect(collapseButton).toHaveClass('w-full')
    expect(collapseButton.querySelector('svg')).toBeNull()
    expect(collapseButton.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2)
    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.getAllByTestId('mock-message-tools')).toHaveLength(11)

    fireEvent.click(collapseButton)

    expect(foldButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '收起' })).toBeNull()
    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.queryByTestId('mock-message-tools')).toBeNull()
  })

  it('collapses an expanded outer fold once all tool calls are terminal', async () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    const pendingMessage = msg({ status: 'pending' })
    const unfinishedParts = [
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'input-available', input: {} }
    ] as unknown as CherryMessagePart[]
    const finishedBeforeAnswerParts = [
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} }
    ] as unknown as CherryMessagePart[]
    const finishedWithAnswerParts = [
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'text', text: 'final answer' }
    ] as unknown as CherryMessagePart[]
    const successMessage = msg({ status: 'success' })

    const { rerender } = renderParts(unfinishedParts, pendingMessage)

    const foldButton = screen.getByRole('button', { name: /1 tool calls/ })
    expect(foldButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('tool-history-preview')).toBeInTheDocument()

    fireEvent.click(foldButton)

    expect(foldButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('tool-history-content')).toBeInTheDocument()

    rerender(renderPartsTree(finishedBeforeAnswerParts, pendingMessage))

    expect(screen.getByRole('button', { name: /1 tool calls/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('tool-history-content')).toBeInTheDocument()

    rerender(renderPartsTree(finishedWithAnswerParts, pendingMessage))

    expect(screen.getByRole('button', { name: /1 tool calls/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('tool-history-content')).toBeInTheDocument()
    expect(screen.getByText('final answer')).toBeInTheDocument()

    mockIsActiveTurnTarget.mockReturnValue(false)
    rerender(renderPartsTree(finishedWithAnswerParts, successMessage))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '1 tool calls' })).toHaveAttribute('aria-expanded', 'false')
    })
    expect(screen.queryByTestId('tool-history-content')).toBeNull()
    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.getByTestId('mock-markdown')).toHaveTextContent('final answer')
  })

  it('keeps trailing text inside the preview before a later tool call arrives', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    const pendingMessage = msg({ status: 'pending' })
    const finishedBeforeNextToolParts = [
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'text', text: 'preparing next step' }
    ] as unknown as CherryMessagePart[]
    const nextToolParts = [
      ...finishedBeforeNextToolParts,
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'input-available', input: {} }
    ] as unknown as CherryMessagePart[]

    const { rerender } = renderParts(finishedBeforeNextToolParts, pendingMessage)

    const foldButton = screen.getByRole('button', { name: /1 tool calls/ })
    expect(foldButton).toHaveAttribute('aria-expanded', 'false')
    expect(foldButton).toHaveClass('w-full')
    const preview = screen.getByTestId('tool-history-preview')
    expect(preview).toHaveClass('h-[6.5rem]')
    expect(screen.getByTestId('tool-history-divider')).toHaveClass('w-full')
    expect(within(preview).getByText('checking project files')).toBeInTheDocument()
    expect(within(preview).getByText('preparing next step')).toBeInTheDocument()
    expect(screen.getAllByTestId('mock-markdown').every((node) => preview.contains(node))).toBe(true)

    rerender(renderPartsTree(nextToolParts, pendingMessage))

    expect(screen.getByRole('button', { name: /2 tool calls/ })).toHaveAttribute('aria-expanded', 'false')
    expect(within(screen.getByTestId('tool-history-preview')).getByText('preparing next step')).toBeInTheDocument()
    expect(within(screen.getByTestId('tool-history-preview')).getByText('checking project files')).toBeInTheDocument()
    expect(
      screen.getAllByTestId('mock-markdown').every((node) => screen.getByTestId('tool-history-preview').contains(node))
    ).toBe(true)
  })

  it('does not create a toolgroup for AskUserQuestion-only messages', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    renderParts(
      [
        {
          type: 'dynamic-tool',
          toolCallId: 'ask',
          toolName: 'AskUserQuestion',
          state: 'input-available',
          input: { questions: [{ header: '合并', question: '是否提交 Approve 审查并合并此 PR?', options: [] }] }
        }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    expect(screen.queryByRole('button', { name: /tool calls/ })).toBeNull()
    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.getByTestId('mock-message-tools')).toHaveAttribute('data-tool-name', 'AskUserQuestion')
  })

  it('keeps AskUserQuestion outside the folded toolgroup', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    renderParts(
      [
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'input-available', input: {} },
        {
          type: 'dynamic-tool',
          toolCallId: 'ask',
          toolName: 'AskUserQuestion',
          state: 'input-available',
          input: { questions: [{ header: '合并', question: '是否提交 Approve 审查并合并此 PR?', options: [] }] }
        }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    expect(screen.getByRole('button', { name: /1 tool calls/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /2 tool calls/ })).toBeNull()

    const preview = screen.getByTestId('tool-history-preview')
    expect(
      within(preview)
        .getAllByTestId('mock-message-tools')
        .map((node) => node.getAttribute('data-tool-name'))
    ).toEqual(['list'])
    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      'list',
      'AskUserQuestion'
    ])
  })

  it('moves the final answer below the collapsed toolgroup after the active turn completes', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    renderParts(
      [
        { type: 'text', text: 'checking project files' },
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
        { type: 'text', text: 'final answer' }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'success' })
    )

    const foldButton = screen.getByRole('button', { name: '1 tool calls' })
    expect(foldButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.getByTestId('mock-markdown')).toHaveTextContent('final answer')
  })

  it('uses the upstream terminal topic state to stop holding trailing text in the preview', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)
    mockTopicStreamState.status = 'done'
    mockTopicStreamState.isPending = false

    renderParts(
      [
        { type: 'text', text: 'checking project files' },
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
        { type: 'text', text: 'final answer' }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.getByTestId('mock-markdown')).toHaveTextContent('final answer')
  })

  it('reveals per-run tool cards directly when the outer fold expands', () => {
    renderParts([
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'output-available', output: {} },
      { type: 'text', text: 'rewriting renderer' },
      { type: 'dynamic-tool', toolCallId: 'c', toolName: 'edit', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolCallId: 'd', toolName: 'bash', state: 'output-available', output: {} },
      { type: 'text', text: 'final answer' }
    ] as unknown as CherryMessagePart[])

    fireEvent.click(screen.getByRole('button', { name: '4 tool calls' }))

    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      'list',
      'read',
      'edit',
      'bash'
    ])
  })

  it('releases trailing text outside the preview after two seconds without another tool call', async () => {
    vi.useFakeTimers()
    mockIsActiveTurnTarget.mockReturnValue(true)
    renderParts(
      [
        { type: 'text', text: 'checking project files' },
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
        { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'output-available', output: {} },
        { type: 'text', text: 'rewriting renderer' }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    const foldButton = screen.getByRole('button', { name: /2 tool calls/ })
    expect(foldButton).toHaveAttribute('aria-expanded', 'false')
    const preview = screen.getByTestId('tool-history-preview')
    expect(preview).toBeInTheDocument()
    expect(within(preview).getByText('rewriting renderer')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(within(screen.getByTestId('tool-history-preview')).queryByText('rewriting renderer')).toBeNull()
    expect(screen.getByText('rewriting renderer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /2 tool calls/ }))

    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.getByText('checking project files')).toBeInTheDocument()
    expect(screen.getByText('rewriting renderer')).toBeInTheDocument()
  })

  it('moves released trailing text back into the preview when another tool call arrives', async () => {
    vi.useFakeTimers()
    mockIsActiveTurnTarget.mockReturnValue(true)

    const pendingMessage = msg({ status: 'pending' })
    const beforeNextToolParts = [
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'text', text: 'preparing next step' }
    ] as unknown as CherryMessagePart[]
    const nextToolParts = [
      ...beforeNextToolParts,
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'input-available', input: {} }
    ] as unknown as CherryMessagePart[]

    const { rerender } = renderParts(beforeNextToolParts, pendingMessage)

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    rerender(renderPartsTree(beforeNextToolParts, pendingMessage))

    expect(within(screen.getByTestId('tool-history-preview')).queryByText('preparing next step')).toBeNull()
    expect(screen.getByText('preparing next step')).toBeInTheDocument()

    rerender(renderPartsTree(nextToolParts, pendingMessage))

    const preview = screen.getByTestId('tool-history-preview')
    expect(within(preview).getByText('preparing next step')).toBeInTheDocument()
    expect(screen.getAllByTestId('mock-markdown').every((node) => preview.contains(node))).toBe(true)
    expect(
      within(preview)
        .getAllByTestId('mock-message-tools')
        .map((node) => node.getAttribute('data-tool-name'))
    ).toEqual(['list', 'read'])
  })

  it('moves released trailing text and reasoning back into the preview when another tool call arrives', async () => {
    vi.useFakeTimers()
    mockIsActiveTurnTarget.mockReturnValue(true)

    const pendingMessage = msg({ status: 'pending' })
    const beforeNextToolParts = [
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'text', text: 'preparing next step' },
      { type: 'reasoning', text: 'thinking about the next read', state: 'streaming' }
    ] as unknown as CherryMessagePart[]
    const nextToolParts = [
      ...beforeNextToolParts,
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'input-available', input: {} }
    ] as unknown as CherryMessagePart[]

    const { rerender } = renderParts(beforeNextToolParts, pendingMessage)

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    rerender(renderPartsTree(beforeNextToolParts, pendingMessage))

    expect(within(screen.getByTestId('tool-history-preview')).queryByText('preparing next step')).toBeNull()
    expect(within(screen.getByTestId('tool-history-preview')).queryByText('thinking about the next read')).toBeNull()
    expect(screen.getByText('preparing next step')).toBeInTheDocument()
    expect(screen.getByText('thinking about the next read')).toBeInTheDocument()

    rerender(renderPartsTree(nextToolParts, pendingMessage))

    const preview = screen.getByTestId('tool-history-preview')
    expect(within(preview).getByText('preparing next step')).toBeInTheDocument()
    expect(within(preview).getByText('thinking about the next read')).toBeInTheDocument()
    expect(screen.getAllByTestId('mock-markdown').every((node) => preview.contains(node))).toBe(true)
    expect(screen.getAllByTestId('mock-thinking-block').every((node) => preview.contains(node))).toBe(true)
    expect(
      within(preview)
        .getAllByTestId('mock-message-tools')
        .map((node) => node.getAttribute('data-tool-name'))
    ).toEqual(['list', 'read'])
  })

  it('does not reset the trailing text release timer for updates to the same text part', async () => {
    vi.useFakeTimers()
    mockIsActiveTurnTarget.mockReturnValue(true)

    const pendingMessage = msg({ status: 'pending' })
    const initialParts = [
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'text', text: 'preparing' }
    ] as unknown as CherryMessagePart[]
    const updatedParts = [
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'text', text: 'preparing next step' }
    ] as unknown as CherryMessagePart[]

    const { rerender } = renderParts(initialParts, pendingMessage)

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    rerender(renderPartsTree(updatedParts, pendingMessage))

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    rerender(renderPartsTree(updatedParts, pendingMessage))

    expect(within(screen.getByTestId('tool-history-preview')).queryByText('preparing next step')).toBeNull()
    expect(screen.getByText('preparing next step')).toBeInTheDocument()
  })

  it('renders bare tool runs inline when there is no final answer', () => {
    renderParts([
      { type: 'text', text: 'first narration' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'output-available', output: {} },
      { type: 'text', text: 'second narration' },
      { type: 'dynamic-tool', toolCallId: 'c', toolName: 'edit', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolCallId: 'd', toolName: 'bash', state: 'output-available', output: {} }
    ] as unknown as CherryMessagePart[])

    // No final answer → no outer history fold; each run renders inline and
    // narration shows directly between them.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getAllByTestId('mock-tool-group-content').map((node) => node.getAttribute('data-count'))).toEqual([
      '2',
      '2'
    ])
    expect(screen.getAllByTestId('mock-markdown').map((node) => node.textContent)).toEqual([
      'first narration',
      'second narration'
    ])
  })

  it('folds a single tool run + answer behind the fold; expanding shows the tools directly', () => {
    renderParts([
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'output-available', output: {} },
      { type: 'text', text: 'final answer' }
    ] as unknown as CherryMessagePart[])

    const foldButton = screen.getByRole('button', { name: '2 tool calls' })
    expect(screen.getByTestId('mock-markdown').textContent).toBe('final answer')

    fireEvent.click(foldButton)

    // A single run shows its tools flat — not wrapped in another identical fold.
    expect(screen.getAllByRole('button', { name: '2 tool calls' })).toHaveLength(1)
    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      'list',
      'read'
    ])
  })

  it('filters completed reasoning from expanded multi-tool runs', () => {
    renderParts([
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'reasoning', text: 'deep thought between tools', state: 'done' },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'output-available', output: {} },
      { type: 'text', text: 'final answer' }
    ] as unknown as CherryMessagePart[])

    const foldButton = screen.getByRole('button', { name: '2 tool calls' })
    expect(screen.getByTestId('mock-markdown').textContent).toContain('final answer')
    expect(screen.queryByTestId('mock-thinking-block')).toBeNull()

    fireEvent.click(foldButton)

    expect(screen.queryByTestId('mock-thinking-block')).toBeNull()
    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      'list',
      'read'
    ])
  })

  it('folds single-tool steps and narration into the outer fold once an answer exists', () => {
    renderParts([
      { type: 'text', text: 'checking project files' },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'text', text: 'reading package metadata' },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'output-available', output: {} },
      { type: 'text', text: 'final answer' }
    ] as unknown as CherryMessagePart[])

    const foldButton = screen.getByRole('button', { name: '2 tool calls' })
    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.getByTestId('mock-markdown').textContent).toBe('final answer')
    expect(screen.queryByText('checking project files')).toBeNull()
    expect(screen.queryByText('reading package metadata')).toBeNull()

    fireEvent.click(foldButton)

    // Each single-tool step shows its narration + tool inline (no inner per-run fold).
    expect(screen.getAllByTestId('mock-markdown').map((node) => node.textContent)).toEqual([
      'checking project files',
      'reading package metadata',
      'final answer'
    ])
    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      'list',
      'read'
    ])
  })

  it('filters completed trailing reasoning from a lone tool fold', () => {
    renderParts([
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
      { type: 'reasoning', text: 'final deep thought after tool', state: 'done' }
    ] as unknown as CherryMessagePart[])

    const foldButton = screen.getByRole('button', { name: '1 tool calls' })
    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.queryByTestId('mock-message-tools')).toBeNull()
    expect(screen.queryByTestId('mock-thinking-block')).toBeNull()

    fireEvent.click(foldButton)

    expect(screen.getByTestId('mock-message-tools').getAttribute('data-tool-name')).toBe('list')
    expect(screen.queryByTestId('mock-thinking-block')).toBeNull()
  })

  it('filters completed trailing reasoning from an agent + read fold', () => {
    renderParts([
      { type: 'dynamic-tool', toolCallId: 'agent-a', toolName: 'Agent', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolCallId: 'read-a', toolName: 'Read', state: 'output-available', output: {} },
      { type: 'reasoning', text: 'agent flow final thought', state: 'done' }
    ] as unknown as CherryMessagePart[])

    const foldButton = screen.getByRole('button', { name: '2 tool calls' })
    expect(foldButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.queryByTestId('mock-message-tools')).toBeNull()
    expect(screen.queryByTestId('mock-thinking-block')).toBeNull()

    fireEvent.click(foldButton)

    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      'Agent',
      'Read'
    ])
    expect(screen.queryByTestId('mock-thinking-block')).toBeNull()
  })

  it('folds a single completed reasoning block behind a completed reasoning header', () => {
    renderParts([{ type: 'reasoning', text: 'deep thought only', state: 'done' } as unknown as CherryMessagePart])

    const foldButton = screen.getByRole('button', { name: 'Reasoning content' })
    expect(foldButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('mock-thinking-block')).toBeNull()
    expect(screen.queryByTestId('tool-history-preview')).toBeNull()

    fireEvent.click(foldButton)

    expect(screen.getByTestId('mock-thinking-block')).toHaveTextContent('deep thought only')
  })

  it('folds a single leading reasoning block while keeping answer text below', () => {
    renderParts([
      { type: 'reasoning', text: 'deep thought before answer', state: 'done' },
      { type: 'text', text: 'final answer text' }
    ] as unknown as CherryMessagePart[])

    const foldButton = screen.getByRole('button', { name: 'Reasoning content' })
    expect(foldButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('mock-thinking-block')).toBeNull()
    expect(screen.getByTestId('mock-markdown')).toHaveTextContent('final answer text')

    fireEvent.click(foldButton)

    expect(screen.getByTestId('mock-thinking-block')).toHaveTextContent('deep thought before answer')
    expect(screen.getByTestId('mock-markdown')).toHaveTextContent('final answer text')
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

  it('passes message reasoning token estimates to reasoning blocks', () => {
    renderParts(
      [{ type: 'reasoning', text: 'live thought', state: 'streaming' } as unknown as CherryMessagePart],
      msg({ status: 'pending', stats: { thoughtsTokens: 1234 } })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reasoning content' }))

    expect(screen.getByTestId('mock-thinking-block')).toHaveAttribute('data-thoughts-tokens', '1234')
  })

  it('keeps reasoning blocks mounted when a pending message settles', () => {
    mockTopicStreamState.isPending = true

    const parts = [
      {
        type: 'reasoning',
        text: 'steady thought',
        state: 'done',
        providerMetadata: { cherry: { thinkingMs: 3100 } }
      },
      { type: 'text', text: 'answer still streaming' }
    ] as unknown as CherryMessagePart[]
    const pendingMessage = msg({ status: 'pending' })
    const { rerender } = renderParts(parts, pendingMessage)

    fireEvent.click(screen.getByRole('button', { name: 'Reasoning content' }))

    const initialNode = screen.getByTestId('mock-thinking-block')
    expect(initialNode).toHaveAttribute('data-thinking-ms', '3100')
    expect(mockThinkingBlockMounted).toHaveBeenCalledTimes(1)

    mockTopicStreamState.isPending = false
    rerender(
      <MessageListProvider
        value={{
          state: {
            topic: { id: pendingMessage.topicId, name: 'Topic' } as MessageListProviderValue['state']['topic'],
            messages: [msg({ status: 'success' })],
            partsByMessageId: { [pendingMessage.id]: parts },
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
        }}>
        <PartsProvider value={{ [pendingMessage.id]: parts }}>
          <MessagePartsRenderer message={msg({ status: 'success' })} />
        </PartsProvider>
      </MessageListProvider>
    )

    expect(screen.getByTestId('mock-thinking-block')).toBe(initialNode)
    expect(screen.getByTestId('mock-thinking-block')).toHaveAttribute('data-thinking-ms', '3100')
    expect(mockThinkingBlockMounted).toHaveBeenCalledTimes(1)
  })

  it('does not render an empty wrapper for tool responses hidden by the tool renderer', () => {
    const { container } = renderParts([
      { type: 'reasoning', text: 'first thought', state: 'done' },
      {
        type: 'dynamic-tool',
        toolCallId: 'hidden-web-search',
        toolName: 'web_search',
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

  it('shows the summary header while the collapsed preview is visible', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    renderParts(
      [
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'input-available', input: {} },
        { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'output-available', output: {} }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    const foldButton = screen.getByRole('button', { name: '2 tool calls · 1 second' })
    expect(foldButton).toHaveAttribute('aria-expanded', 'false')
    expect(foldButton.querySelector('[data-live="true"]')).toBeInTheDocument()
    expect(foldButton.querySelector('[data-prefer-summary="true"]')).toBeInTheDocument()
    expect(foldButton.querySelector('[data-show-latest="false"]')).toBeInTheDocument()
    expect(foldButton.querySelector('svg')).toBeNull()
    expect(screen.queryByTestId('mock-placeholder')).toBeNull()
    expect(
      within(screen.getByTestId('tool-history-preview'))
        .getAllByTestId('mock-message-tools')
        .map((node) => node.getAttribute('data-tool-name'))
    ).toEqual(['list', 'read'])

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    const updatedFoldButton = screen.getByRole('button', { name: 'read · 1 second' })
    expect(updatedFoldButton.querySelector('[data-prefer-summary="true"]')).toBeNull()
    expect(updatedFoldButton.querySelector('[data-show-latest="true"]')).toBeInTheDocument()
  })

  it('renders active tool runs directly inside the expanded fold while streaming', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    renderParts(
      [
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
        { type: 'dynamic-tool', toolCallId: 'b', toolName: 'read', state: 'output-available', output: {} },
        { type: 'text', text: 'now editing' },
        { type: 'dynamic-tool', toolCallId: 'c', toolName: 'edit', state: 'output-available', output: {} },
        { type: 'dynamic-tool', toolCallId: 'd', toolName: 'bash', state: 'input-available', input: {} }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    const foldButton = screen.getByRole('button', { name: '4 tool calls · 1 second' })
    expect(foldButton).toHaveAttribute('aria-expanded', 'false')
    expect(foldButton.querySelector('[data-live="true"]')).toBeInTheDocument()
    expect(foldButton.querySelector('[data-prefer-summary="true"]')).toBeInTheDocument()
    expect(foldButton.querySelector('[data-show-latest="false"]')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-placeholder')).toBeNull()

    expect(screen.queryByRole('button', { name: '2 tool calls' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Working…' })).toBeNull()
    expect(within(screen.getByTestId('tool-history-preview')).getByText('now editing')).toBeInTheDocument()

    fireEvent.click(foldButton)

    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.getByText('now editing')).toBeInTheDocument()
    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      'list',
      'read',
      'edit',
      'bash'
    ])
  })

  it('renders only the latest ten entries in the collapsed preview', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    renderParts(
      [
        ...Array.from({ length: 11 }, (_, index) => ({ type: 'text', text: `step ${index + 1}` })),
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'edit', state: 'input-available', input: {} }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    const preview = screen.getByTestId('tool-history-preview')
    expect(within(preview).queryByText('step 1')).toBeNull()
    expect(within(preview).queryByText('step 2')).toBeNull()
    expect(within(preview).getByText('step 3')).toBeInTheDocument()
    expect(within(preview).getByText('step 11')).toBeInTheDocument()
    expect(
      within(preview)
        .getAllByTestId('mock-message-tools')
        .map((node) => node.getAttribute('data-tool-name'))
    ).toEqual(['edit'])

    fireEvent.click(screen.getByRole('button', { name: /1 tool calls/ }))

    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.getByText('step 1')).toBeInTheDocument()
    expect(screen.getByText('step 11')).toBeInTheDocument()
    expect(screen.getAllByTestId('mock-message-tools').map((node) => node.getAttribute('data-tool-name'))).toEqual([
      'edit'
    ])
  })

  it('hides the generating placeholder when a pending agent message already has tool calls', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    renderParts(
      [
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
        { type: 'text', text: 'final answer so far' }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    const foldButton = screen.getByRole('button', { name: '1 tool calls' })
    expect(foldButton.querySelector('[data-live="true"]')).toBeNull()
    expect(screen.queryByTestId('mock-placeholder')).toBeNull()
    expect(screen.getByTestId('mock-markdown')).toHaveTextContent('final answer so far')
  })

  it('expands the tool history and shows the final answer below while the message is pending', () => {
    renderParts(
      [
        { type: 'text', text: 'checking project files' },
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
        { type: 'text', text: 'final answer' }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    const foldButton = screen.getByRole('button', { name: '1 tool calls' })
    expect(foldButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByTestId('tool-history-divider')).toHaveLength(1)
    expect(screen.getAllByTestId('mock-markdown').at(-1)?.textContent).toBe('final answer')
    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.queryByText('checking project files')).toBeNull()
    expect(screen.queryByTestId('mock-placeholder')).toBeNull()
  })

  it('shows a thinking hint in the live fold header while reasoning streams after a tool', () => {
    mockIsActiveTurnTarget.mockReturnValue(true)

    renderParts(
      [
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'list', state: 'output-available', output: {} },
        { type: 'reasoning', text: 'thinking after tool', state: 'streaming' }
      ] as unknown as CherryMessagePart[],
      msg({ status: 'pending' })
    )

    const foldButton = screen.getByRole('button', { name: '1 tool calls · 1 second' })
    expect(foldButton).toHaveAttribute('aria-expanded', 'false')
    expect(foldButton.querySelector('[data-live="true"]')).toBeInTheDocument()
    expect(foldButton.querySelector('[data-prefer-summary="true"]')).toBeInTheDocument()
    expect(foldButton.querySelector('[data-show-latest="false"]')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-placeholder')).toBeNull()
    expect(within(screen.getByTestId('tool-history-preview')).getByText('thinking after tool')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByTestId('tool-history-preview')).toBeNull()
    expect(screen.getByRole('button', { name: 'Thinking... · 1 second' })).toBeInTheDocument()
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

  it('returns nothing for hidden agent task event data', () => {
    const { container } = renderParts([
      {
        type: 'data-agent-task-event',
        data: { event: 'started', taskId: 'task-1', title: 'Inspect task state' }
      } as unknown as CherryMessagePart
    ])

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

    const token = document.querySelector('[data-composer-token-kind="knowledge"]')
    expect(token).toBeInTheDocument()
    expect(token).toHaveTextContent('Docs')
  })
})
