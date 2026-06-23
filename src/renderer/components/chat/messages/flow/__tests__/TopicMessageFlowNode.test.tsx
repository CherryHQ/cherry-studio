import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TopicMessageFlowNode from '../TopicMessageFlowNode'
import type { TopicMessageFlowNodeData } from '../types'

const mocks = vi.hoisted(() => ({
  messageContentProps: [] as Array<{ message: { id: string } }>,
  messageProviderProps: [] as Array<{
    messages: Array<{ id: string }>
    partsByMessageId: Record<string, unknown[]>
  }>,
  useQuery: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: mocks.useQuery
}))

vi.mock('@xyflow/react', () => ({
  Handle: () => <span data-testid="flow-handle" />,
  Position: {
    Bottom: 'bottom',
    Top: 'top'
  }
}))

vi.mock('@cherrystudio/ui', async () => {
  const ReactModule = await import('react')
  const PopoverContext = ReactModule.createContext(false)

  return {
    Popover: ({ children, open }: { children: ReactNode; open?: boolean }) => (
      <PopoverContext value={Boolean(open)}>{children}</PopoverContext>
    ),
    PopoverAnchor: ({ children }: { children: ReactElement }) => children,
    PopoverContent: ({ children, ...props }: { children: ReactNode }) => {
      const open = ReactModule.use(PopoverContext)
      return open ? (
        <div data-testid="message-preview-popover" {...props}>
          {children}
        </div>
      ) : null
    }
  }
})

vi.mock('@renderer/components/chat/primitives', () => ({
  EmptyState: ({ title, ...props }: { title?: ReactNode }) => <div {...props}>{title}</div>,
  LoadingState: ({ label, ...props }: { label?: ReactNode }) => <div {...props}>{label}</div>
}))

vi.mock('@renderer/components/chat/messages/MessageContentProvider', () => ({
  MessageContentProvider: (props: {
    children: ReactNode
    messages: Array<{ id: string }>
    partsByMessageId: Record<string, unknown[]>
  }) => {
    mocks.messageProviderProps.push(props)
    return <div data-testid="message-content-provider">{props.children}</div>
  }
}))

