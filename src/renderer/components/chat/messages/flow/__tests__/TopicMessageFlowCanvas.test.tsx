import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TOPIC_MESSAGE_FLOW_NODE_TYPE, TopicMessageFlowCanvas, type TopicMessageFlowLayout } from '../index'
import type { TopicMessageFlowNodeModel } from '../types'

const { setViewportMock } = vi.hoisted(() => ({
  setViewportMock: vi.fn()
}))

vi.mock('@xyflow/react', async () => {
  const React = await import('react')

  return {
    Controls: (props: Record<string, unknown>) =>
      React.createElement('div', { 'data-position': props.position, 'data-testid': 'flow-controls' }),
    Handle: () => React.createElement('span', { 'data-testid': 'flow-handle' }),
    MiniMap: (props: Record<string, unknown>) =>
      React.createElement('div', {
        className: props.className as string,
        'data-bg-color': props.bgColor,
        'data-position': props.position,
        'data-testid': 'flow-minimap'
      }),
    Position: {
      Bottom: 'bottom',
      Top: 'top'
    },
    ReactFlow: ({
      children,
      defaultViewport,
      edges,
      fitView,
      fitViewOptions,
      maxZoom,
      minZoom,
      nodeTypes,
      nodes,
      nodesConnectable,
      nodesDraggable,
      onInit,
      onNodeClick,
      onNodeContextMenu,
      onlyRenderVisibleElements,
      proOptions
    }: {
      children: ReactNode
      defaultViewport?: { x: number; y: number; zoom: number }
      edges: unknown[]
      fitView?: boolean
      fitViewOptions?: { maxZoom?: number; padding?: number }
      maxZoom?: number
      minZoom?: number
      nodeTypes: Record<string, React.ComponentType<any>>
      nodes: TopicMessageFlowNodeModel[]
      nodesConnectable?: boolean
      nodesDraggable?: boolean
      onInit?: (instance: { setViewport: typeof setViewportMock }) => void
      onNodeClick?: (event: React.MouseEvent, node: TopicMessageFlowNodeModel) => void
      onNodeContextMenu?: (event: React.MouseEvent, node: TopicMessageFlowNodeModel) => void
      onlyRenderVisibleElements?: boolean
      proOptions?: { hideAttribution?: boolean }
    }) => {
      React.useEffect(() => {
        onInit?.({ setViewport: setViewportMock })
      }, [onInit])

      return React.createElement(
        'div',
        {
          'data-edges': edges.length,
          'data-default-x': defaultViewport?.x,
          'data-default-y': defaultViewport?.y,
          'data-default-zoom': defaultViewport?.zoom,
          'data-fit-view': fitView ? 'true' : 'false',
          'data-fit-view-max-zoom': fitViewOptions?.maxZoom,
          'data-fit-view-padding': fitViewOptions?.padding,
          'data-hide-attribution': proOptions?.hideAttribution ? 'true' : 'false',
          'data-max-zoom': maxZoom,
          'data-min-zoom': minZoom,
          'data-nodes-connectable': nodesConnectable ? 'true' : 'false',
          'data-nodes-draggable': nodesDraggable ? 'true' : 'false',
          'data-only-render-visible-elements': onlyRenderVisibleElements ? 'true' : 'false',
          'data-testid': 'react-flow'
        },
        nodes.map((node) => {
          const NodeComponent = nodeTypes[node.type ?? TOPIC_MESSAGE_FLOW_NODE_TYPE]

          return React.createElement(
            'div',
            {
              'data-testid': `flow-node-${node.data.messageId}`,
              key: node.id,
              onClick: (event: React.MouseEvent) => onNodeClick?.(event, node),
              onContextMenu: (event: React.MouseEvent) => onNodeContextMenu?.(event, node)
            },
            React.createElement(NodeComponent, {
              data: node.data,
              id: node.id,
              selected: node.selected ?? false
            })
          )
        }),
        children
      )
    }
  }
})

