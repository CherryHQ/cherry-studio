import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, render, renderHook, screen } from '@testing-library/react'
import type * as XyFlowModule from '@xyflow/react'
import { Activity, type ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { useDataChange, useQuery } from '@data/hooks/useDataApi'
import type * as DataApiHooks from '@data/hooks/useDataApi'
import {
  buildTopicMessageFlowGraph,
  layoutTopicMessageFlowGraph,
  TOPIC_MESSAGE_FLOW_NODE_SIZE
} from '@renderer/components/chat/flow'
import type { TreeResponse } from '@shared/data/types/message'

import TopicBranchPanel from '../TopicBranchPanel'

type Viewport = { x: number; y: number; zoom: number }

const { setViewport, defaultViewports, flowInstances } = vi.hoisted(() => ({
  setViewport: vi.fn(),
  defaultViewports: [] as Viewport[],
  flowInstances: [] as object[]
}))

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof XyFlowModule>()
  const React = await import('react')
  return {
    ...actual,
    Controls: () => null,
    MiniMap: () => null,
    ReactFlow: ({
      children,
      defaultViewport,
      onInit
    }: {
      children: ReactNode
      defaultViewport: Viewport
      onInit: (instance: { setViewport: typeof setViewport }) => void
    }) => {
      defaultViewports.push(defaultViewport)
      const [instance] = React.useState(() => ({ setViewport }))
      React.useEffect(() => {
        flowInstances.push(instance)
        onInit(instance)
      }, [instance, onInit])
      return (
        <div data-testid="react-flow" data-default-viewport={JSON.stringify(defaultViewport)}>
          {children}
        </div>
      )
    }
  }
})

