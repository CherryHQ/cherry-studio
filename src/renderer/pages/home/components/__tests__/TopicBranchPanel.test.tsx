import { dataApiService } from '@data/DataApiService'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TopicBranchPanel from '../TopicBranchPanel'

const mocks = vi.hoisted(() => ({
  refetchTree: vi.fn(),
  setActiveNode: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@renderer/components/chat/messages/flow', () => ({
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
      nodes: tree.nodes.map((node: { id: string; preview?: string }) => ({
        id: node.id,
        data: { messageId: node.id, preview: node.preview, isOnActivePath: activePath.has(node.id) },
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
    if (!liveState?.nodes?.length) return tree
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
    onNodeSelect
  }: {
    graph: { nodes: { data: { messageId: string; preview?: string } }[] }
    onNodeSelect: (messageId: string) => void
  }) => (
    <div>
      {graph.nodes.map((node) => (
        <button
          key={node.data.messageId}
          type="button"
          data-testid={`topic-message-flow-node-${node.data.messageId}`}
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
})