const graph: TopicMessageFlowLayout = {
  activeNodeId: 'assistant-1',
  edges: [
    {
      id: 'user-1-assistant-1',
      source: 'user-1',
      target: 'assistant-1',
      data: {
        isActivePath: true,
        isInactiveBranch: false,
        isSiblingBranch: false
      }
    }
  ],
  nodes: [
    {
      id: 'user-1',
      type: TOPIC_MESSAGE_FLOW_NODE_TYPE,
      position: { x: 0, y: 0 },
      data: {
        createdAt: '2026-01-01T00:00:00.000Z',
        isActive: false,
        isInactiveBranch: false,
        isOnActivePath: true,
        messageId: 'user-1',
        preview: 'Plan the topic branch',
        role: 'user',
        status: 'success'
      }
    },
    {
      id: 'assistant-1',
      type: TOPIC_MESSAGE_FLOW_NODE_TYPE,
      position: { x: 260, y: 120 },
      data: {
        createdAt: '2026-01-01T00:01:00.000Z',
        isActive: true,
        isInactiveBranch: false,
        isOnActivePath: true,
        messageId: 'assistant-1',
        modelId: 'openai/gpt-5-codex',
        preview: 'Here is the branch overview.',
        role: 'assistant',
        status: 'pending',
        siblingsGroupId: 2
      }
    }
  ],
  stats: {
    activePathLength: 2,
    branchCount: 1,
    nodeCount: 2
  }
}

