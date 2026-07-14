import type { CherryMessagePart } from '@shared/data/types/message'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageListProvider } from '../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem, type MessageListProviderValue } from '../../types'
import { PartsProvider } from '../MessagePartsContext'

const mockIsActiveTurnTarget = vi.hoisted(() => vi.fn(() => false))
const mockTopicStreamState = vi.hoisted(() => ({ status: undefined as string | undefined }))
const mockThinkingBlockMounted = vi.hoisted(() => vi.fn())
const mockMainTextRender = vi.hoisted(() => vi.fn())

type MainTextBlockModule = {
  buildUserMessagePreview: (content: string) => { content: string; isTruncated: boolean }
  default: React.ComponentType<any>
}

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('@data/hooks/usePreference', () => ({ usePreference: vi.fn(() => [false, vi.fn()]) }))
vi.mock('@renderer/hooks/useIsActiveTurnTarget', () => ({
  useIsActiveTurnTarget: () => mockIsActiveTurnTarget()
}))
vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({
    status: mockTopicStreamState.status,
    activeExecutions: [],
    awaitingApprovalAnchors: [],
    isPending: mockTopicStreamState.status === 'pending' || mockTopicStreamState.status === 'streaming',
    isFulfilled: false,
    markSeen: vi.fn()
  })
}))
vi.mock('@renderer/types/file', () => ({
  COMPOSER_FILE_KIND: { PASTED_TEXT: 'pasted-text' },
  FILE_TYPE: { IMAGE: 'image', VIDEO: 'video', AUDIO: 'audio', TEXT: 'text', DOCUMENT: 'document', OTHER: 'other' }
}))

vi.mock('motion/react', () => {
  const Div = ({ ref, children, ...props }: any) => (
    <div ref={ref} {...props}>
      {children}
    </div>
  )
  const proxy = new Proxy(
    { div: Div, create: (Component: any) => Component },
    { get: (target, key) => (target as any)[key] ?? Div }
  )
  return { AnimatePresence: ({ children }: any) => <>{children}</>, motion: proxy }
})

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: any) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, number>) => {
      if (key === 'message.tools.groupHeader') return `${params?.count} tool calls`
      if (key === 'message.processing') return 'Processing'
      if (key === 'message.tools.processed') return 'Processed'
      if (key === 'message.tools.error') return 'Error'
      if (key === 'message.tools.thinkingHeader') return 'Thinking...'
      if (key === 'common.preview') return 'Preview'
      if (key === 'common.close') return 'Close'
      if (key === 'common.expand') return 'Expand'
      if (key === 'common.collapse') return 'Collapse'
      if (key === 'common.reasoning_content') return 'Reasoning content'
      if (key === 'message.tools.collapse') return '收起'
      if (key === 'chat.input.tools.open_file') return 'Open File'
      if (key === 'chat.input.tools.open_file_error') return 'Failed to open file'
      return key
    }
  })
}))

vi.mock('@iconify/react', () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />
}))

vi.mock('@renderer/components/chat/messages/markdown/ChatMarkdown', () => ({
  __esModule: true,
  default: ({ block, postProcess }: any) => (
    <div data-testid="mock-markdown">{postProcess ? postProcess(block.content) : block.content}</div>
  ),
  MarkdownBlockContext: React.createContext(null)
}))

vi.mock('../MainTextBlock', async (importOriginal) => {
  const actual = await importOriginal<MainTextBlockModule>()
  const ActualMainTextBlock = actual.default

  return {
    ...actual,
    default: function MainTextBlockMock(props: any) {
      mockMainTextRender(props)
      return <ActualMainTextBlock {...props} />
    }
  }
})

vi.mock('../ImageBlock', () => ({
  __esModule: true,
  default: ({ images, isSingle }: any) => (
    <div data-testid="mock-image-block" data-images={JSON.stringify(images)} data-single={String(isSingle)} />
  )
}))

vi.mock('../../tools/MessageTools', () => {
  const canRender = (toolResponse: any) => {
    const name = toolResponse?.tool?.name ?? ''
    return (
      name !== 'report_artifacts' &&
      !name.endsWith('__report_artifacts') &&
      !(toolResponse?.tool?.type === 'provider' && name === 'web_search')
    )
  }

  return {
    __esModule: true,
    canRenderMessageTool: canRender,
    default: ({ toolResponse }: any) =>
      canRender(toolResponse) &&
      !(toolResponse?.tool?.name === 'AskUserQuestion' && toolResponse?.status === 'pending') ? (
        <div
          data-testid="mock-message-tools"
          data-status={toolResponse?.status}
          data-tool-type={toolResponse?.tool?.type}
          data-tool-name={toolResponse?.tool?.name}
          data-server-name={toolResponse?.tool?.serverName ?? ''}
        />
      ) : null
  }
})