vi.mock('@renderer/components/chat/messages/frame/MessageContent', () => ({
  default: (props: { message: { id: string } }) => {
    mocks.messageContentProps.push(props)
    return <div data-testid="message-content">message:{props.message.id}</div>
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const nodeData: TopicMessageFlowNodeData = {
  createdAt: '2026-01-01T00:01:00.000Z',
  isActive: false,
  isInactiveBranch: false,
  isOnActivePath: true,
  messageId: 'message-1',
  modelId: 'openai/gpt-5-codex',
  preview: 'Short preview',
  role: 'assistant',
  status: 'success'
}

const message = {
  id: 'message-1',
  topicId: 'topic-1',
  parentId: null,
  role: 'assistant',
  data: {
    parts: [{ type: 'text', text: 'Full message detail' }]
  },
  searchableText: 'Full message detail',
  status: 'success',
  siblingsGroupId: 0,
  modelId: 'openai:gpt-5-codex',
  modelSnapshot: null,
  traceId: null,
  stats: null,
  createdAt: '2026-01-01T00:01:00.000Z',
  updatedAt: '2026-01-01T00:01:00.000Z'
}

function renderNode(overrides: Partial<TopicMessageFlowNodeData> = {}) {
  const data = { ...nodeData, ...overrides }
  const props = { data, id: data.messageId, selected: false } as ComponentProps<typeof TopicMessageFlowNode>
  return render(<TopicMessageFlowNode {...props} />)
}

function getNodeElement() {
  return screen.getByText('Short preview').closest('[data-message-id="message-1"]')!
}

async function advancePreviewDelay(ms = 300) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

describe('TopicMessageFlowNode', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.messageContentProps.length = 0
    mocks.messageProviderProps.length = 0
    mocks.useQuery.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: false
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it.each([
    ['user', 'user-message', 'User preview', 'border-success/35', 'bg-success-bg'],
    ['assistant', 'assistant-message', 'Assistant preview', 'border-info/35', 'bg-info-bg'],
    ['system', 'system-message', 'System preview', 'border-border', 'bg-muted/45']
  ] as const)('keeps the %s role background color on canvas nodes', (role, messageId, preview, border, background) => {
    renderNode({ messageId, preview, role })

    expect(screen.getByText(preview).closest(`[data-message-id="${messageId}"]`)).toHaveClass(border, background)
  })

  it('fetches the message preview only after hovering the node for 300ms', async () => {
    renderNode()

    expect(mocks.useQuery).not.toHaveBeenCalled()

    fireEvent.mouseEnter(getNodeElement())
    await advancePreviewDelay(299)

    expect(mocks.useQuery).not.toHaveBeenCalled()

    await advancePreviewDelay(1)

    expect(mocks.useQuery).toHaveBeenCalledWith('/messages/:id', {
      enabled: true,
      params: { id: 'message-1' }
    })
  })

  it('shows input draft status without fetching a real message preview', async () => {
    renderNode({
      isInputDraft: true,
      preview: 'chat.message.flow.status.awaiting_input',
      role: 'user',
      status: 'paused'
    })

    const node = screen
      .getAllByText('chat.message.flow.status.awaiting_input')[0]
      .closest('[data-message-id="message-1"]')!

    expect(node).toHaveTextContent('chat.message.flow.status.awaiting_input')

    fireEvent.mouseEnter(node)
    await advancePreviewDelay()

    expect(mocks.useQuery).not.toHaveBeenCalled()
    expect(screen.queryByTestId('message-preview-popover')).not.toBeInTheDocument()
  })

  it('cancels the tooltip preview when hover ends before the delay', async () => {
    renderNode()

    const node = getNodeElement()

    fireEvent.mouseEnter(node)
    await advancePreviewDelay(250)
    fireEvent.mouseLeave(node)
    await advancePreviewDelay()

    expect(mocks.useQuery).not.toHaveBeenCalled()
    expect(screen.queryByTestId('message-preview-popover')).not.toBeInTheDocument()
  })

  it('opens the tooltip only once while moving inside the same hovered node', async () => {
    mocks.useQuery.mockReturnValue({
      data: message,
      error: undefined,
      isLoading: false
    })

    renderNode()

    const node = getNodeElement()

    fireEvent.mouseEnter(node)
    fireEvent.mouseMove(node)
    fireEvent.mouseMove(node)
    await advancePreviewDelay()

    expect(mocks.useQuery).toHaveBeenCalledTimes(1)

    fireEvent.mouseMove(node)
    fireEvent.mouseMove(node)
    await advancePreviewDelay(1000)

    expect(mocks.useQuery).toHaveBeenCalledTimes(1)
  })

  it('renders the shared loading state while the tooltip message is loading', async () => {
    mocks.useQuery.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true
    })

    renderNode()

    fireEvent.mouseEnter(getNodeElement())
    await advancePreviewDelay()

    expect(screen.getByTestId('topic-message-flow-preview-loading')).toBeInTheDocument()
    expect(screen.getByTestId('topic-message-flow-preview-loading')).toHaveTextContent('common.loading')
  })

  it('renders the loaded message through the shared message content renderer', async () => {
    mocks.useQuery.mockReturnValue({
      data: message,
      error: undefined,
      isLoading: false
    })

    renderNode()

    fireEvent.mouseEnter(getNodeElement())
    await advancePreviewDelay()

    expect(screen.getByTestId('message-content')).toHaveTextContent('message:message-1')
    expect(mocks.messageProviderProps[0].messages).toEqual([expect.objectContaining({ id: 'message-1' })])
    expect(mocks.messageProviderProps[0].partsByMessageId).toEqual({
      'message-1': [{ type: 'text', text: 'Full message detail' }]
    })
    expect(mocks.messageContentProps[0].message).toEqual(expect.objectContaining({ id: 'message-1' }))
  })

  it('shows an error state in the tooltip without hiding the node', async () => {
    mocks.useQuery.mockReturnValue({
      data: undefined,
      error: new Error('failed'),
      isLoading: false
    })

    renderNode()

    fireEvent.mouseEnter(getNodeElement())
    await advancePreviewDelay()

    expect(screen.getByRole('alert')).toHaveTextContent('common.error')
    expect(screen.getByText('Short preview')).toBeInTheDocument()
  })
})
