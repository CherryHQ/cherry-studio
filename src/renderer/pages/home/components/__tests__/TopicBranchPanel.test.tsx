import { toast } from '@renderer/services/toast'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TopicBranchPanel from '../TopicBranchPanel'

const mocks = vi.hoisted(() => ({
  copyBranchToNewTopic: vi.fn().mockResolvedValue({ id: 'copied-topic' }),
  deleteAwaitingInputMessage: vi.fn().mockResolvedValue({ deletedIds: ['branch-empty-user'] }),
  reserveBranch: vi.fn().mockResolvedValue({ id: 'reserved-user' }),
  refetchTree: vi.fn(),
  setActiveBranch: vi.fn<() => Promise<string | undefined>>(),
  chatWriteAvailable: true,
  topicPending: false,
  eventEmit: vi.fn(),
  useDataChange: vi.fn(),
  useQuery: vi.fn(),
  useMutation: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useDataChange: mocks.useDataChange,
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery
}))

vi.mock('@renderer/hooks/chat/ChatWriteContext', () => ({
  useChatWrite: () => (mocks.chatWriteAvailable ? { setActiveBranch: mocks.setActiveBranch } : null)
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: mocks.topicPending })
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: { FOCUS_CHAT_COMPOSER: 'FOCUS_CHAT_COMPOSER' },
  EventEmitter: { emit: mocks.eventEmit }
}))

vi.mock('@renderer/components/command', async () => {
  const React = await import('react')
  type MockExtraItem = {
    id?: string
    label?: string
    enabled?: boolean
    description?: React.ReactNode
    onSelect?: () => void
  }

  return {
    CommandContextMenu: ({
      children,
      getExtraItems,
      onOpenChange
    }: {
      children: React.ReactNode
      getExtraItems?: (event: React.MouseEvent) => MockExtraItem[]
      onOpenChange?: (open: boolean) => void
    }) => {
      const [items, setItems] = React.useState<MockExtraItem[]>([])
      return (
        <div
          data-testid="topic-branch-context-menu-host"
          onContextMenu={(event) => {
            event.preventDefault()
            onOpenChange?.(true)
            setItems((getExtraItems?.(event) ?? []).filter((item) => item.id))
          }}>
          {children}
          <div data-testid="topic-branch-context-menu">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={item.enabled === false}
                data-description={typeof item.description === 'string' ? item.description : undefined}
                onClick={() => {
                  item.onSelect?.()
                  onOpenChange?.(false)
                }}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )
    }
  }
})

