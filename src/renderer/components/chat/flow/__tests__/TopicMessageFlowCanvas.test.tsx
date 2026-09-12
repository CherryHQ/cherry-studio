import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactFlowProps, Viewport } from '@xyflow/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TopicMessageFlowCanvas from '../TopicMessageFlowCanvas'
import type { TopicMessageFlowEdgeModel, TopicMessageFlowGraph, TopicMessageFlowNodeModel } from '../types'

type FlowProps = ReactFlowProps<TopicMessageFlowNodeModel, TopicMessageFlowEdgeModel>
const flow = vi.hoisted(() => ({ props: null as FlowProps | null, viewport: { x: 0, y: 0, zoom: 1 } }))

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
        onInit?.({
          setViewport: (viewport: Viewport) => {
            flow.viewport = viewport
            return Promise.resolve(true)
          },
          getViewport: () => flow.viewport
        } as unknown as Parameters<NonNullable<FlowProps['onInit']>>[0])
      }, [onInit])
      return (
        <div data-testid="react-flow">
          {props.nodes?.map((node) => (
            <button
              type="button"
              key={node.id}
              onClick={(event) => props.onNodeClick?.(event, node)}
              onDoubleClick={(event) => props.onNodeDoubleClick?.(event, node)}
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

async function findInitializedCanvas() {
  const canvas = await screen.findByTestId('react-flow')
  await waitFor(() => expect(flow.viewport.zoom).toBe(0.85))
  return canvas
}

async function measureNodeHeight(id: string, height: number) {
  act(() => flow.props!.onNodesChange!([{ id, type: 'dimensions', dimensions: { width: node(id).width!, height } }]))
  await act(async () => {
    await new Promise(window.requestAnimationFrame)
  })
}

describe('TopicMessageFlowCanvas', () => {
  beforeEach(() => {
    flow.props = null
    flow.viewport = { x: 0, y: 0, zoom: 1 }
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  })
  afterEach(() => vi.restoreAllMocks())

  it('opens with the first message at the left and vertically centered', async () => {
    render(<TopicMessageFlowCanvas graph={graph} onNodeActivate={vi.fn()} />)
    await findInitializedCanvas()
    const viewport = flow.viewport
    const root = node('user-1')
    const screenLeft = viewport.x + root.position.x * viewport.zoom
    const screenCenterY = viewport.y + (root.position.y + root.measured!.height! / 2) * viewport.zoom
    expect(screenLeft).toBeGreaterThanOrEqual(16)
    expect(screenLeft).toBeLessThanOrEqual(48)
    expect(screenCenterY).toBeCloseTo(300)
    expect(node('answer-a').position.x).toBeGreaterThan(root.position.x + root.width!)
  })

  it('keeps the first message centered as its loading placeholder and delayed body are measured', async () => {
    render(<TopicMessageFlowCanvas graph={graph} onNodeActivate={vi.fn()} />)
    await findInitializedCanvas()

    for (const height of [144, 420]) {
      await measureNodeHeight('user-1', height)
      const root = node('user-1')
      expect(flow.viewport.x + root.position.x * flow.viewport.zoom).toBeCloseTo(32)
      expect(flow.viewport.y + (root.position.y + height / 2) * flow.viewport.zoom).toBeCloseTo(300)
    }
  })

  it.each(['pointer', 'wheel', 'keyboard'])(
    'preserves the user viewport after %s input and later measurements',
    async (input) => {
      const user = userEvent.setup()
      render(<TopicMessageFlowCanvas graph={graph} onNodeActivate={vi.fn()} />)
      const canvas = await findInitializedCanvas()

      if (input === 'pointer') await user.pointer({ target: canvas, keys: '[MouseLeft]' })
      if (input === 'wheel') fireEvent.wheel(canvas, { deltaY: 120 })
      if (input === 'keyboard') {
        await user.tab()
        await user.keyboard('{ArrowDown}')
      }
      const userViewport = { x: -500, y: -200, zoom: 0.6 }
      flow.viewport = userViewport

      await measureNodeHeight('user-1', 420)
      expect(flow.viewport).toEqual(userViewport)
    }
  )

  it('centers the first message again when a new focus is requested after user interaction', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<TopicMessageFlowCanvas graph={graph} onNodeActivate={vi.fn()} focusKey="topic-1" />)
    await user.click(await findInitializedCanvas())
    flow.viewport = { x: -500, y: -200, zoom: 0.6 }
    await measureNodeHeight('user-1', 420)

    rerender(<TopicMessageFlowCanvas graph={graph} onNodeActivate={vi.fn()} focusKey="topic-2" />)
    await findInitializedCanvas()
    const root = node('user-1')
    expect(flow.viewport.y + (root.position.y + 210) * flow.viewport.zoom).toBeCloseTo(300)
    expect(flow.viewport.zoom).toBe(0.85)
  })

  it('reflows siblings when a complete response grows taller', async () => {
    render(<TopicMessageFlowCanvas graph={graph} onNodeActivate={vi.fn()} />)
    await findInitializedCanvas()
    act(() =>
      flow.props!.onNodesChange!([{ id: 'answer-a', type: 'dimensions', dimensions: { width: 440, height: 900 } }])
    )
    expect(node('answer-b').position.y).toBeGreaterThan(node('answer-a').position.y + 900)
  })

  it('preserves the viewport when active branch and streamed content change', async () => {
    const { rerender } = render(<TopicMessageFlowCanvas graph={graph} onNodeActivate={vi.fn()} focusKey="topic-1" />)
    await findInitializedCanvas()
    const previousViewport = { x: -500, y: -200, zoom: 0.6 }
    flow.viewport = previousViewport
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
        onNodeActivate={vi.fn()}
        focusKey="topic-1"
      />
    )
    await act(async () => {
      await new Promise(window.requestAnimationFrame)
    })
    expect(flow.viewport).toEqual(previousViewport)
  })

  it('waits for the pane transition before mounting the canvas', async () => {
    const { rerender } = render(<TopicMessageFlowCanvas graph={graph} onNodeActivate={vi.fn()} layoutReady={false} />)
    expect(screen.queryByTestId('react-flow')).not.toBeInTheDocument()
    rerender(<TopicMessageFlowCanvas graph={graph} onNodeActivate={vi.fn()} layoutReady />)
    expect(await screen.findByTestId('react-flow')).toBeVisible()
  })

  it('switches the conversation target when clicking a historical node', async () => {
    function Conversation() {
      const [activeBranch, setActiveBranch] = useState('answer-a')
      return (
        <>
          <output aria-label="Conversation branch">{activeBranch}</output>
          <TopicMessageFlowCanvas graph={graph} onNodeActivate={setActiveBranch} />
        </>
      )
    }
    const user = userEvent.setup()
    render(<Conversation />)
    const answer = await screen.findByRole('button', { name: 'answer-b' })
    await user.click(answer)
    expect(screen.getByLabelText('Conversation branch')).toHaveTextContent('answer-b')
  })

  it('brings a requested offscreen branch into view without changing the user zoom', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480)
    const { rerender } = render(<TopicMessageFlowCanvas graph={graph} onNodeActivate={() => {}} />)
    await findInitializedCanvas()
    flow.viewport = { x: -900, y: -900, zoom: 0.7 }
    rerender(<TopicMessageFlowCanvas graph={graph} onNodeActivate={() => {}} revealNodeId="answer-b" />)
    await waitFor(() => {
      const viewport = flow.viewport
      expect(viewport.zoom).toBe(0.7)
      const target = node('answer-b')
      const left = target.position.x * viewport.zoom + viewport.x
      const top = target.position.y * viewport.zoom + viewport.y
      expect(left).toBeGreaterThanOrEqual(0)
      expect(left + target.width! * viewport.zoom).toBeLessThanOrEqual(480)
      expect(top).toBeGreaterThanOrEqual(0)
      expect(top + target.measured!.height! * viewport.zoom).toBeLessThanOrEqual(600)
    })
    const revealedViewport = flow.viewport
    await measureNodeHeight('user-1', 420)
    expect(flow.viewport).toEqual(revealedViewport)
  })

  it('keeps empty conversations out of React Flow', () => {
    render(<TopicMessageFlowCanvas graph={{ ...graph, nodes: [], edges: [] }} onNodeActivate={vi.fn()} />)
    expect(screen.getByTestId('topic-message-flow-empty')).toBeVisible()
    expect(screen.queryByTestId('react-flow')).not.toBeInTheDocument()
  })
})
