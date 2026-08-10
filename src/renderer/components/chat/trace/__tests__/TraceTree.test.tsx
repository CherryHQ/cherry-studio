// @vitest-environment jsdom

import type { SpanEntity } from '@mcp-trace/trace-core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TRACE_ROW_HEIGHT } from '../traceNode'
import TraceTree, { getAnchoredTraceScrollTop, isTraceScrollAtBottom } from '../TraceTree'
import { TraceTreeModel } from '../TraceTreeModel'

const mocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  cachedKeys: [] as Array<string | number>,
  previousCount: -1,
  previousGetItemKey: null as ((index: number) => string | number) | null
}))

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: ({ startIndex, endIndex }: { startIndex: number; endIndex: number }) =>
    Array.from({ length: endIndex - startIndex + 1 }, (_, index) => startIndex + index),
  useVirtualizer: (options: {
    count: number
    estimateSize: () => number
    getItemKey: (index: number) => string | number
  }) => {
    const renderedCount = Math.min(options.count, 24)
    if (mocks.previousCount !== options.count || mocks.previousGetItemKey !== options.getItemKey) {
      mocks.cachedKeys = Array.from({ length: renderedCount }, (_, index) => options.getItemKey(index))
      mocks.previousCount = options.count
      mocks.previousGetItemKey = options.getItemKey
    }

    return {
      getTotalSize: () => options.count * options.estimateSize(),
      getVirtualItems: () =>
        Array.from({ length: renderedCount }, (_, index) => ({
          index,
          key: mocks.cachedKeys[index],
          start: index * options.estimateSize(),
          size: options.estimateSize()
        })),
      scrollToIndex: mocks.scrollToIndex
    }
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function span(
  id: string,
  parentId: string | null = null,
  startTime = 0,
  overrides: Partial<SpanEntity> = {}
): SpanEntity {
  return {
    id,
    traceId: 'trace-1',
    parentId,
    name: id,
    status: 'OK',
    startTime,
    endTime: startTime + 1,
    attributes: {},
    events: [],
    links: [],
    ...overrides
  } as SpanEntity
}

function renderTree(model: TraceTreeModel, handleClick = vi.fn(), handleToggle = vi.fn()) {
  return render(
    <TraceTree
      model={model}
      revision={model.lastMutation.revision}
      handleClick={handleClick}
      handleToggle={handleToggle}
    />
  )
}

describe('TraceTree', () => {
  beforeEach(() => {
    mocks.scrollToIndex.mockReset()
    mocks.cachedKeys = []
    mocks.previousCount = -1
    mocks.previousGetItemKey = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders duration, hierarchy, running state, and errors from virtual rows', () => {
    const model = new TraceTreeModel()
    model.reset([
      span('root', null, 1_000, { endTime: 3_000 }),
      span('running', 'root', 1_500, { endTime: null }),
      span('failed', 'root', 2_000, { status: 'ERROR', endTime: 2_500 })
    ])

    renderTree(model)

    expect(screen.getByText('root')).toBeInTheDocument()
    expect(screen.getByText('2.00s')).toBeInTheDocument()
    expect(screen.getByText('failed')).toHaveClass('text-destructive')
    expect(document.querySelector('[data-trace-row="running"]')).toBeInTheDocument()
  })

  it('keeps the rendered row count bounded for 50,000 spans', () => {
    const model = new TraceTreeModel()
    model.reset([
      span('root'),
      ...Array.from({ length: 50_000 }, (_, index) => span(`span-${index}`, 'root', index + 1))
    ])

    const view = renderTree(model)

    expect(view.container.querySelectorAll('[data-trace-row]')).toHaveLength(24)

    model.toggle('root')
    view.rerender(
      <TraceTree model={model} revision={model.lastMutation.revision} handleClick={vi.fn()} handleToggle={vi.fn()} />
    )
    expect(view.container.querySelectorAll('[data-trace-row]')).toHaveLength(1)

    view.unmount()
    expect(document.querySelectorAll('[data-trace-row]')).toHaveLength(0)
  })

  it('preserves row identity when visible nodes reorder without changing count', () => {
    const model = new TraceTreeModel()
    model.reset([span('root'), span('child-a', 'root', 1), span('child-b', 'root', 2)])
    const view = renderTree(model)
    const childB = screen.getByRole('treeitem', { name: 'child-b' })

    model.applySpanChanges([span('child-b', 'root', 0)])
    view.rerender(
      <TraceTree model={model} revision={model.lastMutation.revision} handleClick={vi.fn()} handleToggle={vi.fn()} />
    )

    expect(model.visibleRows.map((row) => row.id)).toEqual(['root', 'child-b', 'child-a'])
    expect(screen.getByRole('treeitem', { name: 'child-b' })).toBe(childB)
  })

  it('keeps long names inside the fixed-height row contract', () => {
    const longName = 'a very long trace node name '.repeat(20)
    const model = new TraceTreeModel()
    model.reset([span('root', null, 0, { name: longName })])
    renderTree(model)

    const row = screen.getByRole('treeitem', { name: longName })
    const label = screen.getByTitle(longName)

    // Fixed-height virtualization requires both the row and its text to clip instead of growing.
    expect(row).toHaveClass('h-8', 'overflow-hidden')
    expect(label).toHaveClass('truncate', 'whitespace-nowrap')
  })

  it('exposes tree semantics and moves the active node with the keyboard', async () => {
    const user = userEvent.setup()
    const model = new TraceTreeModel()
    model.reset([span('root'), span('child-a', 'root', 1), span('child-b', 'root', 2)])
    const handleClick = vi.fn()
    renderTree(model, handleClick)
    const tree = screen.getByRole('tree', { name: 'trace.label' })
    const root = screen.getByRole('treeitem', { name: 'root' })
    const childA = screen.getByRole('treeitem', { name: 'child-a' })

    expect(root).toHaveAttribute('aria-level', '1')
    expect(root).toHaveAttribute('aria-expanded', 'true')
    expect(childA).toHaveAttribute('aria-level', '2')
    expect(childA).not.toHaveAttribute('aria-expanded')

    tree.focus()
    expect(tree).toHaveAttribute('aria-activedescendant', root.id)

    await user.keyboard('{ArrowDown}')
    expect(tree).toHaveAttribute('aria-activedescendant', childA.id)
    expect(mocks.scrollToIndex).toHaveBeenLastCalledWith(1, { align: 'auto' })

    await user.keyboard('{ArrowLeft}')
    expect(tree).toHaveAttribute('aria-activedescendant', root.id)

    await user.keyboard('{ArrowRight}{Enter}')
    expect(tree).toHaveAttribute('aria-activedescendant', childA.id)
    expect(handleClick).toHaveBeenCalledWith('child-a')
  })

  it('delegates node selection and expansion without selecting on toggle', () => {
    const model = new TraceTreeModel()
    model.reset([span('root'), span('child', 'root', 1)])
    const handleClick = vi.fn()
    const handleToggle = vi.fn()
    renderTree(model, handleClick, handleToggle)
    const rootRow = document.querySelector('[data-trace-row="root"]') as HTMLElement

    fireEvent.click(within(rootRow).getByText('root'))
    expect(handleClick).toHaveBeenCalledWith('root')

    fireEvent.click(within(rootRow).getByRole('button', { name: 'common.collapse' }))
    expect(handleToggle).toHaveBeenCalledWith('root')
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('follows incremental rows only while the viewport is at the bottom', () => {
    const model = new TraceTreeModel()
    model.reset([span('root')])
    const view = renderTree(model)

    model.applySpanChanges([span('child', 'root', 1)])
    view.rerender(
      <TraceTree model={model} revision={model.lastMutation.revision} handleClick={vi.fn()} handleToggle={vi.fn()} />
    )

    expect(mocks.scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' })
  })

  it('preserves the top visible span when an incremental row is inserted above it', () => {
    const model = new TraceTreeModel()
    model.reset([span('root'), ...Array.from({ length: 30 }, (_, index) => span(`child-${index}`, 'root', index + 10))])
    const view = renderTree(model)
    const scroller = screen.getByTestId('trace-list-scroll')
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 320 },
      scrollHeight: { configurable: true, value: model.visibleRows.length * TRACE_ROW_HEIGHT }
    })
    scroller.scrollTop = 10 * TRACE_ROW_HEIGHT
    fireEvent.scroll(scroller)

    model.applySpanChanges([span('inserted', 'root', 1)])
    view.rerender(
      <TraceTree model={model} revision={model.lastMutation.revision} handleClick={vi.fn()} handleToggle={vi.fn()} />
    )

    expect(scroller.scrollTop).toBe(11 * TRACE_ROW_HEIGHT)
    expect(mocks.scrollToIndex).not.toHaveBeenCalled()
  })

  it('exposes fixed-row bottom and anchor calculations', () => {
    expect(isTraceScrollAtBottom({ clientHeight: 300, scrollHeight: 1_000, scrollTop: 695 })).toBe(true)
    expect(isTraceScrollAtBottom({ clientHeight: 300, scrollHeight: 1_000, scrollTop: 600 })).toBe(false)
    expect(getAnchoredTraceScrollTop({ id: 'span-1', offset: 7 }, 12)).toBe(12 * TRACE_ROW_HEIGHT + 7)
  })
})
