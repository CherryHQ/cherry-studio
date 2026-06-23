import { dataApiService } from '@data/DataApiService'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TopicBranchPanel from '../TopicBranchPanel'

const mocks = vi.hoisted(() => ({
  copyBranchToNewTopic: vi.fn().mockResolvedValue({ id: 'copied-topic' }),
  refetchTree: vi.fn(),
  setActiveNode: vi.fn().mockResolvedValue(undefined),
  startBranchDraft: vi.fn().mockResolvedValue(undefined),
  useQuery: vi.fn(),
  useMutation: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn()
  }
}))

vi.mock('@renderer/features/command', async () => {
  const React = await import('react')

  return {
    CommandContextMenu: ({
      children,
      getExtraItems,
      onOpenChange
    }: {
      children: React.ReactNode
      getExtraItems?: (event: React.MouseEvent) => Array<{ id: string; label?: string; onSelect?: () => void }>
      onOpenChange?: (open: boolean) => void
    }) => {
      const [items, setItems] = React.useState<Array<{ id: string; label?: string; onSelect?: () => void }>>([])
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

vi.mock('@renderer/components/chat/messages/flow', () => ({
  buildTopicMessageFlowGraph: vi.fn((tree) => {
    const parentById = new Map(
      tree.nodes.map((node: { id: string; parentId: string | null }) => [node.id, node.parentId])
    )
    const nodeById = new Map<string, { id: string; role?: string }>(
      tree.nodes.map((node: { id: string; role?: string }) => [node.id, node] as const)
    )
    const childrenById = new Map<string, string[]>()
    for (const node of tree.nodes as Array<{ id: string; parentId: string | null }>) {
      if (!node.parentId) continue
      childrenById.set(node.parentId, [...(childrenById.get(node.parentId) ?? []), node.id])
    }
    const hasAssistantDescendant = (messageId: string): boolean =>
      (childrenById.get(messageId) ?? []).some((childId) => {
        const child = nodeById.get(childId)
        return child?.role === 'assistant' || hasAssistantDescendant(childId)
      })
    const activePath = new Set<string>()
    let currentId = tree.activeNodeId
    while (currentId && parentById.has(currentId)) {
      activePath.add(currentId)
      currentId = parentById.get(currentId)
    }

    return {
      activeNodeId: tree.activeNodeId,
      edges: [],
      nodes: tree.nodes.map((node: { id: string; preview?: string; role?: string }) => ({
        id: node.id,
        data: {
          messageId: node.id,
          preview: node.preview,
          role: node.role,
          isOnActivePath: activePath.has(node.id),
          hasAssistantDescendant: hasAssistantDescendant(node.id)
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
    onNodeSelect
  }: {
    graph: { nodes: { data: { messageId: string; preview?: string } }[] }
    onNodeContextMenu?: (messageId: string) => void
    onNodeSelect: (messageId: string) => void
  }) => (
    <div>
      {graph.nodes.map((node) => (
        <button
          key={node.data.messageId}
          type="button"
          data-message-id={node.data.messageId}
          data-testid={`topic-message-flow-node-${node.data.messageId}`}
          onContextMenu={() => onNodeContextMenu?.(node.data.messageId)}
          onClick={() => onNodeSelect(node.data.messageId)}>
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
    ;(window as unknown as { toast: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> } }).toast = {
      error: vi.fn(),
      success: vi.fn()
    }
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
    mocks.useMutation.mockReturnValue({
      trigger: mocks.setActiveNode
    })
    mocks.useMutation.mockImplementation((_method: string, path: string) => {
      if (path === '/topics/:id/duplicate') {
        return { trigger: mocks.copyBranchToNewTopic }
      }
      return { trigger: mocks.setActiveNode }
    })
    vi.mocked(dataApiService.get).mockResolvedValue([{ id: 'message-1' }, { id: 'leaf-1' }])
  })

  it('renders the right-pane content and fetches the topic tree only while open', () => {
    render(<TopicBranchPanel open={true} topicId="topic-1" topicName="AI 聊天应用技术选型" />)

    expect(screen.getByText('AI 聊天应用技术选型')).toBeInTheDocument()
    expect(screen.getByText('2 chat.message.flow.branches')).toBeInTheDocument()
    expect(screen.getByText('1 chat.message.flow.nodes')).toBeInTheDocument()
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

  it('sets the active branch to the latest leaf passing through the selected node', async () => {
    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    fireEvent.click(screen.getByTestId('topic-message-flow-node-message-1'))

    await waitFor(() => {
      expect(dataApiService.get).toHaveBeenCalledWith('/topics/topic-1/path', {
        query: { nodeId: 'message-1' }
      })
    })
    expect(mocks.setActiveNode).toHaveBeenCalledWith({
      body: { nodeId: 'leaf-1' },
      params: { id: 'topic-1' }
    })
    expect(mocks.refetchTree).toHaveBeenCalled()
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
    expect(dataApiService.get).not.toHaveBeenCalled()
    expect(mocks.setActiveNode).not.toHaveBeenCalled()
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
    expect(dataApiService.get).not.toHaveBeenCalled()
    expect(mocks.setActiveNode).not.toHaveBeenCalled()
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

  it('starts a local branch draft from the right-clicked node without refreshing the tree', async () => {
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

    render(<TopicBranchPanel open={true} topicId="topic-1" onStartBranchDraft={mocks.startBranchDraft} />)

    fireEvent.contextMenu(screen.getByTestId('topic-message-flow-node-message-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'chat.message.new.branch.label' }))

    await waitFor(() => {
      expect(mocks.startBranchDraft).toHaveBeenCalledWith('message-1')
    })
    expect(dataApiService.get).not.toHaveBeenCalled()
    expect(mocks.setActiveNode).not.toHaveBeenCalled()
    expect(mocks.refetchTree).not.toHaveBeenCalled()
    expect(window.toast.success).toHaveBeenCalledWith('chat.message.new.branch.created')
  })

  it('cancels a branch draft and locates the anchor when the anchor is clicked', async () => {
    const onCancelBranchDraft = vi.fn()
    const onLocateMessage = vi.fn()
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
          }
        ],
        siblingsGroups: []
      },
      error: undefined,
      isLoading: false,
      refetch: mocks.refetchTree
    })

    render(
      <TopicBranchPanel
        open={true}
        topicId="topic-1"
        liveState={{
          topicId: 'topic-1',
          activeNodeId: 'branch-draft:assistant-old',
          nodes: [
            {
              id: 'branch-draft:assistant-old',
              parentId: 'assistant-old',
              role: 'user',
              preview: 'chat.message.flow.status.awaiting_input',
              modelId: null,
              status: 'paused',
              createdAt: '2026-05-22T00:00:02.000Z',
              isInputDraft: true
            }
          ]
        }}
        onCancelBranchDraft={onCancelBranchDraft}
        onLocateMessage={onLocateMessage}
      />
    )

    fireEvent.click(screen.getByTestId('topic-message-flow-node-assistant-old'))

    await Promise.resolve()

    expect(onCancelBranchDraft).toHaveBeenCalledWith('assistant-old')
    expect(onLocateMessage).toHaveBeenCalledWith('assistant-old')
    expect(dataApiService.get).not.toHaveBeenCalled()
    expect(mocks.setActiveNode).not.toHaveBeenCalled()
    expect(mocks.refetchTree).not.toHaveBeenCalled()
  })

  it('cancels a branch draft before switching to another real branch', async () => {
    const onCancelBranchDraft = vi.fn()
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
            id: 'assistant-other',
            parentId: 'user-1',
            role: 'assistant',
            preview: 'Other answer',
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
    vi.mocked(dataApiService.get).mockResolvedValueOnce([{ id: 'user-1' }, { id: 'assistant-other' }])

    render(
      <TopicBranchPanel
        open={true}
        topicId="topic-1"
        liveState={{
          topicId: 'topic-1',
          activeNodeId: 'branch-draft:assistant-old',
          nodes: [
            {
              id: 'branch-draft:assistant-old',
              parentId: 'assistant-old',
              role: 'user',
              preview: 'chat.message.flow.status.awaiting_input',
              modelId: null,
              status: 'paused',
              createdAt: '2026-05-22T00:00:02.000Z',
              isInputDraft: true
            }
          ]
        }}
        onCancelBranchDraft={onCancelBranchDraft}
      />
    )

    fireEvent.click(screen.getByTestId('topic-message-flow-node-assistant-other'))

    await waitFor(() => {
      expect(mocks.setActiveNode).toHaveBeenCalledWith({
        body: { nodeId: 'assistant-other' },
        params: { id: 'topic-1' }
      })
    })
    expect(onCancelBranchDraft).toHaveBeenNthCalledWith(1)
    expect(onCancelBranchDraft).toHaveBeenNthCalledWith(2, 'assistant-other')
    expect(onCancelBranchDraft).toHaveBeenNthCalledWith(3)
    expect(mocks.refetchTree).toHaveBeenCalled()
  })

  it('hides the branch action for the latest assistant node but keeps copy-as-topic available', async () => {
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
            preview: 'Draft next question',
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

    expect(screen.queryByRole('button', { name: 'chat.message.new.branch.label' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'chat.message.flow.copy_topic.label' })).toBeInTheDocument()
  })

  it('hides the branch action for user nodes but keeps copy-as-topic available', async () => {
    render(<TopicBranchPanel open={true} topicId="topic-1" />)

    fireEvent.contextMenu(screen.getByTestId('topic-message-flow-node-message-1'))

    expect(screen.queryByRole('button', { name: 'chat.message.new.branch.label' })).not.toBeInTheDocument()
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
    expect(window.toast.success).toHaveBeenCalledWith('chat.message.flow.copy_topic.created')
  })
})
