import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactFlowProps } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TopicMessageFlowCanvas from '../TopicMessageFlowCanvas'
import type { TopicMessageFlowEdgeModel, TopicMessageFlowGraph, TopicMessageFlowNodeModel } from '../types'

type FlowProps = ReactFlowProps<TopicMessageFlowNodeModel, TopicMessageFlowEdgeModel>
const flow = vi.hoisted(() => ({ props: null as FlowProps | null, setViewport: vi.fn() }))

vi.mock('@xyflow/react', async () => {
  const React = await import('react')
  return {
    Controls: () => <div data-testid="flow-controls" />,
    MiniMap: () => <div data-testid="flow-minimap" />,
    Position: { Left: 'left', Right: 'right' },
    ReactFlow: (props: FlowProps) => {
      flow.props = props
      const { onInit } = props
      React.useEffect(() => {
        onInit?.({ setViewport: flow.setViewport } as unknown as Parameters<NonNullable<FlowProps['onInit']>>[0])
      }, [onInit])
      return (
        <div data-testid="react-flow">
          {props.nodes?.map((node) => (
            <button
              type="button"
              key={node.id}
              onClick={(event) => props.onNodeClick?.(event, node)}
              onContextMenu={(event) => props.onNodeContextMenu?.(event, node)}>
              {node.id}
            </button>
          ))}
          {props.children}
        </div>
      )
    }
  }
})

const graph: TopicMessageFlowGraph = {
  activeNodeId: 'answer-a',
  nodes: [
    ['user-1', 'topic-root', 'user'],
    ['answer-a', 'user-1', 'assistant'],
    ['answer-b', 'user-1', 'assistant']
  ].map(([id, parentId, role]) => ({
    id: id,
    parentId,
    data: {
      messageId: id,
      role: role as TopicMessageFlowNodeModel['data']['role'],
      status: 'success',
      preview: id,
      createdAt: '2026-01-01T00:00:00Z',
      isActive: id === 'answer-a',
      isOnActivePath: id !== 'answer-b',
      isInactiveBranch: id === 'answer-b'
    }
  })),
  edges: [
    ['user-1', 'answer-a'],
    ['user-1', 'answer-b']
  ].map(([source, target]) => ({
    id: source + target,
    source,
    target,
    data: { isActivePath: target !== 'answer-b', isInactiveBranch: target === 'answer-b', isSiblingBranch: false }
  })),
  stats: { activePathLength: 2, branchCount: 2, nodeCount: 3 }
}

function node(id: string) {
  const found = flow.props?.nodes?.find((item) => item.id === id)
  if (!found) throw new Error('Missing canvas node ' + id)
  return found
}

describe('TopicMessageFlowCanvas', () => {
  beforeEach(() => {
    flow.props = null
    flow.setViewport.mockClear()
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  })
  afterEach(() => vi.restoreAllMocks())

  it('opens with the first message at the left and vertically centered', async () => {
    render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} />)
    await screen.findByTestId('react-flow')
    const viewport = flow.props!.defaultViewport!
    const root = node('user-1')
    const screenLeft = viewport.x + root.position.x * viewport.zoom
    const screenCenterY = viewport.y + (root.position.y + root.measured!.height! / 2) * viewport.zoom
    expect(screenLeft).toBeGreaterThanOrEqual(16)
    expect(screenLeft).toBeLessThanOrEqual(48)
    expect(screenCenterY).toBeCloseTo(300)
    expect(node('answer-a').position.x).toBeGreaterThan(root.position.x + root.width!)
    expect(screen.getByTestId('flow-controls')).toBeVisible()
    expect(screen.getByTestId('flow-minimap')).toBeVisible()
  })

  it('reflows siblings when a complete response grows taller', async () => {
    render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} />)
    await screen.findByTestId('react-flow')
    act(() =>
      flow.props!.onNodesChange!([{ id: 'answer-a', type: 'dimensions', dimensions: { width: 440, height: 900 } }])
    )
    expect(node('answer-b').position.y).toBeGreaterThan(node('answer-a').position.y + 900)
  })

  it('preserves the viewport when active branch and streamed content change', async () => {
    const { rerender } = render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} focusKey="topic-1" />)
    await waitFor(() => expect(flow.setViewport).toHaveBeenCalledTimes(1))
    const previousViewport = flow.props!.defaultViewport
    flow.setViewport.mockClear()
    rerender(
      <TopicMessageFlowCanvas
        graph={{
          ...graph,
          activeNodeId: 'answer-b',
          nodes: graph.nodes.map((item) => ({
            ...item,
            data: { ...item.data, preview: 'New streamed content' }
          }))
        }}
        onNodeSelect={vi.fn()}
        focusKey="topic-1"
      />
    )
    expect(flow.props!.defaultViewport).toEqual(previousViewport)
    expect(flow.setViewport).not.toHaveBeenCalled()
  })

  it('waits for the pane transition before mounting the canvas', async () => {
    const { rerender } = render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} layoutReady={false} />)
    expect(screen.queryByTestId('react-flow')).not.toBeInTheDocument()
    rerender(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} layoutReady />)
    expect(await screen.findByTestId('react-flow')).toBeVisible()
  })

  it('selects and opens menus for first messages and their response branches', async () => {
    let selection: string | undefined
    let menu: string | undefined
    render(
      <TopicMessageFlowCanvas
        graph={graph}
        onNodeSelect={(id) => {
          selection = id
        }}
        onNodeContextMenu={(id) => {
          menu = id
        }}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'user-1' }))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'user-1' }))
    expect(selection).toBe('user-1')
    expect(menu).toBe('user-1')
    fireEvent.click(screen.getByRole('button', { name: 'answer-b' }))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'answer-b' }))
    expect(selection).toBe('answer-b')
    expect(menu).toBe('answer-b')
  })

  it('keeps empty conversations out of React Flow', () => {
    render(<TopicMessageFlowCanvas graph={{ ...graph, nodes: [], edges: [] }} onNodeSelect={vi.fn()} />)
    expect(screen.getByTestId('topic-message-flow-empty')).toBeVisible()
    expect(screen.queryByTestId('react-flow')).not.toBeInTheDocument()
  })
})