vi.mock('../../tools/toolResponse', () => ({
  buildToolResponseFromPart: (part: any, fallbackId?: string) => {
    const type = part.type as string
    if (!type.startsWith('tool-') && type !== 'dynamic-tool') return null
    const id = part.toolCallId ?? fallbackId
    if (!id) return null
    const name = part.toolName || type.replace(/^tool-/, '') || 'unknown'
    const output = part.output
    const metadata = output && typeof output === 'object' && output.metadata ? output.metadata : undefined
    const isMcp = metadata?.type === 'mcp' || type === 'dynamic-tool'
    const status =
      part.state === 'output-available'
        ? 'done'
        : part.state === 'output-error'
          ? 'error'
          : part.state === 'input-streaming'
            ? 'streaming'
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
        ...(isMcp ? { serverId: metadata?.serverId ?? 'unknown', serverName: metadata?.serverName ?? 'MCP' } : {})
      },
      arguments: part.input,
      partialArguments:
        (status === 'streaming' || status === 'invoking') && typeof part.input === 'string' ? part.input : undefined,
      status,
      response: part.state === 'output-error' ? { isError: true } : (output?.content ?? output)
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
  ThinkingBlockContent: ({ content, isStreaming }: any) => (
    <div data-testid="mock-thinking-content" data-streaming={String(!!isStreaming)}>
      {content}
    </div>
  ),
  default: function ThinkingBlockMock({ content, isStreaming }: any) {
    React.useEffect(() => {
      mockThinkingBlockMounted()
    }, [])
    return (
      <div data-testid="mock-thinking-block" data-streaming={String(!!isStreaming)}>
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
  ToolBlockGroup: ({ children, isLiveProgress, items }: any) => {
    const [isExpanded, setIsExpanded] = React.useState(false)
    return (
      <div data-testid="child-tool-group" data-live-progress={String(isLiveProgress === true)}>
        <button
          type="button"
          data-testid="child-tool-group-trigger"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((expanded) => !expanded)}>
          {items?.at(-1)?.toolResponse?.tool?.name ?? `${items?.length ?? 0} tool calls`}
        </button>
        {isExpanded &&
          (children ?? (
            <div data-testid="mock-tool-group-content" data-count={items?.length ?? 0}>
              {items?.map((item: any) => (
                <div
                  key={item.id}
                  data-testid="mock-message-tools"
                  data-status={item.toolResponse?.status}
                  data-tool-name={item.toolResponse?.tool?.name}
                />
              ))}
            </div>
          ))}
      </div>
    )
  },
  ToolBlockGroupContent: ({ items }: any) => (
    <div data-testid="mock-tool-group-content" data-count={items?.length ?? 0}>
      {items?.map((item: any) => (
        <div
          key={item.id}
          data-testid="mock-message-tools"
          data-status={item.toolResponse?.status}
          data-tool-name={item.toolResponse?.tool?.name}
        />
      ))}
    </div>
  ),
  ToolBlockGroupHeaderContent: ({
    activityLabel,
    elapsedText,
    summary,
    items,
    preferSummary,
    showLatestWhenComplete
  }: any) => (
    <span data-testid="mock-tool-group-header" data-header-status={items?.at(-1)?.toolResponse?.status}>
      {preferSummary
        ? (summary ?? `${items?.length ?? 0} tool calls`)
        : (activityLabel ??
          (showLatestWhenComplete ? items?.at(-1)?.toolResponse?.tool?.name : undefined) ??
          summary ??
          `${items?.length ?? 0} tool calls`)}
      {elapsedText && (
        <>
          <span aria-hidden="true"> · </span>
          <span>{elapsedText}</span>
        </>
      )}
    </span>
  )
}))

vi.mock('../CompactBlock', () => ({
  __esModule: true,
  default: ({ content, compactedContent }: any) => (
    <div data-testid="mock-compact-block">
      {content}|{compactedContent}
    </div>
  )
}))

vi.mock('../TranslationBlock', () => ({
  __esModule: true,
  default: ({ content, isStreaming }: any) => (
    <div data-testid="mock-translation-block" data-streaming={String(!!isStreaming)}>
      {content}
    </div>
  )
}))

vi.mock('../BlockErrorFallback', () => ({ __esModule: true, default: () => null }))
vi.mock('../PlaceholderBlock', () => ({
  __esModule: true,
  default: ({ createdAt, status }: any) => (
    <div data-testid="mock-placeholder" data-created-at={createdAt} data-status={status} />
  ),
  formatPlaceholderElapsed: () => '1 second',
  usePlaceholderElapsedMs: () => 1000
}))

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
  message: MessageListItem = msg(),
  actions: MessageListProviderValue['actions'] = {},
  renderConfig: MessageListProviderValue['state']['renderConfig'] = defaultMessageRenderConfig
) => {
  const value: MessageListProviderValue = {
    state: {
      topic: { id: message.topicId, name: 'Topic' } as MessageListProviderValue['state']['topic'],
      messages: [message],
      partsByMessageId: { [message.id]: parts },
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
      <PartsProvider value={{ [message.id]: parts }}>
        <MessagePartsRenderer message={message} />
      </PartsProvider>
    </MessageListProvider>
  )
}

const renderParts = (
  parts: CherryMessagePart[],
  message: MessageListItem = msg(),
  actions: MessageListProviderValue['actions'] = {},
  renderConfig: MessageListProviderValue['state']['renderConfig'] = defaultMessageRenderConfig
) => render(renderPartsTree(parts, message, actions, renderConfig))

function activateTurn(status?: string): void {
  mockIsActiveTurnTarget.mockReturnValue(true)
  mockTopicStreamState.status = status
}

function expandCollapsedLiveToolGroups(): void {
  for (const group of screen.getAllByTestId('live-tool-group')) {
    const trigger = group.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
    if (trigger) fireEvent.click(trigger)
  }
  expandCollapsedChildToolGroups()
}

function expandCollapsedChildToolGroups(): void {
  for (const trigger of screen.queryAllByTestId('child-tool-group-trigger')) {
    if (trigger.getAttribute('aria-expanded') === 'false') fireEvent.click(trigger)
  }
}

function latestMainTextProps(partIndex: number): any {
  const partId = `msg-1-part-${partIndex}`
  return [...mockMainTextRender.mock.calls].reverse().find(([props]) => props.id === partId)?.[0]
}

function toolPart(toolCallId: string, state = 'output-available', toolName = toolCallId) {
  return {
    type: 'dynamic-tool',
    toolCallId,
    toolName,
    state,
    input: { path: `${toolCallId}.txt` },
    output: state === 'output-available' ? {} : undefined
  }
}

describe('MessagePartsRenderer', () => {
  beforeEach(() => {
    mockIsActiveTurnTarget.mockReturnValue(false)
    mockTopicStreamState.status = undefined
    mockThinkingBlockMounted.mockClear()
    mockMainTextRender.mockClear()
  })

  describe('leaf rendering', () => {
    it('renders nothing for empty completed messages and a placeholder for active empty messages', () => {
      const completed = renderParts([])
      expect(completed.container.innerHTML).toBe('')
      completed.unmount()

      activateTurn()
      renderParts([], msg({ status: 'pending' }))
      expect(screen.getByTestId('mock-placeholder')).toHaveAttribute('data-status', 'preparing')
      expect(screen.getByTestId('mock-placeholder')).toHaveAttribute('data-created-at', '2026-01-01T00:00:00Z')
    })

    it('uses activity-specific placeholders for empty streaming content without creating process boundaries', () => {
      activateTurn('streaming')
      const reasoning = renderParts(
        [{ type: 'reasoning', text: '', state: 'streaming' }] as unknown as CherryMessagePart[],
        msg({ status: 'pending' })
      )
      expect(screen.getByTestId('mock-placeholder')).toHaveAttribute('data-status', 'thinking')
      expect(document.querySelector('[data-live-process-run]')).toBeNull()
      reasoning.unmount()

      renderParts(
        [{ type: 'text', text: '', state: 'streaming' }] as unknown as CherryMessagePart[],
        msg({ status: 'pending' })
      )
      expect(screen.getByTestId('mock-placeholder')).toHaveAttribute('data-status', 'generating')
      expect(document.querySelector('[data-live-process-run]')).toBeNull()
    })

    it('renders text and data-code through markdown', () => {
      renderParts([
        { type: 'text', text: 'hello world' },
        { type: 'data-code', data: { content: 'console.log(1)', language: 'js' } }
      ] as unknown as CherryMessagePart[])

      const markdown = screen.getAllByTestId('mock-markdown').map((node) => node.textContent)
      expect(markdown[0]).toContain('hello world')
      expect(markdown[1]).toContain('```js')
      expect(markdown[1]).toContain('console.log(1)')
    })

    it('renders single and grouped images while skipping image parts without a URL', () => {
      const single = renderParts([
        { type: 'file', url: 'https://img.test/single.png', mediaType: 'image/png' }
      ] as unknown as CherryMessagePart[])
      expect(screen.getByTestId('mock-image-block')).toHaveAttribute('data-single', 'true')
      single.unmount()

      renderParts([
        { type: 'file', url: 'https://img.test/a.png', mediaType: 'image/png' },
        { type: 'file', url: 'https://img.test/b.jpg', mediaType: 'image/jpeg' },
        { type: 'file', mediaType: 'image/png' }
      ] as unknown as CherryMessagePart[])

      const blocks = screen.getAllByTestId('mock-image-block')
      expect(blocks).toHaveLength(2)
      expect(blocks.every((block) => block.getAttribute('data-single') === 'false')).toBe(true)
      expect(blocks.map((block) => block.getAttribute('data-images'))).toEqual([
        '["https://img.test/a.png"]',
        '["https://img.test/b.jpg"]'
      ])
    })

    it('hides the duplicate user image when its composer file token is visible', () => {
      renderParts(
        [
          {
            type: 'text',
            text: 'Look ',
            providerMetadata: {
              cherry: {
                composer: {
                  version: 1,
                  tokens: [
                    {
                      id: 'file:source-image',
                      kind: 'file',
                      label: 'photo.png',
                      index: 0,
                      textOffset: 5
                    }
                  ]
                }
              }
            }
          } as unknown as CherryMessagePart,
          {
            type: 'file',
            url: 'file:///tmp/photo.png',
            mediaType: 'image/png',
            filename: 'photo.png'
          } as unknown as CherryMessagePart
        ],
        msg({ role: 'user' })
      )

      expect(document.querySelector('[data-composer-token-kind="file"]')).toBeInTheDocument()
      expect(screen.queryByTestId('mock-image-block')).toBeNull()
    })

    it('hides duplicate user images with the same filename by composer file token identity', () => {
      renderParts(
        [
          {
            type: 'text',
            text: 'Compare ',
            providerMetadata: {
              cherry: {
                composer: {
                  version: 1,
                  tokens: [
                    {
                      id: 'file:source-image-1',
                      kind: 'file',
                      label: 'photo.png',
                      index: 0,
                      textOffset: 8
                    },
                    {
                      id: 'file:source-image-2',
                      kind: 'file',
                      label: 'photo.png',
                      index: 1,
                      textOffset: 8
                    }
                  ]
                }
              }
            }
          } as unknown as CherryMessagePart,
          {
            type: 'file',
            url: 'file:///tmp/first/photo.png',
            mediaType: 'image/png',
            filename: 'photo.png',
            providerMetadata: { cherry: { fileTokenSourceId: 'source-image-1' } }
          } as unknown as CherryMessagePart,
          {
            type: 'file',
            url: 'file:///tmp/second/photo.png',
            mediaType: 'image/png',
            filename: 'photo.png',
            providerMetadata: { cherry: { fileTokenSourceId: 'source-image-2' } }
          } as unknown as CherryMessagePart
        ],
        msg({ role: 'user' })
      )

      expect(document.querySelectorAll('[data-composer-token-kind="file"]')).toHaveLength(2)
      expect(screen.queryByTestId('mock-image-block')).toBeNull()
    })

    it('keeps a user image when no composer file token is visible', () => {
      renderParts(
        [
          { type: 'text', text: 'Look at this' } as unknown as CherryMessagePart,
          {
            type: 'file',
            url: 'file:///tmp/photo.png',
            mediaType: 'image/png',
            filename: 'photo.png'
          } as unknown as CherryMessagePart
        ],
        msg({ role: 'user' })
      )

      expect(screen.getByTestId('mock-image-block')).toHaveAttribute('data-images', '["file:///tmp/photo.png"]')
    })

    it('renders non-image file attachments', () => {
      renderParts([
        { type: 'file', url: 'file:///doc.pdf', mediaType: 'application/pdf', filename: 'doc.pdf' }
      ] as unknown as CherryMessagePart[])

      expect(screen.queryByTestId('mock-image-block')).toBeNull()
      expect(screen.getByTestId('mock-attachments')).toHaveAttribute('data-file-name', 'doc.pdf')
    })

    it('hides a duplicate attachment when its composer file token is visible', () => {
      renderParts(
        [
          {
            type: 'text',
            text: 'Open ',
            providerMetadata: {
              cherry: {
                composer: {
                  version: 1,
                  tokens: [{ id: 'file:doc.pdf', kind: 'file', label: 'doc.pdf', index: 0, textOffset: 5 }]
                }
              }
            }
          },
          { type: 'file', url: 'file:///doc.pdf', mediaType: 'application/pdf', filename: 'doc.pdf' }
        ] as unknown as CherryMessagePart[],
        msg({ role: 'user' })
      )

      expect(document.querySelector('[data-composer-token-kind="file"]')).toHaveTextContent('doc.pdf')
      expect(screen.queryByTestId('mock-attachments')).toBeNull()
    })

    it('keeps an attachment when composer prompt metadata is stale', () => {
      renderParts(
        [
          {
            type: 'text',
            text: 'Open latest',
            providerMetadata: {
              cherry: {
                composer: {
                  version: 1,
                  tokens: [
                    {
                      id: 'file:doc.pdf',
                      kind: 'file',
                      label: 'doc.pdf',
                      index: 0,
                      textOffset: 5,
                      promptText: 'doc.pdf'
                    }
                  ]
                }
              }
            }
          },
          { type: 'file', url: 'file:///doc.pdf', mediaType: 'application/pdf', filename: 'doc.pdf' }
        ] as unknown as CherryMessagePart[],
        msg({ role: 'user' })
      )

      expect(document.querySelector('[data-composer-token-kind="file"]')).toBeNull()
      expect(screen.getByTestId('mock-attachments')).toHaveAttribute('data-file-name', 'doc.pdf')
    })

    it('passes citation references through the text renderer', () => {
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

      expect(screen.getByTestId('mock-markdown').textContent).toContain('data-citation')
      expect(screen.getByTestId('mock-markdown').textContent).toContain('https://ex.com')
    })

    it('renders video and error value parts', () => {
      renderParts([
        { type: 'data-video', data: { filePath: '/tmp/v.mp4' } },
        { type: 'data-video', data: { url: 'https://v.test/v.mp4' } },
        { type: 'data-error', data: { name: 'Err', message: 'boom' } }
      ] as unknown as CherryMessagePart[])

      const videos = screen.getAllByTestId('mock-message-video')
      expect(videos[0]).toHaveAttribute('data-file-path', '/tmp/v.mp4')
      expect(videos[1]).toHaveAttribute('data-url', 'https://v.test/v.mp4')
      expect(screen.getByTestId('mock-error-block')).toHaveAttribute('data-error-message', 'boom')
    })

    it('does not move non-consecutive updates for the same video ahead of intervening content', () => {
      const { container } = renderParts([
        { type: 'data-video', data: { filePath: '/tmp/same.mp4', url: 'https://v.test/first.mp4' } },
        { type: 'text', text: 'between videos' },
        { type: 'data-video', data: { filePath: '/tmp/same.mp4', url: 'https://v.test/second.mp4' } }
      ] as unknown as CherryMessagePart[])

      const html = container.innerHTML
      expect(screen.getAllByTestId('mock-message-video')).toHaveLength(2)
      expect(html.indexOf('first.mp4')).toBeLessThan(html.indexOf('between videos'))
      expect(html.indexOf('between videos')).toBeLessThan(html.indexOf('second.mp4'))
    })

    it('keeps parent agent-flow parts out of the top-level message', () => {
      renderParts([
        toolPart('parent', 'output-available', 'Agent'),
        {
          ...toolPart('child', 'output-available', 'Read'),
          callProviderMetadata: { 'claude-code': { parentToolCallId: 'parent' } }
        },
        {
          type: 'text',
          text: 'child text',
          providerMetadata: { 'claude-code': { parentToolCallId: 'parent' } }
        }
      ] as unknown as CherryMessagePart[])

      fireEvent.click(screen.getByTestId('completed-process-trigger'))
      expandCollapsedChildToolGroups()

      expect(screen.getAllByTestId('mock-message-tools')).toHaveLength(1)
      expect(screen.getByTestId('mock-message-tools')).toHaveAttribute('data-tool-name', 'Agent')
      expect(screen.queryByText('child text')).toBeNull()
    })

    it('renders report artifacts after the final message content and not as an inline tool', () => {
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
        msg(),
        { openArtifactFile, openPath }
      )

      expect(screen.queryByTestId('mock-message-tools')).toBeNull()
      expect(screen.getByText('report.md')).toBeInTheDocument()
      expect((container.textContent ?? '').indexOf('report.md')).toBeGreaterThan(
        (container.textContent ?? '').indexOf('final answer')
      )

      fireEvent.click(screen.getByRole('button', { name: 'Preview report.md' }))
      expect(openArtifactFile).toHaveBeenCalledWith('dist/report.md')
      fireEvent.click(screen.getByRole('button', { name: 'Open File report.md' }))
      expect(openPath).toHaveBeenCalledWith('dist/report.md')
    })
  })

  describe('active layout', () => {
    it('uses one top-level disclosure for separated process parts without swallowing answer text', () => {
      activateTurn()
      const pendingMessage = msg({ status: 'pending' })
      const initialParts = [
        toolPart('read'),
        { type: 'text', text: 'answer in progress' }
      ] as unknown as CherryMessagePart[]
      const { rerender } = renderParts(initialParts, pendingMessage)

      const answer = screen.getByText('answer in progress')
      expect(answer.closest('[data-live-process-run]')).toBeNull()
      expect(document.querySelector('[data-live-process-run]')).toBeNull()
      expect(screen.getByTestId('mock-tool-group-header')).toHaveTextContent('Processing')
      expect(screen.queryByTestId('mock-tool-group-content')).toBeNull()
      expandCollapsedLiveToolGroups()
      expect(screen.getByTestId('mock-tool-group-content')).toHaveAttribute('data-count', '1')

      const laterParts = [...initialParts, toolPart('edit', 'input-available')] as CherryMessagePart[]
      rerender(renderPartsTree(laterParts, pendingMessage))

      expect(document.querySelector('[data-live-process-run]')).toBeNull()
      expect(screen.getAllByTestId('live-tool-group')).toHaveLength(1)
      expect(screen.getByTestId('mock-tool-group-header')).toHaveTextContent('Processing')
      expandCollapsedLiveToolGroups()
      expect(screen.getAllByTestId('mock-tool-group-content')).toHaveLength(2)
      expect(screen.getByText('answer in progress')).toBeInTheDocument()
      expect(screen.getByText('answer in progress')).not.toBe(answer)
      expect(screen.queryByTestId('tool-history-divider')).toBeNull()
    })

    it('marks only the final open text tail as streaming and ignores hidden markers after it', () => {
      activateTurn('streaming')
      renderParts(
        [
          { type: 'text', text: 'sealed narration' },
          toolPart('read'),
          { type: 'text', text: 'open answer', state: 'streaming' },
          { type: 'source-url', url: 'https://example.com' },
          { type: 'data-citation', data: {} }
        ] as unknown as CherryMessagePart[],
        msg({ status: 'pending' })
      )

      expandCollapsedLiveToolGroups()
      expect(latestMainTextProps(0)?.isStreaming).toBe(false)
      expect(latestMainTextProps(2)?.isStreaming).toBe(true)
    })

    it('groups consecutive reasoning and tools while omitting hidden markers', () => {
      activateTurn('streaming')
      renderParts(
        [
          { type: 'reasoning', text: 'Inspecting', state: 'streaming' },
          { type: 'step-start' },
          toolPart('read', 'input-available', 'Read'),
          { type: 'source-url', url: 'https://example.com' },
          { type: 'reasoning', text: 'Checking result', state: 'done' }
        ] as unknown as CherryMessagePart[],
        msg({ status: 'pending' })
      )

      expect(document.querySelector('[data-live-process-run]')).toBeNull()
      expect(screen.getAllByTestId('live-tool-group')).toHaveLength(1)
      expect(screen.queryByTestId('mock-tool-group-content')).toBeNull()
      expandCollapsedLiveToolGroups()
      expect(screen.getByTestId('mock-tool-group-content')).toHaveAttribute('data-count', '1')
      const thinkingBlocks = screen.getAllByTestId('mock-thinking-block')
      expect(thinkingBlocks).toHaveLength(2)
      expect(thinkingBlocks[0]).toHaveAttribute('data-streaming', 'true')
      expect(thinkingBlocks[1]).toHaveAttribute('data-streaming', 'false')
      expect(screen.queryByTestId('mock-thinking-content')).toBeNull()
      expect(screen.queryByText('https://example.com')).toBeNull()
    })

    it('does not render provider ellipsis fillers or let them split live tools', () => {
      activateTurn('streaming')
      renderParts(
        [
          toolPart('read'),
          { type: 'text', text: '...' },
          toolPart('edit', 'input-available')
        ] as unknown as CherryMessagePart[],
        msg({ status: 'pending' })
      )

      expect(screen.queryByText('...')).toBeNull()
      expect(screen.getAllByTestId('live-tool-group')).toHaveLength(1)
      expandCollapsedLiveToolGroups()
      expect(screen.getByTestId('mock-tool-group-content')).toHaveAttribute('data-count', '2')
    })

    it('renders the latest running tool after an earlier tool failure', () => {
      activateTurn('streaming')
      renderParts(
        [toolPart('failed', 'output-error'), toolPart('cleanup', 'input-available')] as unknown as CherryMessagePart[],
        msg({ status: 'pending' })
      )

      expandCollapsedLiveToolGroups()
      const tools = screen.getAllByTestId('mock-message-tools')
      expect(tools).toHaveLength(2)
      expect(tools[0]).toHaveAttribute('data-status', 'error')
      expect(tools[1]).toHaveAttribute('data-status', 'invoking')
      expect(tools[1]).toHaveAttribute('data-tool-name', 'cleanup')
      expect(screen.getByTestId('mock-tool-group-header')).toHaveTextContent('Processing')
    })

    it('renders live reasoning after an earlier tool failure', () => {
      activateTurn('streaming')
      renderParts(
        [
          toolPart('failed', 'output-error'),
          { type: 'reasoning', text: 'Recovering', state: 'streaming' }
        ] as unknown as CherryMessagePart[],
        msg({ status: 'pending' })
      )

      expandCollapsedLiveToolGroups()
      expect(screen.getByTestId('mock-message-tools')).toHaveAttribute('data-status', 'error')
      expect(screen.getByTestId('mock-thinking-block')).toHaveTextContent('Recovering')
      expect(screen.getByTestId('mock-thinking-block')).toHaveAttribute('data-streaming', 'true')
      expect(screen.queryByTestId('mock-thinking-content')).toBeNull()
    })

    it('renders approval-gated tools while keeping interactive and side-channel tools as hard boundaries', () => {
      activateTurn()
      renderParts(
        [
          toolPart('one'),
          { type: 'text', text: 'status text' },
          toolPart('two'),
          {
            ...toolPart('ask', 'approval-requested', 'AskUserQuestion'),
            approval: { id: 'ask-approval' }
          },
          toolPart('three'),
          {
            ...toolPart('approval', 'approval-requested', 'Bash'),
            approval: { id: 'approval-1' }
          },
          toolPart('four'),
          {
            ...toolPart('report', 'output-available', 'report_artifacts'),
            input: { artifacts: [] }
          },
          toolPart('five', 'input-available')
        ] as unknown as CherryMessagePart[],
        msg({ status: 'pending' })
      )

      expect(document.querySelector('[data-live-process-run]')).toBeNull()
      expect(screen.getByText('status text')).toBeInTheDocument()
      expect(screen.getAllByTestId('live-tool-group')).toHaveLength(1)
      expect(screen.getByTestId('mock-tool-group-header')).toHaveTextContent('Processing')
      expandCollapsedLiveToolGroups()
      expect(screen.getByText('status text')).toBeInTheDocument()
      expect(screen.getAllByTestId('mock-message-tools')).toHaveLength(6)
      expect(screen.getAllByTestId('mock-tool-group-header')).toHaveLength(1)
      expect(screen.getByTestId('live-tool-group')).toHaveTextContent('1 second')
      expect(screen.queryByText('report')).toBeNull()
    })

    it('keeps direct live rendering when completed-history collapsing is disabled', () => {
      activateTurn()
      renderParts(
        [toolPart('read', 'input-available')] as unknown as CherryMessagePart[],
        msg({ status: 'pending' }),
        {},
        { ...defaultMessageRenderConfig, collapseCompletedToolHistory: false }
      )

      expect(document.querySelector('[data-live-process-run]')).toBeNull()
      expandCollapsedLiveToolGroups()
      expect(screen.getByTestId('mock-tool-group-content')).toHaveAttribute('data-count', '1')
    })

    it('keeps the tool header visible after a tool completes while the reply continues', () => {
      activateTurn('streaming')
      renderParts(
        [
          toolPart('read', 'output-available'),
          { type: 'reasoning', text: 'Continuing', state: 'streaming' }
        ] as unknown as CherryMessagePart[],
        msg({ status: 'pending' })
      )

      expect(screen.getByTestId('mock-tool-group-header')).toHaveTextContent('Processing')
      expandCollapsedLiveToolGroups()
      expect(screen.getByTestId('mock-tool-group-content')).toHaveAttribute('data-count', '1')
    })

    it('settles the last tool group once normal text starts rendering after it', () => {
      activateTurn('streaming')
      renderParts(
        [
          toolPart('read', 'output-available'),
          { type: 'text', text: 'Writing the answer', state: 'streaming' }
        ] as unknown as CherryMessagePart[],
        msg({ status: 'pending' })
      )

      expect(screen.getByTestId('child-tool-group')).toHaveAttribute('data-live-progress', 'false')
      expect(screen.getByText('Writing the answer')).toBeInTheDocument()
    })

    it('shows a tool header for standalone interactive tools during the reply', () => {
      activateTurn('streaming')
      renderParts(
        [toolPart('question', 'input-available', 'AskUserQuestion')] as unknown as CherryMessagePart[],
        msg({ status: 'pending' })
      )

      expect(screen.getByTestId('mock-tool-group-header')).toHaveTextContent('Processing')
      expandCollapsedLiveToolGroups()
      expect(screen.getByTestId('mock-message-tools')).toHaveAttribute('data-tool-name', 'AskUserQuestion')
    })

    it('does not use AskUserQuestion to classify preceding text as process history', () => {
      activateTurn('streaming')
      renderParts(
        [
          toolPart('read', 'output-available'),
          { type: 'text', text: 'Answer before question', state: 'streaming' },
          toolPart('question', 'input-available', 'AskUserQuestion'),
          { type: 'reasoning', text: 'Waiting for input', state: 'streaming' },
          { type: 'text', text: 'Waiting for your choice', state: 'streaming' }
        ] as unknown as CherryMessagePart[],
        msg({ status: 'pending' })
      )

      expect(screen.getByText('Answer before question').closest('[data-testid="live-tool-group"]')).toBeNull()
      expect(screen.getByText('Waiting for your choice').closest('[data-testid="live-tool-group"]')).toBeNull()
      expect(screen.getByTestId('mock-message-tools')).toHaveAttribute('data-tool-name', 'AskUserQuestion')
    })

    it('treats awaiting approval as live even when the persisted message is success', () => {
      activateTurn('awaiting-approval')
      renderParts(
        [
          toolPart('read'),
          {
            ...toolPart('approval', 'approval-requested', 'Bash'),
            approval: { id: 'approval-1' }
          }
        ] as unknown as CherryMessagePart[],
        msg({ status: 'success' })
      )

      expect(document.querySelector('[data-live-process-run]')).toBeNull()
      expect(screen.queryByTestId('tool-history-divider')).toBeNull()
      expandCollapsedLiveToolGroups()
      expect(screen.getAllByTestId('mock-message-tools')).toHaveLength(2)
    })

    it('does not expose the removed preview, close, full-history, or bottom-collapse controls', () => {
      activateTurn()
      renderParts([toolPart('read', 'input-available')] as unknown as CherryMessagePart[], msg({ status: 'pending' }))

      expect(screen.queryByTestId('tool-history-preview')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
      expect(screen.queryByText('全量')).toBeNull()
      expect(screen.queryByRole('button', { name: '收起' })).toBeNull()
      expect(screen.queryByTestId('tool-history-divider')).toBeNull()
    })
  })

  describe('terminal layout', () => {
    it('replaces direct live process content with collapsed history and keeps the final answer outside', () => {
      activateTurn('streaming')
      const parts = [toolPart('read'), { type: 'text', text: 'final answer' }] as unknown as CherryMessagePart[]
      const { rerender } = renderParts(parts, msg({ status: 'pending' }))

      expect(document.querySelector('[data-live-process-run]')).toBeNull()
      expect(screen.getByTestId('live-tool-group')).toBeInTheDocument()
      expect(screen.queryByTestId('mock-tool-group-content')).toBeNull()
      expect(screen.getByText('final answer')).toBeInTheDocument()
      expect(screen.getByTestId('live-tool-group-header')).not.toHaveAttribute('aria-expanded')
      expect(screen.getByTestId('live-tool-group-content')).toBeInTheDocument()

      mockIsActiveTurnTarget.mockReturnValue(false)
      mockTopicStreamState.status = 'done'
      rerender(renderPartsTree(parts, msg({ status: 'success', updatedAt: '2026-01-01T00:00:01Z' })))

      expect(document.querySelector('[data-live-process-run]')).toBeNull()
      expect(screen.getByTestId('completed-process-trigger')).toHaveAccessibleName('Processed 1 second')
      expect(screen.getByTestId('completed-process-trigger')).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByTestId('tool-history-divider')).toBeInTheDocument()
      expect(screen.queryByTestId('tool-history-content')).toBeNull()
      expect(screen.queryByTestId('mock-tool-group-content')).toBeNull()
      expect(screen.getByText('final answer')).toBeInTheDocument()
    })

    it('keeps the final text node mounted across the active-to-terminal frame', () => {
      activateTurn('streaming')
      const parts = [{ type: 'text', text: 'stable answer node' }] as unknown as CherryMessagePart[]
      const { rerender } = renderParts(parts, msg({ status: 'pending' }))
      const activeAnswerNode = screen.getByText('stable answer node')

      mockIsActiveTurnTarget.mockReturnValue(false)
      mockTopicStreamState.status = 'done'
      rerender(renderPartsTree(parts, msg({ status: 'success' })))

      expect(screen.getByText('stable answer node')).toBe(activeAnswerNode)
    })

    it('folds process narration with its provider tool while keeping the final answer outside', () => {
      renderParts([
        { type: 'text', text: 'Searching provider sources' },
        { ...toolPart('search', 'output-available', 'web_search'), toolType: 'provider' },
        { type: 'text', text: 'Provider-backed final answer' }
      ] as unknown as CherryMessagePart[])

      expect(screen.queryByText('Searching provider sources')).toBeNull()
      expect(screen.getByText('Provider-backed final answer')).toBeInTheDocument()
      const historyTrigger = screen.getByTestId('completed-process-trigger')
      expect(historyTrigger).toHaveAttribute('aria-expanded', 'false')

      fireEvent.click(historyTrigger)
      expect(screen.getByText('Searching provider sources')).toBeInTheDocument()
    })

    it('nests process text and child tool groups under one top-level tool group', () => {
      const { container } = renderParts([
        toolPart('read'),
        { type: 'text', text: 'Process update between tools' },
        toolPart('edit'),
        { type: 'text', text: 'Main final answer' }
      ] as unknown as CherryMessagePart[])

      const historyTrigger = screen.getByTestId('completed-process-trigger')
      expect(historyTrigger).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('Process update between tools')).toBeNull()
      expect(screen.getByText('Main final answer')).toBeInTheDocument()

      fireEvent.click(historyTrigger)

      expect(screen.getAllByTestId('child-tool-group')).toHaveLength(2)
      expect(screen.queryByTestId('mock-tool-group-content')).toBeNull()
      expect(screen.getByText('Process update between tools')).toBeInTheDocument()

      expandCollapsedChildToolGroups()
      expect(screen.getAllByTestId('mock-tool-group-content')).toHaveLength(2)
      const html = container.innerHTML
      expect(html.indexOf('mock-tool-group-content')).toBeLessThan(html.indexOf('Process update between tools'))
      expect(html.lastIndexOf('mock-tool-group-content')).toBeGreaterThan(html.indexOf('Process update between tools'))
      expect(html.lastIndexOf('mock-tool-group-content')).toBeLessThan(html.indexOf('Main final answer'))
    })

    it('treats reasoning between tools as part of one continuous child tool group', () => {
      renderParts([
        toolPart('read'),
        { type: 'reasoning', text: 'Reasoning between tools', state: 'done' },
        toolPart('edit'),
        { type: 'text', text: 'Main final answer' }
      ] as unknown as CherryMessagePart[])

      fireEvent.click(screen.getByTestId('completed-process-trigger'))

      expect(screen.getAllByTestId('child-tool-group')).toHaveLength(1)
      expect(screen.queryByText('Reasoning between tools')).toBeNull()
      expect(screen.queryByTestId('mock-tool-group-content')).toBeNull()

      expandCollapsedChildToolGroups()

      expect(screen.getByTestId('mock-thinking-block')).toHaveTextContent('Reasoning between tools')
      expect(screen.getAllByTestId('mock-tool-group-content')).toHaveLength(2)
      expect(screen.getByText('Main final answer')).toBeInTheDocument()
    })

    it('does not let hidden transport markers split a continuous child tool group', () => {
      renderParts([
        ...Array.from({ length: 3 }, (_, index) => toolPart(`before-${index}`)),
        { type: 'step-start' },
        { type: 'source-url', url: 'https://example.com' },
        ...Array.from({ length: 6 }, (_, index) => toolPart(`after-${index}`)),
        { type: 'text', text: 'Main final answer' }
      ] as unknown as CherryMessagePart[])

      fireEvent.click(screen.getByTestId('completed-process-trigger'))

      expect(screen.getAllByTestId('child-tool-group')).toHaveLength(1)
      expect(screen.getByTestId('child-tool-group-trigger')).toHaveTextContent('after-5')
    })

    it('omits tool-bound ellipsis fillers from completed history details', () => {
      renderParts([
        toolPart('read'),
        { type: 'text', text: '...' },
        toolPart('edit'),
        { type: 'text', text: 'Final answer' }
      ] as unknown as CherryMessagePart[])

      fireEvent.click(screen.getByTestId('completed-process-trigger'))
      expandCollapsedChildToolGroups()

      expect(screen.queryByText('...')).toBeNull()
      expect(screen.getByTestId('mock-tool-group-content')).toHaveAttribute('data-count', '2')
      expect(screen.getByText('Final answer')).toBeInTheDocument()
    })

    it('keeps an interleaved AskUser tool independent and ordered inside completed history', () => {
      renderParts([
        toolPart('read'),
        toolPart('ask', 'output-available', 'AskUserQuestion'),
        toolPart('edit'),
        { type: 'text', text: 'Answer after question' }
      ] as unknown as CherryMessagePart[])

      fireEvent.click(screen.getByTestId('completed-process-trigger'))
      expandCollapsedChildToolGroups()

      const toolNodes = screen.getAllByTestId('mock-message-tools')
      const askNode = toolNodes.find((node) => node.getAttribute('data-tool-name') === 'AskUserQuestion')
      expect(askNode?.closest('[data-testid="mock-tool-group-content"]')).toBeNull()
      expect(screen.getAllByTestId('mock-tool-group-content')).toHaveLength(2)
    })

    it('settles a standalone awaiting AskUser tool in a terminal snapshot', () => {
      renderParts([
        {
          ...toolPart('ask', 'approval-requested', 'AskUserQuestion'),
          approval: { id: 'ask-approval' }
        }
      ] as unknown as CherryMessagePart[])

      fireEvent.click(screen.getByTestId('completed-process-trigger'))
      expandCollapsedChildToolGroups()

      expect(screen.getByTestId('mock-message-tools')).toHaveAttribute('data-status', 'cancelled')
    })

    it('shows completed summaries for pure tool and pure reasoning messages', () => {
      const tools = renderParts([toolPart('read')] as unknown as CherryMessagePart[])
      expect(screen.getByTestId('completed-process-trigger')).toHaveAccessibleName('Processed')
      expect(screen.getByTestId('completed-process-trigger')).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByTestId('mock-tool-group-content')).toBeNull()
      tools.unmount()

      renderParts([
        { type: 'reasoning', text: 'Only thought one', state: 'done' },
        { type: 'reasoning', text: 'Only thought two', state: 'done' }
      ] as unknown as CherryMessagePart[])
      expect(screen.getByRole('button', { name: 'Reasoning content' })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByTestId('mock-thinking-block')).toBeNull()
    })

    it('shows processed status and elapsed time in a completed tool summary', () => {
      renderParts([toolPart('read')] as unknown as CherryMessagePart[], msg({ updatedAt: '2026-01-01T00:00:01Z' }))

      expect(screen.getByRole('button', { name: 'Processed 1 second' })).toBeInTheDocument()
    })

    it('shows a recovered result as processed while preserving the failed tool detail', () => {
      renderParts(
        [
          toolPart('failed', 'output-error'),
          toolPart('cleanup'),
          { type: 'text', text: 'Recovered answer' }
        ] as unknown as CherryMessagePart[],
        msg({ updatedAt: '2026-01-01T00:00:01Z' })
      )

      const historyTrigger = screen.getByRole('button', { name: 'Processed 1 second' })
      fireEvent.click(historyTrigger)
      expandCollapsedChildToolGroups()

      const failedTool = screen
        .getAllByTestId('mock-message-tools')
        .find((node) => node.getAttribute('data-tool-name') === 'failed')
      expect(failedTool).toHaveAttribute('data-status', 'error')
    })

    it('keeps an unrecovered tool failure in the collapsed completed summary', () => {
      renderParts([toolPart('failed', 'output-error')] as unknown as CherryMessagePart[])

      expect(screen.getByRole('button', { name: 'Error' })).toBeInTheDocument()
    })

    it('folds a terminal process error with its adjacent reasoning', () => {
      renderParts([
        { type: 'text', text: 'partial answer' },
        { type: 'reasoning', text: 'Investigating', state: 'done' },
        { type: 'data-error', data: { name: 'Err', message: 'failed after reasoning' } }
      ] as unknown as CherryMessagePart[])

      const historyTrigger = screen.getByRole('button', { name: 'Error' })
      expect(historyTrigger).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByTestId('mock-error-block')).toBeNull()
      expect(screen.getByText('partial answer')).toBeInTheDocument()

      fireEvent.click(historyTrigger)
      expect(screen.getByTestId('mock-thinking-block')).toHaveTextContent('Investigating')
      expandCollapsedChildToolGroups()
      expect(screen.queryByTestId('mock-thinking-content')).toBeNull()
      expect(screen.getByTestId('mock-error-block')).toHaveAttribute('data-error-message', 'failed after reasoning')
    })

    it('renders pure text without a process-history summary', () => {
      renderParts([{ type: 'text', text: 'plain final answer' } as unknown as CherryMessagePart])

      expect(screen.getByText('plain final answer')).toBeInTheDocument()
      expect(screen.queryByTestId('tool-history-divider')).toBeNull()
      expect(document.querySelector('[data-live-process-run]')).toBeNull()
    })

    it('keeps an earlier final answer visible when process tools trail it', () => {
      renderParts([
        toolPart('read'),
        { type: 'text', text: 'stable final answer' },
        toolPart('cleanup')
      ] as unknown as CherryMessagePart[])

      expect(screen.getByText('stable final answer')).toBeInTheDocument()
      const historyTrigger = screen.getByTestId('completed-process-trigger')
      expect(historyTrigger).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByTestId('mock-tool-group-content')).toBeNull()

      fireEvent.click(historyTrigger)
      expect(screen.getByTestId('child-tool-group-trigger')).toHaveAttribute('aria-expanded', 'false')
      expandCollapsedChildToolGroups()
      expect(screen.getByTestId('mock-tool-group-content')).toHaveAttribute('data-count', '2')
      expect(screen.getByText('stable final answer')).toBeInTheDocument()
    })

    it('keeps non-process value parts visible beside collapsed tools', () => {
      renderParts([
        { type: 'file', url: 'file:///process.pdf', mediaType: 'application/pdf', filename: 'process.pdf' },
        toolPart('read'),
        { type: 'text', text: 'final answer' }
      ] as unknown as CherryMessagePart[])

      expect(screen.queryByTestId('mock-attachments')).toBeNull()
      expect(screen.getByText('final answer')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('completed-process-trigger'))
      expect(screen.getByTestId('mock-attachments')).toHaveAttribute('data-file-name', 'process.pdf')
    })

    it('keeps the AgentRightPane flat history path projected and in original order', () => {
      const { container } = renderParts(
        [
          { type: 'text', text: 'process preface' },
          toolPart('read'),
          { type: 'text', text: '...' },
          { type: 'text', text: '   ' },
          { type: 'reasoning', text: '', state: 'done' },
          toolPart('edit'),
          { type: 'text', text: 'final answer' },
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
          }
        ] as unknown as CherryMessagePart[],
        msg(),
        {},
        { ...defaultMessageRenderConfig, collapseCompletedToolHistory: false }
      )

      expect(screen.queryByTestId('tool-history-divider')).toBeNull()
      expect(screen.getByTestId('mock-tool-group-content')).toHaveAttribute('data-count', '2')
      expect(screen.queryByText('...')).toBeNull()
      expect(screen.queryByTestId('mock-thinking-block')).toBeNull()
      expect(latestMainTextProps(2)).toBeUndefined()
      expect(latestMainTextProps(3)).toBeUndefined()
      expect(screen.getByText('process preface')).toBeInTheDocument()
      expect(screen.getByText('final answer')).toBeInTheDocument()
      expect(screen.getByText('report.md')).toBeInTheDocument()

      const html = container.innerHTML
      expect(html.indexOf('process preface')).toBeLessThan(html.indexOf('mock-tool-group-content'))
      expect(html.indexOf('mock-tool-group-content')).toBeLessThan(html.indexOf('final answer'))
      expect(html.indexOf('final answer')).toBeLessThan(html.indexOf('report.md'))
    })

    it('keeps all adjacent reasoning blocks inside the completed tool group', () => {
      renderParts([
        toolPart('read'),
        ...Array.from({ length: 4 }, (_, index) => ({
          type: 'reasoning',
          text: `thought ${index + 1}`,
          state: 'done'
        })),
        { type: 'text', text: 'final answer' }
      ] as unknown as CherryMessagePart[])

      fireEvent.click(screen.getByTestId('completed-process-trigger'))
      expandCollapsedChildToolGroups()

      expect(screen.getByTestId('mock-tool-group-content')).toHaveAttribute('data-count', '1')
      expect(screen.getAllByTestId('mock-thinking-block')).toHaveLength(4)
      expect(screen.queryByTestId('mock-thinking-content')).toBeNull()
      expect(screen.getByText('final answer')).toBeInTheDocument()
    })

    it('keeps all adjacent blocks in a pure reasoning group', () => {
      renderParts(
        Array.from({ length: 4 }, (_, index) => ({
          type: 'reasoning',
          text: `pure thought ${index + 1}`,
          state: 'done'
        })) as unknown as CherryMessagePart[]
      )

      fireEvent.click(screen.getByRole('button', { name: 'Reasoning content' }))
      expandCollapsedChildToolGroups()

      expect(screen.getAllByTestId('mock-thinking-block')).toHaveLength(4)
      expect(screen.queryByTestId('mock-thinking-content')).toBeNull()
      expect(screen.getByText('pure thought 4')).toBeInTheDocument()
    })

    it('seals unfinished reasoning and tools when a terminal snapshot lacks end chunks', () => {
      renderParts([
        { type: 'reasoning', text: 'Interrupted thought', state: 'streaming' },
        toolPart('unfinished', 'input-streaming'),
        { type: 'text', text: 'partial answer' }
      ] as unknown as CherryMessagePart[])

      fireEvent.click(screen.getByTestId('completed-process-trigger'))
      expandCollapsedChildToolGroups()

      expect(screen.getByTestId('mock-thinking-block')).toHaveAttribute('data-streaming', 'false')
      expect(screen.queryByTestId('mock-thinking-content')).toBeNull()
      expect(screen.getByTestId('mock-message-tools')).toHaveAttribute('data-status', 'cancelled')
    })

    it('does not lose special value parts around completed process history', () => {
      renderParts([
        toolPart('read'),
        { type: 'data-code', data: { content: 'answer()', language: 'ts' } },
        { type: 'data-compact', data: { content: 'summary', compactedContent: 'compacted source' } },
        { type: 'data-translation', data: { content: 'translated answer' } },
        { type: 'data-compaction-anchor', data: { trigger: 'auto', completedAt: '2026-01-01' } },
        { type: 'data-error', data: { name: 'Err', message: 'visible error' } },
        { type: 'file', url: 'https://img.test/result.png', mediaType: 'image/png' },
        { type: 'file', url: 'file:///result.pdf', mediaType: 'application/pdf', filename: 'result.pdf' },
        { type: 'data-video', data: { filePath: '/tmp/result.mp4' } },
        toolPart('cleanup')
      ] as unknown as CherryMessagePart[])

      expect(screen.getByTestId('mock-markdown').textContent).toContain('answer()')
      expect(screen.getByTestId('mock-compact-block')).toHaveTextContent('summary|compacted source')
      expect(screen.getByTestId('mock-translation-block')).toHaveTextContent('translated answer')
      expect(screen.getByRole('separator')).toBeInTheDocument()
      expect(screen.getByTestId('mock-error-block')).toHaveAttribute('data-error-message', 'visible error')
      expect(screen.getByTestId('mock-image-block')).toBeInTheDocument()
      expect(screen.getByTestId('mock-attachments')).toHaveAttribute('data-file-name', 'result.pdf')
      expect(screen.getByTestId('mock-message-video')).toHaveAttribute('data-file-path', '/tmp/result.mp4')
      expect(screen.getByTestId('completed-process-trigger')).toHaveAttribute('aria-expanded', 'false')
    })
  })
})