vi.mock('@renderer/components/chat/flow', () => ({
  buildTopicMessageFlowGraph: vi.fn((tree) => {
    const parentById = new Map(
      tree.nodes.map((node: { id: string; parentId: string | null }) => [node.id, node.parentId])
    )
    const activePath = new Set<string>()
    let currentId = tree.activeNodeId
    while (currentId && parentById.has(currentId)) {
      activePath.add(currentId)
      currentId = parentById.get(currentId)
    }

    return {
      activeNodeId: tree.activeNodeId,
      edges: [],
      nodes: tree.nodes.map((node: { id: string; preview?: string; role?: string; isAwaitingInput?: boolean }) => ({
        id: node.id,
        data: {
          messageId: node.id,
          preview: node.preview,
          role: node.role,
          isAwaitingInput: node.isAwaitingInput,
          isOnActivePath: activePath.has(node.id)
        },
        position: { x: 0, y: 0 }
      })),
      stats: {
        activePathLength: activePath.size,
        branchCount: 2,
        nodeCount: tree.nodes.length
      }
    }
  }),
  layoutTopicMessageFlowGraph: vi.fn((graph) => graph),
  mergeTopicMessageFlowLiveTree: vi.fn((tree, liveState) => {
    if (!liveState) return tree
    return {
      ...tree,
      activeNodeId: liveState.activeNodeId ?? tree.activeNodeId,
      nodes: [
        ...tree.nodes,
        ...liveState.nodes
          .filter((liveNode: { id: string }) => !tree.nodes.some((node: { id: string }) => node.id === liveNode.id))
          .map((liveNode: { id: string; parentId: string | null; preview: string }) => ({
            id: liveNode.id,
            parentId: liveNode.parentId,
            preview: liveNode.preview
          }))
      ]
    }
  }),
  TopicMessageFlowCanvas: ({
    graph,
    onNodeContextMenu,
    onNodeActivate
  }: {
    graph: { nodes: { data: { messageId: string; preview?: string; isAwaitingInput?: boolean } }[] }
    onNodeContextMenu?: (messageId: string) => void
    onNodeActivate: (messageId: string) => void
  }) => (
    <div>
      {graph.nodes.map((node) => (
        <button
          key={node.data.messageId}
          type="button"
          data-message-id={node.data.messageId}
          data-awaiting-input={String(Boolean(node.data.isAwaitingInput))}
          data-testid={`topic-message-flow-node-${node.data.messageId}`}
          onContextMenu={() => onNodeContextMenu?.(node.data.messageId)}
          onClick={() => onNodeActivate(node.data.messageId)}>
          {node.data.preview}
        </button>
      ))}
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('TopicBranchPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.topicPending = false
    mocks.chatWriteAvailable = true
    mocks.setActiveBranch.mockResolvedValue('leaf-1')
    mocks.useQuery.mockReturnValue({
      data: {
        activeNodeId: 'active-1',
        nodes: [
          {
            id: 'message-1',
            parentId: null,
            role: 'user',
            preview: 'Hello',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:00.000Z',
            hasChildren: false
          }
        ],
        siblingsGroups: []
      },
      error: undefined,
      isLoading: false,
      refetch: mocks.refetchTree
    })
    mocks.useMutation.mockImplementation((_method: string, path: string) => {
      if (path === '/topics/:id/duplicate') {
        return { trigger: mocks.copyBranchToNewTopic }
      }
      if (path === '/messages/:id') {
        return { trigger: mocks.deleteAwaitingInputMessage }
      }
      if (path === '/messages/:id/branches') {
        return { trigger: mocks.reserveBranch }
      }
      throw new Error(`Unexpected mutation: ${path}`)
    })
  })

  it('renders the canvas without a secondary statistics header', () => {
    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    expect(screen.getByTestId('topic-message-flow-node-message-1')).toBeInTheDocument()
    expect(screen.queryByText('2 chat.message.flow.branches')).not.toBeInTheDocument()
    expect(screen.queryByText('1 chat.message.flow.nodes')).not.toBeInTheDocument()
    expect(mocks.useQuery).toHaveBeenCalledWith('/topics/:topicId/tree', {
      enabled: true,
      params: { topicId: 'topic-1' },
      query: { depth: -1 }
    })
  })

  it('keeps the topic tree query disabled while the right pane is closed', () => {
    render(<TopicBranchPanel open={false} topicId="topic-1" />)

    expect(mocks.useQuery).toHaveBeenCalledWith('/topics/:topicId/tree', {
      enabled: false,
      params: { topicId: 'topic-1' },
      query: { depth: -1 }
    })
  })

  it('refetches an open tree after a cross-window tree change', () => {
    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    expect(mocks.useDataChange).toHaveBeenCalledWith('/topics/:topicId/tree', expect.any(Function), {
      routeParams: { topicId: 'topic-1' }
    })
    const listener = mocks.useDataChange.mock.calls.at(-1)?.[1] as (() => void) | undefined
    listener?.()

    expect(mocks.refetchTree).toHaveBeenCalledOnce()
  })

  it('activates the selected branch through chat write before focusing the composer', async () => {
    const user = userEvent.setup()
    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    await user.click(screen.getByRole('button', { name: 'Hello' }))

    await waitFor(() => {
      expect(mocks.eventEmit).toHaveBeenCalledWith('FOCUS_CHAT_COMPOSER', { topicId: 'topic-1' })
    })
    expect(mocks.setActiveBranch).toHaveBeenCalledWith('message-1')
  })

  it('does not focus the composer when the requested branch is unavailable', async () => {
    mocks.setActiveBranch.mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    await user.click(screen.getByRole('button', { name: 'Hello' }))

    expect(mocks.setActiveBranch).toHaveBeenCalledWith('message-1')
    expect(mocks.eventEmit).not.toHaveBeenCalled()
  })

  it('disables branch activation when chat write is unavailable', async () => {
    mocks.chatWriteAvailable = false
    const user = userEvent.setup()
    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    await user.click(screen.getByRole('button', { name: 'Hello' }))

    expect(mocks.setActiveBranch).not.toHaveBeenCalled()
    expect(mocks.eventEmit).not.toHaveBeenCalled()
  })

  it('locates the current active node without writing branch state', async () => {
    const onLocateMessage = vi.fn()
    mocks.useQuery.mockReturnValue({
      data: {
        activeNodeId: 'message-1',
        nodes: [
          {
            id: 'message-1',
            parentId: null,
            role: 'user',
            preview: 'Hello',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:00.000Z',
            hasChildren: false
          }
        ],
        siblingsGroups: []
      },
      error: undefined,
      isLoading: false,
      refetch: mocks.refetchTree
    })

    render(<TopicBranchPanel open={true} topicId="topic-1" onLocateMessage={onLocateMessage} />)

    fireEvent.click(screen.getByTestId('topic-message-flow-node-message-1'))

    await Promise.resolve()

    expect(onLocateMessage).toHaveBeenCalledWith('message-1')
    expect(mocks.setActiveBranch).not.toHaveBeenCalled()
    expect(mocks.refetchTree).not.toHaveBeenCalled()
  })

  it('locates an ancestor on the current active path without switching branch', async () => {
    const onLocateMessage = vi.fn()
    mocks.useQuery.mockReturnValue({
      data: {
        activeNodeId: 'leaf-1',
        nodes: [
          {
            id: 'message-1',
            parentId: null,
            role: 'user',
            preview: 'Hello',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:00.000Z',
            hasChildren: true
          },
          {
            id: 'leaf-1',
            parentId: 'message-1',
            role: 'assistant',
            preview: 'Answer',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:01.000Z',
            hasChildren: false
          }
        ],
        siblingsGroups: []
      },
      error: undefined,
      isLoading: false,
      refetch: mocks.refetchTree
    })

    render(<TopicBranchPanel open={true} topicId="topic-1" onLocateMessage={onLocateMessage} />)

    fireEvent.click(screen.getByTestId('topic-message-flow-node-message-1'))

    await Promise.resolve()

    expect(onLocateMessage).toHaveBeenCalledWith('message-1')
    expect(mocks.setActiveBranch).not.toHaveBeenCalled()
    expect(mocks.refetchTree).not.toHaveBeenCalled()
  })

  it('renders live branch preview without refetching the topic tree per chunk', () => {
    render(
      <TopicBranchPanel
        open={true}
        topicId="topic-1"
        liveState={{
          topicId: 'topic-1',
          activeNodeId: 'assistant-live',
          nodes: [
            {
              id: 'assistant-live',
              parentId: 'message-1',
              role: 'assistant',
              preview: 'streaming live preview',
              modelId: 'provider/model',
              status: 'pending',
              createdAt: '2026-05-22T00:00:01.000Z'
            }
          ]
        }}
      />
    )

    expect(screen.getByText('streaming live preview')).toBeInTheDocument()
    expect(mocks.refetchTree).not.toHaveBeenCalled()
  })

  it('falls back to the tree preview after live branch state is cleared', () => {
    render(<TopicBranchPanel open={true} topicId="topic-1" liveState={null} />)

    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('disables branch creation while the topic is generating', async () => {
    mocks.topicPending = true
    mocks.useQuery.mockReturnValue({
      data: {
        activeNodeId: 'assistant-latest',
        nodes: [
          {
            id: 'user-1',
            parentId: null,
            role: 'user',
            preview: 'Question',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:00.000Z',
            hasChildren: true
          },
          {
            id: 'message-1',
            parentId: 'user-1',
            role: 'assistant',
            preview: 'Old answer',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:01.000Z',
            hasChildren: true
          },
          {
            id: 'user-2',
            parentId: 'message-1',
            role: 'user',
            preview: 'Follow up',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:02.000Z',
            hasChildren: true
          },
          {
            id: 'assistant-latest',
            parentId: 'user-2',
            role: 'assistant',
            preview: 'Latest answer',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:03.000Z',
            hasChildren: false
          }
        ],
        siblingsGroups: []
      },
      error: undefined,
      isLoading: false,
      refetch: mocks.refetchTree
    })

    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    fireEvent.contextMenu(screen.getByTestId('topic-message-flow-node-message-1'))
    const branchButton = await screen.findByRole('button', { name: 'chat.message.new.branch.label' })
    expect(branchButton).toBeDisabled()
    fireEvent.click(branchButton)
    expect(mocks.reserveBranch).not.toHaveBeenCalled()
    expect(mocks.setActiveBranch).not.toHaveBeenCalled()
    expect(mocks.eventEmit).not.toHaveBeenCalled()
  })

  it('renders and reactivates a persisted awaiting-input message as a real canvas node', async () => {
    mocks.useQuery.mockReturnValue({
      data: {
        activeNodeId: 'assistant-old',
        nodes: [
          {
            id: 'user-1',
            parentId: null,
            role: 'user',
            preview: 'Question',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:00.000Z',
            hasChildren: true
          },
          {
            id: 'assistant-old',
            parentId: 'user-1',
            role: 'assistant',
            preview: 'Old answer',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:01.000Z',
            hasChildren: true
          },
          {
            id: 'awaiting-input-user',
            parentId: 'assistant-old',
            role: 'user',
            isAwaitingInput: true,
            preview: '',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:02.000Z',
            hasChildren: false
          }
        ],
        siblingsGroups: []
      },
      error: undefined,
      isLoading: false,
      refetch: mocks.refetchTree
    })
    mocks.setActiveBranch.mockResolvedValueOnce('awaiting-input-user')

    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    const awaitingInputNode = screen.getByTestId('topic-message-flow-node-awaiting-input-user')
    expect(awaitingInputNode).toHaveAttribute('data-awaiting-input', 'true')

    fireEvent.click(awaitingInputNode)

    await waitFor(() => {
      expect(mocks.setActiveBranch).toHaveBeenCalledWith('awaiting-input-user')
    })
    expect(mocks.refetchTree).not.toHaveBeenCalled()
  })

  it('deletes a persisted empty message from its context menu', async () => {
    mocks.useQuery.mockReturnValue({
      data: {
        activeNodeId: 'branch-empty-user',
        nodes: [
          {
            id: 'assistant-1',
            parentId: 'user-1',
            role: 'assistant',
            preview: 'Answer',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:01.000Z',
            hasChildren: true
          },
          {
            id: 'branch-empty-user',
            parentId: 'assistant-1',
            role: 'user',
            isAwaitingInput: true,
            preview: '',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:02.000Z',
            hasChildren: false
          }
        ],
        siblingsGroups: []
      },
      error: undefined,
      isLoading: false,
      refetch: mocks.refetchTree
    })

    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    fireEvent.contextMenu(screen.getByTestId('topic-message-flow-node-branch-empty-user'))
    fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }))

    await waitFor(() => {
      expect(mocks.deleteAwaitingInputMessage).toHaveBeenCalledWith({
        params: { id: 'branch-empty-user' },
        query: { awaitingInputOnly: true }
      })
    })
    expect(toast.success).toHaveBeenCalledWith('common.delete_success')
  })

  it('starts a branch from an assistant node without an assistant follow-up', async () => {
    mocks.useQuery.mockReturnValue({
      data: {
        activeNodeId: 'user-2',
        nodes: [
          {
            id: 'user-1',
            parentId: null,
            role: 'user',
            preview: 'Question',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:00.000Z',
            hasChildren: true
          },
          {
            id: 'assistant-1',
            parentId: 'user-1',
            role: 'assistant',
            preview: 'Latest answer',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:01.000Z',
            hasChildren: true
          },
          {
            id: 'user-2',
            parentId: 'assistant-1',
            role: 'user',
            preview: 'Next question',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:02.000Z',
            hasChildren: false
          }
        ],
        siblingsGroups: []
      },
      error: undefined,
      isLoading: false,
      refetch: mocks.refetchTree
    })

    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    fireEvent.contextMenu(screen.getByTestId('topic-message-flow-node-assistant-1'))

    const branchButton = await screen.findByRole('button', { name: 'chat.message.new.branch.label' })
    fireEvent.click(branchButton)
    await waitFor(() => {
      expect(mocks.reserveBranch).toHaveBeenCalledWith({
        params: { id: 'assistant-1' },
        body: { activate: true }
      })
    })
    expect(await screen.findByRole('button', { name: 'chat.message.flow.copy_topic.label' })).toBeInTheDocument()
  })

  it('starts a branch from the active assistant node', async () => {
    mocks.useQuery.mockReturnValue({
      data: {
        activeNodeId: 'assistant-1',
        nodes: [
          {
            id: 'user-1',
            parentId: null,
            role: 'user',
            preview: 'Question',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:00.000Z',
            hasChildren: true
          },
          {
            id: 'assistant-1',
            parentId: 'user-1',
            role: 'assistant',
            preview: 'Latest answer',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:01.000Z',
            hasChildren: false
          }
        ],
        siblingsGroups: []
      },
      error: undefined,
      isLoading: false,
      refetch: mocks.refetchTree
    })

    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    fireEvent.contextMenu(screen.getByTestId('topic-message-flow-node-assistant-1'))

    const branchButton = await screen.findByRole('button', { name: 'chat.message.new.branch.label' })
    fireEvent.click(branchButton)
    await waitFor(() => {
      expect(mocks.reserveBranch).toHaveBeenCalledWith({
        params: { id: 'assistant-1' },
        body: { activate: true }
      })
    })
    expect(await screen.findByRole('button', { name: 'chat.message.flow.copy_topic.label' })).toBeInTheDocument()
  })

  it('hides the branch action for user nodes but keeps copy-as-topic available', async () => {
    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    fireEvent.contextMenu(screen.getByTestId('topic-message-flow-node-message-1'))

    expect(screen.queryByRole('button', { name: 'chat.message.new.branch.label' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.delete' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'chat.message.flow.copy_topic.label' })).toBeInTheDocument()
  })

  it('hides the branch action for the active node but keeps copy-as-topic available', async () => {
    mocks.useQuery.mockReturnValue({
      data: {
        activeNodeId: 'message-1',
        nodes: [
          {
            id: 'message-1',
            parentId: null,
            role: 'user',
            preview: 'Hello',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:00.000Z',
            hasChildren: false
          }
        ],
        siblingsGroups: []
      },
      error: undefined,
      isLoading: false,
      refetch: mocks.refetchTree
    })

    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    fireEvent.contextMenu(screen.getByTestId('topic-message-flow-node-message-1'))

    expect(screen.queryByRole('button', { name: 'chat.message.new.branch.label' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'chat.message.flow.copy_topic.label' })).toBeInTheDocument()
  })

  it('copies the right-clicked branch into a new topic', async () => {
    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    fireEvent.contextMenu(screen.getByTestId('topic-message-flow-node-message-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'chat.message.flow.copy_topic.label' }))

    await waitFor(() => {
      expect(mocks.copyBranchToNewTopic).toHaveBeenCalledWith({
        body: { nodeId: 'message-1' },
        params: { id: 'topic-1' }
      })
    })
    expect(toast.success).toHaveBeenCalledWith('chat.message.flow.copy_topic.created')
  })
})