describe('TopicMessageFlowCanvas', () => {
  let clientWidthSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    setViewportMock.mockClear()
    clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  })

  afterEach(() => {
    clientWidthSpy.mockRestore()
  })

  it('renders the read-only React Flow surface with custom nodes and overlays after measuring width', async () => {
    render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} />)

    expect(screen.queryByTestId('react-flow')).not.toBeInTheDocument()
    expect(await screen.findByTestId('react-flow')).toBeInTheDocument()
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-fit-view', 'false')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-default-x', '306.5')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-default-y', '64')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-default-zoom', '0.85')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-min-zoom', '0.08')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-max-zoom', '1.4')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-only-render-visible-elements', 'true')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-hide-attribution', 'true')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-nodes-draggable', 'false')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-nodes-connectable', 'false')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-edges', '1')
    expect(screen.getByTestId('flow-controls')).toBeInTheDocument()
    expect(screen.getByTestId('flow-minimap')).toHaveAttribute('data-bg-color', 'var(--color-card)')
    expect(screen.getByTestId('flow-minimap')).toHaveClass('border-border')
    expect(screen.getByTestId('topic-message-flow-legend')).toBeInTheDocument()
    expect(screen.getByText('Plan the topic branch')).toBeInTheDocument()
    expect(screen.getByText('gpt-5-codex')).toBeInTheDocument()
    expect(screen.queryByText('#2')).not.toBeInTheDocument()
  })

  it('starts with the root node centered horizontally near the top', async () => {
    render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} />)

    await waitFor(() => {
      expect(setViewportMock).toHaveBeenCalledWith({ x: 306.5, y: 64, zoom: 0.85 }, { duration: 0 })
    })
  })

  it('does not refocus the canvas when only node preview changes', async () => {
    const { rerender } = render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} />)

    await waitFor(() => expect(setViewportMock).toHaveBeenCalledTimes(1))
    setViewportMock.mockClear()

    rerender(
      <TopicMessageFlowCanvas
        graph={{
          ...graph,
          nodes: graph.nodes.map((node) =>
            node.id === 'assistant-1'
              ? { ...node, data: { ...node.data, preview: 'Streaming preview changed.' } }
              : node
          )
        }}
        onNodeSelect={vi.fn()}
      />
    )

    await screen.findByText('Streaming preview changed.')
    await new Promise((resolve) => window.requestAnimationFrame(resolve))

    expect(setViewportMock).not.toHaveBeenCalled()
  })

  it('keeps the current viewport when the graph changes under the same pane focus key', async () => {
    const { rerender } = render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} focusKey="docked:0" />)

    await waitFor(() => expect(setViewportMock).toHaveBeenCalledTimes(1))
    setViewportMock.mockClear()

    rerender(
      <TopicMessageFlowCanvas
        graph={{
          ...graph,
          edges: [
            ...graph.edges,
            {
              id: 'assistant-1-user-2',
              source: 'assistant-1',
              target: 'user-2',
              data: {
                isActivePath: true,
                isInactiveBranch: false,
                isSiblingBranch: false
              }
            }
          ],
          nodes: [
            {
              ...graph.nodes[0],
              position: { x: 96, y: 0 }
            },
            ...graph.nodes.slice(1),
            {
              id: 'user-2',
              type: TOPIC_MESSAGE_FLOW_NODE_TYPE,
              position: { x: 96, y: 240 },
              data: {
                createdAt: '2026-01-01T00:02:00.000Z',
                isActive: true,
                isInactiveBranch: false,
                isOnActivePath: true,
                messageId: 'user-2',
                preview: 'Continue from here.',
                role: 'user',
                status: 'success'
              }
            }
          ],
          activeNodeId: 'user-2',
          stats: {
            activePathLength: 3,
            branchCount: 1,
            nodeCount: 3
          }
        }}
        onNodeSelect={vi.fn()}
        focusKey="docked:0"
      />
    )

    await screen.findByText('Continue from here.')
    await new Promise((resolve) => window.requestAnimationFrame(resolve))

    expect(setViewportMock).not.toHaveBeenCalled()
  })

  it('waits for the pane layout before mounting React Flow', async () => {
    const { rerender } = render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} layoutReady={false} />)

    expect(screen.queryByTestId('react-flow')).not.toBeInTheDocument()

    rerender(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} layoutReady />)

    expect(await screen.findByTestId('react-flow')).toBeInTheDocument()
  })

  it('refocuses when the pane layout focus key changes', async () => {
    const { rerender } = render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} focusKey="docked:0" />)

    await waitFor(() => expect(setViewportMock).toHaveBeenCalledTimes(1))
    setViewportMock.mockClear()

    rerender(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} focusKey="docked:1" />)

    await waitFor(() => {
      expect(setViewportMock).toHaveBeenCalledWith({ x: 306.5, y: 64, zoom: 0.85 }, { duration: 0 })
    })
  })

  it('calls onNodeSelect with the clicked message id', async () => {
    const onNodeSelect = vi.fn()

    render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={onNodeSelect} />)

    fireEvent.click(await screen.findByTestId('flow-node-assistant-1'))

    expect(onNodeSelect).toHaveBeenCalledWith('assistant-1')
  })

  it('does not select input draft nodes', async () => {
    const onNodeSelect = vi.fn()

    render(
      <TopicMessageFlowCanvas
        graph={{
          ...graph,
          nodes: [
            ...graph.nodes,
            {
              id: 'branch-draft:assistant-1',
              type: TOPIC_MESSAGE_FLOW_NODE_TYPE,
              position: { x: 520, y: 240 },
              data: {
                createdAt: '2026-01-01T00:02:00.000Z',
                isActive: false,
                isInactiveBranch: false,
                isInputDraft: true,
                isOnActivePath: false,
                messageId: 'branch-draft:assistant-1',
                preview: 'chat.message.flow.status.awaiting_input',
                role: 'user',
                status: 'paused'
              }
            }
          ]
        }}
        onNodeSelect={onNodeSelect}
      />
    )

    fireEvent.click(await screen.findByTestId('flow-node-branch-draft:assistant-1'))

    expect(onNodeSelect).not.toHaveBeenCalled()
  })

  it('calls onNodeContextMenu with the right-clicked message id', async () => {
    const onNodeContextMenu = vi.fn()

    render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} onNodeContextMenu={onNodeContextMenu} />)

    fireEvent.contextMenu(await screen.findByTestId('flow-node-user-1'))

    expect(onNodeContextMenu).toHaveBeenCalledWith('user-1')
  })

  it('renders active error nodes with the error state marker', async () => {
    render(
      <TopicMessageFlowCanvas
        graph={{
          activeNodeId: 'error-1',
          edges: [],
          nodes: [
            {
              id: 'error-1',
              type: TOPIC_MESSAGE_FLOW_NODE_TYPE,
              position: { x: 0, y: 0 },
              data: {
                createdAt: '2026-01-01T00:02:00.000Z',
                isActive: true,
                isInactiveBranch: false,
                isOnActivePath: true,
                messageId: 'error-1',
                preview: 'Broken branch.',
                role: 'assistant',
                status: 'error'
              }
            }
          ],
          stats: {
            activePathLength: 1,
            branchCount: 0,
            nodeCount: 1
          }
        }}
        onNodeSelect={vi.fn()}
      />
    )

    const errorNode = (await screen.findByText('Broken branch.')).closest('[data-message-id="error-1"]')

    expect(errorNode).toHaveAttribute('data-active', 'true')
    expect(errorNode?.querySelector('.bg-destructive')).toBeInTheDocument()
  })
})