const canvasSize = { width: 800, height: 600 }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function makeTree(activeNodeId: string | null): TreeResponse {
  const nodes: TreeResponse['nodes'] = Array.from({ length: 12 }, (_, index) => ({
    id: `long-${index}`,
    parentId: index === 0 ? 'virtual-root' : `long-${index - 1}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    preview: `Long branch ${index}`,
    status: 'success',
    createdAt: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
    hasChildren: index < 11
  }))
  nodes.push({
    ...nodes[1],
    id: 'short-sibling',
    preview: 'Short sibling',
    hasChildren: false
  })
  return { activeNodeId, rootId: 'virtual-root', nodes, siblingsGroups: [] }
}

function getCenteredViewport(tree: TreeResponse, nodeId: string) {
  const layout = layoutTopicMessageFlowGraph(buildTopicMessageFlowGraph(tree))
  const node = layout.nodes.find((node) => node.id === nodeId)!
  const { width, height } = TOPIC_MESSAGE_FLOW_NODE_SIZE
  return {
    node,
    viewport: {
      x: canvasSize.width / 2 - (node.position.x + width / 2) * 0.85,
      y: canvasSize.height / 2 - (node.position.y + height / 2) * 0.85,
      zoom: 0.85
    }
  }
}

describe('TopicBranchPanel focus with the production graph and canvas', () => {
  let frames: Map<number, FrameRequestCallback>

  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    setViewport.mockClear()
    defaultViewports.length = 0
    flowInstances.length = 0
    frames = new Map()
    let nextFrame = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id)
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(canvasSize.width)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(canvasSize.height)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function flushFrame() {
    await act(async () => {})
    await act(async () => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((callback) => callback(0))
    })
  }

  it('T1 refocuses on the replacement branch after a superseded opening read rejects', async () => {
    const actual = await vi.importActual<typeof DataApiHooks>('@data/hooks/useDataApi')
    vi.mocked(useQuery).mockImplementation(actual.useQuery)
    vi.mocked(useDataChange).mockImplementation(actual.useDataChange)
    const cached = makeTree('long-11')
    const refreshed = makeTree('short-sibling')
    const opening = deferred<TreeResponse>()
    const replacement = deferred<TreeResponse>()
    const mutation = deferred<unknown>()
    const get = vi.mocked(dataApiService.get)
    get.mockReset()
    get.mockResolvedValue(cached)
    vi.mocked(dataApiService.put).mockReturnValueOnce(mutation.promise)
    const cache = new Map()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
    )
    const activeNode = renderHook(
      () =>
        actual.useMutation('PUT', '/topics/:id/active-node', {
          refresh: ['/topics/topic-1/messages', '/topics/topic-1/tree']
        }),
      { wrapper }
    )
    const pane = (open: boolean, focusKey: string) => (
      <Activity mode={open ? 'visible' : 'hidden'}>
        <TopicBranchPanel open={open} topicId="topic-1" focusKey={focusKey} />
      </Activity>
    )
    const { rerender } = render(pane(true, 'cycle:0'), { wrapper })
    await flushFrame()
    expect(setViewport).toHaveBeenLastCalledWith(getCenteredViewport(cached, 'long-11').viewport, { duration: 0 })
    const flow = screen.getByTestId('react-flow')
    const instance = flowInstances.at(-1)
    rerender(pane(false, 'cycle:0'))
    let pendingMutation!: Promise<unknown>
    await act(async () => {
      pendingMutation = activeNode.result.current.trigger({
        params: { id: 'topic-1' },
        body: { nodeId: 'short-sibling' }
      })
    })
    get.mockReset()
    get.mockReturnValueOnce(opening.promise).mockReturnValueOnce(replacement.promise)
    rerender(pane(true, 'cycle:1'))
    await flushFrame()
    expect(get).toHaveBeenCalledTimes(1)
    await act(async () => mutation.resolve({}))
    expect(get).toHaveBeenCalledTimes(2)
    await act(async () => opening.reject(new Error('Superseded opening read failed')))
    await flushFrame()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('react-flow')).toBe(flow)
    expect(flow).toBeVisible()
    expect(flowInstances.at(-1)).toBe(instance)
    const appliedBeforeReplacement = setViewport.mock.calls.length

    await act(async () => {
      replacement.resolve(refreshed)
      await pendingMutation
    })
    await flushFrame()
    const { node, viewport } = getCenteredViewport(refreshed, 'short-sibling')
    expect(setViewport).toHaveBeenLastCalledWith(viewport, { duration: 0 })
    expect(setViewport).toHaveBeenCalledTimes(appliedBeforeReplacement + 1)
    expect(setViewport.mock.calls.filter(([value]) => value.x === viewport.x && value.y === viewport.y)).toHaveLength(1)
    const applied = setViewport.mock.calls.at(-1)![0] as Viewport
    const left = node.position.x * applied.zoom + applied.x
    const top = node.position.y * applied.zoom + applied.y
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(left + TOPIC_MESSAGE_FLOW_NODE_SIZE.width * applied.zoom).toBeLessThanOrEqual(canvasSize.width)
    expect(top + TOPIC_MESSAGE_FLOW_NODE_SIZE.height * applied.zoom).toBeLessThanOrEqual(canvasSize.height)
    await flushFrame()
    await flushFrame()
    expect(setViewport).toHaveBeenCalledTimes(appliedBeforeReplacement + 1)
    expect(screen.getByTestId('react-flow')).toBe(flow)
    expect(flowInstances.every((value) => value === instance)).toBe(true)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('T2 refocuses once when rendered active changes within a consumed open cycle', async () => {
    const actual = await vi.importActual<typeof DataApiHooks>('@data/hooks/useDataApi')
    vi.mocked(useQuery).mockImplementation(actual.useQuery)
    vi.mocked(useDataChange).mockImplementation(actual.useDataChange)
    const cached = makeTree('long-11')
    const refreshed = makeTree('short-sibling')
    const replacement = deferred<TreeResponse>()
    const get = vi.mocked(dataApiService.get)
    get.mockReset()
    get.mockResolvedValue(cached)
    const cache = new Map()
    render(
      <Activity mode="visible">
        <TopicBranchPanel open topicId="topic-1" focusKey="cycle:0" />
      </Activity>,
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
        )
      }
    )
    await flushFrame()
    expect(setViewport).toHaveBeenCalledExactlyOnceWith(getCenteredViewport(cached, 'long-11').viewport, {
      duration: 0
    })
    const flow = screen.getByTestId('react-flow')
    const instance = flowInstances.at(-1)
    setViewport.mockClear()
    get.mockReset()
    get.mockReturnValueOnce(replacement.promise)
    await act(async () => {
      MockUseDataApiUtils.emitDataChange([{ endpoint: '/topics/:topicId/tree', routeParams: { topicId: 'topic-1' } }])
    })
    await flushFrame()
    expect(setViewport).not.toHaveBeenCalled()
    await act(async () => replacement.resolve(refreshed))
    await flushFrame()
    const { node, viewport } = getCenteredViewport(refreshed, 'short-sibling')
    expect(setViewport).toHaveBeenCalledExactlyOnceWith(viewport, { duration: 0 })
    const applied = setViewport.mock.calls.at(-1)![0] as Viewport
    const left = node.position.x * applied.zoom + applied.x
    const top = node.position.y * applied.zoom + applied.y
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(left + TOPIC_MESSAGE_FLOW_NODE_SIZE.width * applied.zoom).toBeLessThanOrEqual(canvasSize.width)
    expect(top + TOPIC_MESSAGE_FLOW_NODE_SIZE.height * applied.zoom).toBeLessThanOrEqual(canvasSize.height)
    expect(screen.getByTestId('react-flow')).toBe(flow)
    expect(flowInstances.at(-1)).toBe(instance)
    const previousViewport = flow.getAttribute('data-default-viewport')
    setViewport.mockClear()
    for (const preview of ['Updated sibling', 'Updated sibling again']) {
      const updated = structuredClone(refreshed)
      updated.nodes.find((value) => value.id === 'short-sibling')!.preview = preview
      get.mockResolvedValueOnce(updated)
      await act(async () => {
        MockUseDataApiUtils.emitDataChange([{ endpoint: '/topics/:topicId/tree', routeParams: { topicId: 'topic-1' } }])
      })
      await flushFrame()
      await flushFrame()
      expect(setViewport).not.toHaveBeenCalled()
      expect(screen.getByTestId('react-flow')).toBe(flow)
      expect(flow).toHaveAttribute('data-default-viewport', previousViewport)
      expect(flowInstances.every((value) => value === instance)).toBe(true)
    }
    expect(get).toHaveBeenCalledTimes(3)
  })

  // Mutation refresh bypasses the panel's notification reader and must not consume stale focus.
  it('waits for overlapping real SWR mutation invalidation before locating the new branch', async () => {
    const actual = await vi.importActual<typeof DataApiHooks>('@data/hooks/useDataApi')
    vi.mocked(useQuery).mockImplementation(actual.useQuery)
    vi.mocked(useDataChange).mockImplementation(actual.useDataChange)
    const cached = makeTree('long-11')
    const refreshed = makeTree('short-sibling')
    const opening = deferred<TreeResponse>()
    const replacement = deferred<TreeResponse>()
    const mutation = deferred<unknown>()
    const get = vi.mocked(dataApiService.get)
    get.mockReset()
    get.mockResolvedValue(cached)
    vi.mocked(dataApiService.put).mockReturnValueOnce(mutation.promise)
    const cache = new Map()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
    )
    const activeNode = renderHook(
      () =>
        actual.useMutation('PUT', '/topics/:id/active-node', {
          refresh: ['/topics/topic-1/messages', '/topics/topic-1/tree']
        }),
      { wrapper }
    )
    const pane = (open: boolean, focusKey: string) => (
      <Activity mode={open ? 'visible' : 'hidden'}>
        <TopicBranchPanel open={open} topicId="topic-1" focusKey={focusKey} />
      </Activity>
    )
    const { rerender } = render(pane(true, 'cycle:0'), { wrapper })
    await flushFrame()
    expect(setViewport).toHaveBeenLastCalledWith(getCenteredViewport(cached, 'long-11').viewport, { duration: 0 })
    const flow = screen.getByTestId('react-flow')
    const instance = flowInstances.at(-1)
    const previousViewport = flow.getAttribute('data-default-viewport')
    rerender(pane(false, 'cycle:0'))
    let pendingMutation!: Promise<unknown>
    await act(async () => {
      pendingMutation = activeNode.result.current.trigger({
        params: { id: 'topic-1' },
        body: { nodeId: 'short-sibling' }
      })
    })
    setViewport.mockClear()
    get.mockReset()
    get.mockReturnValueOnce(opening.promise).mockReturnValueOnce(replacement.promise)
    rerender(pane(true, 'cycle:1'))
    await flushFrame()
    expect(get).toHaveBeenCalledTimes(1)
    expect(
      setViewport.mock.calls.every(
        ([viewport]) => JSON.stringify(viewport) === JSON.stringify(getCenteredViewport(cached, 'long-11').viewport)
      )
    ).toBe(true)
    setViewport.mockClear()
    // The server has switched branches; mutation success now globally invalidates the tree.
    await act(async () => mutation.resolve({}))
    expect(get).toHaveBeenCalledTimes(2)
    await act(async () => opening.resolve(cached))
    await flushFrame()
    expect.soft(setViewport).not.toHaveBeenCalled()
    expect.soft(screen.getByTestId('react-flow')).toBe(flow)
    expect.soft(flowInstances.at(-1)).toBe(instance)
    expect.soft(flow).toHaveAttribute('data-default-viewport', previousViewport)

    await act(async () => {
      replacement.resolve(refreshed)
      await pendingMutation
    })
    await flushFrame()
    const { node, viewport } = getCenteredViewport(refreshed, 'short-sibling')
    expect(setViewport).toHaveBeenCalledExactlyOnceWith(viewport, { duration: 0 })
    expect(screen.getByTestId('react-flow')).toBe(flow)
    expect(flowInstances.at(-1)).toBe(instance)
    const applied = setViewport.mock.calls.at(-1)![0] as Viewport
    const left = node.position.x * applied.zoom + applied.x
    const top = node.position.y * applied.zoom + applied.y
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(left + TOPIC_MESSAGE_FLOW_NODE_SIZE.width * applied.zoom).toBeLessThanOrEqual(canvasSize.width)
    expect(top + TOPIC_MESSAGE_FLOW_NODE_SIZE.height * applied.zoom).toBeLessThanOrEqual(canvasSize.height)
  })

  // A synchronous read can settle without an observed validating frame and must not strand focus.
  it('releases unobserved-revalidation after a synchronous read settles while idle', async () => {
    const cached = makeTree('short-sibling')
    const refetch = vi.fn().mockResolvedValue(cached)
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: cached, isRefreshing: false, refetch })
    render(<TopicBranchPanel open topicId="topic-1" />)
    await flushFrame()
    expect(setViewport).toHaveBeenCalledExactlyOnceWith(getCenteredViewport(cached, 'short-sibling').viewport, {
      duration: 0
    })
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  // A discarded opening response must not consume the cycle before the notification read commits.
  it('waits for overlapping real SWR notification revalidation before locating the new branch', async () => {
    const actual = await vi.importActual<typeof DataApiHooks>('@data/hooks/useDataApi')
    vi.mocked(useQuery).mockImplementation(actual.useQuery)
    vi.mocked(useDataChange).mockImplementation(actual.useDataChange)
    const cached = makeTree('long-11')
    const refreshed = makeTree('short-sibling')
    const opening = deferred<TreeResponse>()
    const replacement = deferred<TreeResponse>()
    const get = vi.mocked(dataApiService.get)
    get.mockReset()
    get.mockResolvedValue(cached)
    const cache = new Map()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
    )
    const { rerender } = render(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:0" />, { wrapper })
    await flushFrame()
    expect(setViewport).toHaveBeenLastCalledWith(getCenteredViewport(cached, 'long-11').viewport, { duration: 0 })
    const flow = screen.getByTestId('react-flow')
    const previousViewport = flow.getAttribute('data-default-viewport')
    rerender(<TopicBranchPanel open={false} topicId="topic-1" focusKey="cycle:0" />)
    await flushFrame()
    setViewport.mockClear()
    defaultViewports.length = 0
    get.mockReset()
    get.mockReturnValueOnce(opening.promise).mockReturnValueOnce(replacement.promise)
    rerender(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:1" />)
    await flushFrame()
    expect(get).toHaveBeenCalledTimes(1)
    await act(async () => {
      MockUseDataApiUtils.emitDataChange([{ endpoint: '/topics/:topicId/tree', routeParams: { topicId: 'topic-1' } }])
    })
    expect(get).toHaveBeenCalledTimes(2)
    await act(async () => opening.resolve(cached))
    await flushFrame()
    expect.soft(setViewport).not.toHaveBeenCalled()
    expect.soft(screen.getByTestId('react-flow')).toBe(flow)
    expect.soft(flow).toHaveAttribute('data-default-viewport', previousViewport)

    await act(async () => replacement.resolve(refreshed))
    await flushFrame()
    const { node, viewport } = getCenteredViewport(refreshed, 'short-sibling')
    expect(setViewport).toHaveBeenCalledExactlyOnceWith(viewport, { duration: 0 })
    expect(setViewport.mock.calls.map(([value]) => value)).not.toContainEqual(
      getCenteredViewport(cached, 'long-11').viewport
    )
    expect(screen.getByTestId('react-flow')).toBe(flow)
    const applied = setViewport.mock.calls.at(-1)![0] as Viewport
    const left = node.position.x * applied.zoom + applied.x
    const top = node.position.y * applied.zoom + applied.y
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(left + TOPIC_MESSAGE_FLOW_NODE_SIZE.width * applied.zoom).toBeLessThanOrEqual(canvasSize.width)
    expect(top + TOPIC_MESSAGE_FLOW_NODE_SIZE.height * applied.zoom).toBeLessThanOrEqual(canvasSize.height)
  })

  // Cold opening must reuse SWR's initial read instead of starting another full tree request.
  it('uses one real SWR read on cold open and centers the active node', async () => {
    const actual = await vi.importActual<typeof DataApiHooks>('@data/hooks/useDataApi')
    vi.mocked(useQuery).mockImplementation(actual.useQuery)
    const initial = deferred<TreeResponse>()
    const get = vi.mocked(dataApiService.get)
    get.mockReset()
    get.mockReturnValue(initial.promise)
    const cache = new Map()
    render(<TopicBranchPanel open topicId="topic-1" />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
      )
    })
    await flushFrame()
    expect.soft(get).toHaveBeenCalledTimes(1)
    expect(setViewport).not.toHaveBeenCalled()
    const tree = makeTree('long-11')
    await act(async () => initial.resolve(tree))
    await flushFrame()
    expect(get).toHaveBeenCalledTimes(1)
    expect(setViewport).toHaveBeenCalledExactlyOnceWith(getCenteredViewport(tree, 'long-11').viewport, { duration: 0 })
  })

  // A deduped reopen must force its own fetch and never consume cached active A, even before data renders.
  it('forces one refresh per open cycle when automatic revalidation stays deduped', async () => {
    const initial = makeTree('long-0')
    const cached = makeTree('long-11')
    const refreshed = makeTree('short-sibling')
    const refresh = deferred<TreeResponse>()
    const refetch = vi.fn().mockResolvedValueOnce(initial).mockReturnValue(refresh.promise)
    const staleViewport = getCenteredViewport(cached, 'long-11').viewport
    const { node, viewport } = getCenteredViewport(refreshed, 'short-sibling')
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: initial, isRefreshing: false, refetch })
    const { rerender } = render(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:0" />)
    await flushFrame()
    const flow = screen.getByTestId('react-flow')
    const appliedCount = setViewport.mock.calls.length

    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: cached, isRefreshing: true, refetch })
    rerender(<TopicBranchPanel open={false} topicId="topic-1" focusKey="cycle:0" />)
    await flushFrame()
    expect.soft(refetch).toHaveBeenCalledTimes(1)
    rerender(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:1" />)
    await flushFrame()
    expect.soft(defaultViewports).not.toContainEqual(staleViewport)
    expect.soft(setViewport.mock.calls.map(([value]) => value)).not.toContainEqual(staleViewport)
    expect.soft(refetch).toHaveBeenCalledTimes(2)
    expect.soft(screen.getByTestId('react-flow')).toBe(flow)

    await act(async () => refresh.resolve(refreshed))
    await flushFrame()
    expect.soft(setViewport).toHaveBeenCalledTimes(appliedCount)
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: refreshed, isRefreshing: false, refetch })
    rerender(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:1" />)
    await flushFrame()
    expect(setViewport).toHaveBeenCalledTimes(appliedCount + 1)
    expect(setViewport).toHaveBeenLastCalledWith(viewport, { duration: 0 })
    expect(defaultViewports).not.toContainEqual(staleViewport)
    expect(setViewport.mock.calls.map(([value]) => value)).not.toContainEqual(staleViewport)
    expect(setViewport.mock.calls.filter(([value]) => value.x === viewport.x && value.y === viewport.y)).toHaveLength(1)
    const applied = setViewport.mock.calls.at(-1)![0] as Viewport
    const left = node.position.x * applied.zoom + applied.x
    const top = node.position.y * applied.zoom + applied.y
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(left + TOPIC_MESSAGE_FLOW_NODE_SIZE.width * applied.zoom).toBeLessThanOrEqual(canvasSize.width)
    expect(top + TOPIC_MESSAGE_FLOW_NODE_SIZE.height * applied.zoom).toBeLessThanOrEqual(canvasSize.height)
    expect(screen.getByTestId('react-flow')).toBe(flow)
    expect(refetch).toHaveBeenCalledTimes(2)
  })

  // Real SWR must bypass its five-second dedupe and keep cached data usable after a failed refresh.
  it('bypasses real SWR deduplication and returns rendered cache data even after a failed refresh', async () => {
    const { useQuery } = await vi.importActual<typeof DataApiHooks>('@data/hooks/useDataApi')
    const cached = makeTree('long-11')
    const refreshed = makeTree('short-sibling')
    const error = new Error('Tree refresh failed')
    const get = vi.mocked(dataApiService.get)
    get.mockReset()
    get
      .mockResolvedValueOnce(cached)
      .mockResolvedValueOnce(refreshed)
      .mockResolvedValueOnce(structuredClone(refreshed))
      .mockRejectedValueOnce(error)
    const cache = new Map()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
    )
    const query = renderHook(
      ({ open }) => useQuery('/topics/:topicId/tree', { enabled: open, params: { topicId: 'topic-1' } }),
      { initialProps: { open: true }, wrapper }
    )
    await act(async () => {})
    expect(query.result.current.data).toBe(cached)
    expect(get).toHaveBeenCalledTimes(1)
    query.rerender({ open: false })
    query.rerender({ open: true })
    await flushFrame()
    expect(query.result.current.isRefreshing).toBe(false)
    expect(query.result.current.data).toBe(cached)
    expect(get).toHaveBeenCalledTimes(1)

    for (const requestCount of [2, 3, 4]) {
      let committed: unknown
      await act(async () => {
        committed = await query.result.current.refetch()
      })
      expect(get).toHaveBeenCalledTimes(requestCount)
      expect(get).toHaveBeenLastCalledWith('/topics/topic-1/tree', { query: undefined })
      expect(query.result.current.data).toBe(committed)
      expect(query.result.current.data?.activeNodeId).toBe('short-sibling')
      expect(query.result.current.isRefreshing).toBe(false)
    }
    expect(query.result.current.error).toBe(error)
  })

  // Reopening must never consume the stale active A, and later updates must not steal the viewport.
  it('waits for the branch selected while hidden and stays stable after settling', async () => {
    const cached = makeTree('long-11')
    const refreshed = makeTree('short-sibling')
    const staleViewport = getCenteredViewport(cached, 'long-11').viewport
    const { node, viewport } = getCenteredViewport(refreshed, 'short-sibling')
    const refresh = deferred<TreeResponse>()
    const refetch = vi.fn().mockReturnValue(refresh.promise)
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: cached, isRefreshing: true, refetch })
    const { rerender } = render(<TopicBranchPanel open={false} topicId="topic-1" focusKey="cycle:0" />)
    await flushFrame()

    rerender(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:1" />)
    await flushFrame()
    expect(defaultViewports).not.toContainEqual(staleViewport)
    expect(setViewport.mock.calls.map(([value]) => value)).not.toContainEqual(staleViewport)
    expect(screen.queryByTestId('react-flow')).not.toBeInTheDocument()

    await act(async () => refresh.resolve(refreshed))
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: refreshed, isRefreshing: false, refetch })
    rerender(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:1" />)
    await flushFrame()
    expect(setViewport).toHaveBeenLastCalledWith(viewport, { duration: 0 })
    expect(setViewport).toHaveBeenCalledTimes(1)
    expect(defaultViewports).not.toContainEqual(staleViewport)
    expect(setViewport.mock.calls.map(([value]) => value)).not.toContainEqual(staleViewport)
    const applied = setViewport.mock.calls.at(-1)![0] as Viewport
    const left = node.position.x * applied.zoom + applied.x
    const top = node.position.y * applied.zoom + applied.y
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(left + TOPIC_MESSAGE_FLOW_NODE_SIZE.width * applied.zoom).toBeLessThanOrEqual(canvasSize.width)
    expect(top + TOPIC_MESSAGE_FLOW_NODE_SIZE.height * applied.zoom).toBeLessThanOrEqual(canvasSize.height)

    const flow = screen.getByTestId('react-flow')
    const viewSignature = flow.getAttribute('data-default-viewport')
    const appliedCount = setViewport.mock.calls.length
    // Active-change refocusing is covered by T2: "refocuses once when rendered active changes within a consumed open cycle".
    for (const isRefreshing of [true, false, true, false]) {
      const updated = makeTree('short-sibling')
      updated.nodes.find((node) => node.id === 'short-sibling')!.preview = `Updated sibling (${isRefreshing})`
      MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: updated, isRefreshing, refetch })
      rerender(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:1" />)
      await flushFrame()
      expect(setViewport).toHaveBeenCalledTimes(appliedCount)
      expect(screen.getByTestId('react-flow')).toBe(flow)
      expect(flow).toHaveAttribute('data-default-viewport', viewSignature)
      expect(refetch).toHaveBeenCalledTimes(1)
    }
  })

  // A pending cycle must preserve the mounted flow and the last applied viewport until it can refocus.
  it('keeps the previous viewport mounted while a new open cycle is pending', async () => {
    const cached = makeTree('long-11')
    const refresh = deferred<TreeResponse>()
    const refetch = vi.fn().mockResolvedValueOnce(cached).mockReturnValue(refresh.promise)
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: cached, refetch })
    const { rerender } = render(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:0" />)
    await flushFrame()
    const flow = screen.getByTestId('react-flow')
    const previousSignature = flow.getAttribute('data-default-viewport')
    const appliedCount = setViewport.mock.calls.length

    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: cached, isRefreshing: true, refetch })
    rerender(<TopicBranchPanel open={false} topicId="topic-1" focusKey="cycle:0" />)
    rerender(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:1" />)
    await flushFrame()
    expect(screen.getByTestId('react-flow')).toBe(flow)
    expect(flow).toHaveAttribute('data-default-viewport', previousSignature)
    expect(setViewport).toHaveBeenCalledTimes(appliedCount)

    const refreshed = makeTree('short-sibling')
    await act(async () => refresh.resolve(refreshed))
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: refreshed, refetch })
    rerender(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:1" />)
    await flushFrame()
    expect(setViewport).toHaveBeenCalledTimes(appliedCount + 1)
    expect(setViewport).toHaveBeenLastCalledWith(getCenteredViewport(refreshed, 'short-sibling').viewport, {
      duration: 0
    })
    expect(screen.getByTestId('react-flow')).toBe(flow)
  })

  // Refresh failures must keep the cached tree usable, including SWR's resolved-cache error path.
  it.each(['reject', 'cached-result', 'empty-result', 'uncommitted-result'] as const)(
    'falls back to cached active after a refresh %s',
    async (failure) => {
      const cached = makeTree('short-sibling')
      const refresh = deferred<TreeResponse | undefined>()
      const refetch = vi.fn().mockReturnValue(refresh.promise)
      MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: cached, refetch })
      const { rerender } = render(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:0" />)
      await flushFrame()
      expect(setViewport).not.toHaveBeenCalled()
      const error = new Error('Tree refresh failed')
      MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', {
        data: cached,
        error: failure === 'uncommitted-result' ? undefined : error,
        isRefreshing: false,
        refetch
      })
      await act(async () => {
        if (failure === 'reject') refresh.reject(error)
        else if (failure === 'uncommitted-result') refresh.resolve(makeTree('long-11'))
        else refresh.resolve(failure === 'cached-result' ? cached : undefined)
      })
      rerender(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:0" />)
      await flushFrame()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByTestId('react-flow')).toBeInTheDocument()
      expect(setViewport).toHaveBeenCalledExactlyOnceWith(getCenteredViewport(cached, 'short-sibling').viewport, {
        duration: 0
      })
      expect(refetch).toHaveBeenCalledTimes(1)
    }
  )

  // An earlier cycle completing must not release a later cycle's cached tree.
  it('ignores a superseded refresh and waits for the current focus key', async () => {
    const cached = makeTree('long-11')
    const earlier = deferred<TreeResponse>()
    const current = deferred<TreeResponse>()
    const refetch = vi.fn().mockReturnValueOnce(earlier.promise).mockReturnValueOnce(current.promise)
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: cached, refetch })
    const { rerender } = render(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:0" />)
    rerender(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:1" />)
    await act(async () => earlier.resolve(cached))
    await flushFrame()
    expect(setViewport).not.toHaveBeenCalled()
    const refreshed = makeTree('short-sibling')
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: refreshed, refetch })
    rerender(<TopicBranchPanel open topicId="topic-1" focusKey="cycle:1" />)
    await flushFrame()
    expect(setViewport).not.toHaveBeenCalled()
    await act(async () => current.resolve(refreshed))
    await flushFrame()
    expect(setViewport).toHaveBeenCalledExactlyOnceWith(getCenteredViewport(refreshed, 'short-sibling').viewport, {
      duration: 0
    })
    expect(refetch).toHaveBeenCalledTimes(2)
  })

  // Returning to docked layout before maximized refresh settles must start another cycle, not reuse old readiness.
  it('waits for a new refresh when the layout focus key returns to an earlier value', async () => {
    const initial = makeTree('long-0')
    const cached = makeTree('long-11')
    const refreshed = makeTree('short-sibling')
    const maximized = deferred<TreeResponse>()
    const docked = deferred<TreeResponse>()
    const refetch = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(maximized.promise)
      .mockReturnValueOnce(docked.promise)
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: initial, refetch })
    const { rerender } = render(<TopicBranchPanel open topicId="topic-1" focusKey="docked" />)
    await flushFrame()
    const flow = screen.getByTestId('react-flow')
    const appliedCount = setViewport.mock.calls.length
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: cached, refetch })
    rerender(<TopicBranchPanel open topicId="topic-1" focusKey="maximized" />)
    await flushFrame()
    rerender(<TopicBranchPanel open topicId="topic-1" focusKey="docked" />)
    await act(async () => maximized.resolve(cached))
    await flushFrame()
    expect(setViewport).toHaveBeenCalledTimes(appliedCount)
    expect(refetch).toHaveBeenCalledTimes(3)
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { data: refreshed, refetch })
    await act(async () => docked.resolve(refreshed))
    rerender(<TopicBranchPanel open topicId="topic-1" focusKey="docked" />)
    await flushFrame()
    expect(setViewport).toHaveBeenCalledTimes(appliedCount + 1)
    expect(setViewport).toHaveBeenLastCalledWith(getCenteredViewport(refreshed, 'short-sibling').viewport, {
      duration: 0
    })
    expect(screen.getByTestId('react-flow')).toBe(flow)
  })

  // An uncached first open still has to locate the active node after loading finishes.
  it('centers the active node after the first uncached query settles', async () => {
    const refresh = deferred<TreeResponse>()
    const refetch = vi.fn().mockReturnValue(refresh.promise)
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', { isLoading: true, refetch })
    const { rerender } = render(<TopicBranchPanel open topicId="topic-1" />)
    await flushFrame()
    expect(setViewport).not.toHaveBeenCalled()
    const tree = makeTree('long-11')
    await act(async () => refresh.resolve(tree))
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', {
      data: tree,
      refetch: vi.fn().mockResolvedValue(tree)
    })
    rerender(<TopicBranchPanel open topicId="topic-1" />)
    await flushFrame()
    expect(setViewport).toHaveBeenLastCalledWith(getCenteredViewport(tree, 'long-11').viewport, { duration: 0 })
  })

  // Missing active nodes must preserve the original root anchor rather than center the root vertically.
  it.each([null, 'missing-node'])('anchors the root when activeNodeId is %s', async (activeNodeId) => {
    const tree = makeTree(activeNodeId)
    MockUseDataApiUtils.mockQueryResult('/topics/:topicId/tree', {
      data: tree,
      refetch: vi.fn().mockResolvedValue(tree)
    })
    render(<TopicBranchPanel open topicId="topic-1" />)
    await flushFrame()
    const { node, viewport } = getCenteredViewport(tree, 'long-0')
    expect(setViewport).toHaveBeenLastCalledWith(
      { ...viewport, y: 64 - node.position.y * viewport.zoom },
      { duration: 0 }
    )
  })
})
