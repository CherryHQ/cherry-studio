import { installDndDomStubs } from '@test-mocks/dndDomStubs'
import { cancelRowDrag, dragRow, dropRow, hoverRow, startRowDrag } from '@test-mocks/dndDriver'
import { act, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const virtualMocks = vi.hoisted(() => ({
  useVirtualizer: vi.fn((options: { count: number; estimateSize: (index: number) => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: `row-${index}`,
        start: index * 40,
        size: options.estimateSize(index)
      })),
    getTotalSize: () => options.count * 40,
    getVirtualIndexes: vi.fn(() => Array.from({ length: options.count }, (_, index) => index)),
    measure: vi.fn(),
    measureElement: vi.fn(),
    resizeItem: vi.fn(),
    scrollElement: null,
    scrollToIndex: vi.fn(),
    scrollToOffset: vi.fn()
  }))
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: virtualMocks.useVirtualizer,
  defaultRangeExtractor: vi.fn((range) =>
    Array.from({ length: range.endIndex - range.startIndex + 1 }, (_, i) => range.startIndex + i)
  )
}))

import { GroupedSortableVirtualList } from '..'

type TestGroup = {
  id: string
  label: string
}

type TestItem = {
  id: string
  label: string
}

const groups = [
  {
    group: { id: 'first', label: 'First' },
    header: 'First',
    footer: 'First',
    items: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' }
    ]
  },
  {
    group: { id: 'second', label: 'Second' },
    header: 'Second',
    footer: 'Second',
    items: [{ id: 'c', label: 'Gamma' }]
  }
]

function renderList(onDragEnd = vi.fn(), extraProps = {}) {
  render(
    <GroupedSortableVirtualList<TestGroup, TestItem, string>
      groups={groups}
      getGroupId={(group) => group.id}
      getItemId={(item) => item.id}
      estimateGroupHeaderSize={() => 24}
      estimateItemSize={() => 40}
      renderGroupHeader={(header) => <div>Header {header}</div>}
      renderItem={(item) => <div>Item {item.label}</div>}
      onDragEnd={onDragEnd}
      {...extraProps}
    />
  )

  return onDragEnd
}

function getGroupRows(groupLabel: string, itemLabel: string, footerLabel: string) {
  return [
    screen.getByText(groupLabel).parentElement,
    screen.getByText(itemLabel).parentElement,
    screen.getByText(footerLabel).parentElement
  ]
}

function expectRowsBlocked(rows: Array<HTMLElement | null>) {
  for (const row of rows) {
    expect(row).toHaveAttribute('data-drop-blocked', 'true')
    expect(row).toHaveAttribute('data-drop-invalid', 'true')
    expect(row).not.toHaveAttribute('data-drop-allowed')
    expect(row).toHaveClass('cursor-not-allowed', 'opacity-50', '[&_*]:pointer-events-none')
  }
}

const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)))

function pointer(target: Element | Document, type: string, init: PointerEventInit) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', ...init })
    )
  })
}

async function pressAndMove(row: Element, init: PointerEventInit) {
  pointer(row, 'pointerdown', { clientX: 10, clientY: 10, ...init })
  pointer(document, 'pointermove', { clientX: 10, clientY: 40, ...init })
  await tick()
  pointer(document, 'pointerup', { clientX: 10, clientY: 40, ...init })
  await tick()
}

describe('GroupedSortableVirtualList', () => {
  beforeAll(installDndDomStubs)

  it.each([
    ['a secondary-button press', { button: 2 }],
    ['a macOS Control-click', { button: 0, ctrlKey: true }]
  ])('starts no pointer drag from %s, which opens a context menu', async (_, init) => {
    const onDragStart = vi.fn()
    renderList(vi.fn(), { onDragStart })

    await pressAndMove(screen.getByText('Item Alpha'), init)

    expect(onDragStart).not.toHaveBeenCalled()
  })

  it('starts a pointer drag from an unmodified primary-button press', async () => {
    const onDragStart = vi.fn()
    renderList(vi.fn(), { onDragStart })

    await pressAndMove(screen.getByText('Item Alpha'), { button: 0 })

    expect(onDragStart).toHaveBeenCalledWith(expect.objectContaining({ type: 'item', activeId: 'a' }))
  })

  it('emits same-group item drag payloads', async () => {
    const onDragEnd = renderList()

    await dragRow({ source: 'item:a', target: 'item:b', side: 'after' })

    expect(onDragEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        activeId: 'a',
        overId: 'b',
        overType: 'item',
        position: 'after',
        sourceGroupId: 'first',
        sourceIndex: 0,
        targetGroupId: 'first',
        targetIndex: 1,
        type: 'item'
      })
    )
  })

  it('uses the dragged row center to resolve before or after item drops', async () => {
    const onDragEnd = renderList()

    await dragRow({ source: 'item:a', target: 'item:b', side: 'before' })

    expect(onDragEnd).toHaveBeenCalledWith(expect.objectContaining({ overId: 'b', position: 'before' }))
  })

  it('appends an item dropped on another group header after that group last item', async () => {
    const onDragEnd = renderList()

    await dragRow({ source: 'item:a', target: 'group:second', side: 'before' })

    expect(onDragEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        activeId: 'a',
        overId: 'c',
        overType: 'item',
        position: 'after',
        sourceGroupId: 'first',
        targetGroupId: 'second',
        targetIndex: 0,
        type: 'item'
      })
    )
  })

  it('keeps the dragged row mounted while auto-scroll carries it out of view', async () => {
    renderList()
    const keptRows = () => {
      const { rangeExtractor } = virtualMocks.useVirtualizer.mock.lastCall![0] as {
        rangeExtractor?: (range: { startIndex: number; endIndex: number; overscan: number; count: number }) => number[]
      }
      return rangeExtractor?.({ startIndex: 5, endIndex: 6, overscan: 0, count: 7 }) ?? []
    }

    // Rows: header First, Alpha, Beta, footer, header Second, Gamma, footer.
    expect(keptRows()).not.toContain(1)
    await startRowDrag('item:a')
    expect(keptRows()).toContain(1)

    await cancelRowDrag()
    expect(keptRows()).not.toContain(1)
  })

  it('can emit group drag payloads when group dragging is enabled', async () => {
    const onDragEnd = renderList(vi.fn(), { dragCapabilities: { groups: true }, canDragGroup: () => true })

    await dragRow({ source: 'group:first', target: 'group:second', side: 'after' })

    expect(onDragEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        activeGroupId: 'first',
        overGroupId: 'second',
        overType: 'group',
        sourceIndex: 0,
        targetIndex: 1,
        type: 'group'
      })
    )
  })

  it('does not mark the active group as blocked during group dragging', async () => {
    renderList(vi.fn(), {
      dragCapabilities: { groups: true },
      canDragGroup: () => true,
      renderGroupFooter: (footer: unknown) => <div>Footer {String(footer)}</div>
    })

    await startRowDrag('group:first')

    const activeHeader = screen.getAllByText('Header First')[0].parentElement
    const activeItem = screen.getByText('Item Alpha').parentElement
    const activeFooter = screen.getByText('Footer First').parentElement

    for (const row of [activeHeader, activeItem, activeFooter]) {
      expect(row).not.toHaveAttribute('data-drop-blocked')
      expect(row).not.toHaveAttribute('data-drop-invalid')
    }
    await cancelRowDrag()
  })

  it('does not let a group header drag when group dragging is disabled', async () => {
    const onDragEnd = renderList(vi.fn(), { canDragGroup: () => true })

    await expect(startRowDrag('group:first')).rejects.toThrow('cannot be dragged')
    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it('blocks cross-group item drops when the capability is disabled', async () => {
    const onDragEnd = renderList(vi.fn(), { dragCapabilities: { itemCrossGroup: false } })

    await dragRow({ source: 'item:a', target: 'item:c', side: 'after' })

    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it('marks blocked groups as invalid while dragging and clears them after the drop', async () => {
    const onDragEnd = renderList(vi.fn(), {
      dragCapabilities: { itemCrossGroup: false },
      renderGroupFooter: (footer: unknown) => <div>Footer {String(footer)}</div>
    })

    await startRowDrag('item:a')
    expectRowsBlocked(getGroupRows('Header Second', 'Item Gamma', 'Footer Second'))

    await hoverRow('item:c', 'after')
    await dropRow()

    expect(onDragEnd).not.toHaveBeenCalled()
    for (const row of getGroupRows('Header Second', 'Item Gamma', 'Footer Second')) {
      expect(row).not.toHaveAttribute('data-drop-blocked')
      expect(row).not.toHaveAttribute('data-drop-invalid')
    }
  })

  it('renders a drag overlay for the active row while dragging', async () => {
    renderList(vi.fn(), { dragCapabilities: { itemCrossGroup: false } })

    await startRowDrag('item:a')

    expect(document.querySelector('[data-dnd-overlay]')).toHaveTextContent('Item Alpha')

    await cancelRowDrag()

    expect(document.querySelector('[data-dnd-overlay]')?.textContent ?? '').toBe('')
  })

  it('updates the insertion side while moving within the same target row', async () => {
    const onDragEnd = renderList()
    const indicator = (side: 'before' | 'after') =>
      screen.getByText('Item Alpha').parentElement?.querySelector(`[data-drop-indicator="${side}"]`)

    await startRowDrag('item:b')
    await hoverRow('item:a', 'after')
    expect(indicator('after')).toBeInTheDocument()

    await hoverRow('item:a', 'before')
    expect(indicator('before')).toBeInTheDocument()
    expect(indicator('after')).not.toBeInTheDocument()

    await dropRow()
    expect(onDragEnd).toHaveBeenCalledWith(expect.objectContaining({ activeId: 'b', overId: 'a', position: 'before' }))
  })

  it.each([
    { shape: 'footer', collision: false, endpoint: 'Footer B' },
    { shape: 'header-only', collision: false, endpoint: 'Header B' },
    { shape: 'footer', collision: true, endpoint: 'Footer B' }
  ])(
    'uses the inner group extent for $shape with boundary collision=$collision',
    async ({ shape, collision, endpoint }) => {
      const sectionGroups = [
        { group: { id: 'section:x', label: 'X' }, header: 'X', items: [] },
        { group: { id: 'inner:a', label: 'A' }, header: 'A', items: [{ id: 'a1', label: 'A1' }] },
        {
          group: { id: 'inner:b', label: 'B' },
          header: 'B',
          items: shape === 'header-only' ? [] : [{ id: 'b1', label: 'B1' }],
          footer: shape === 'footer' ? 'B' : undefined
        },
        { group: { id: 'inner:c', label: 'C' }, header: 'C', items: [{ id: 'c1', label: 'C1' }] },
        { group: { id: 'section:y', label: 'Y' }, header: 'Y', items: [] },
        { group: { id: 'inner:d', label: 'D' }, header: 'D', items: [{ id: 'd1', label: 'D1' }] }
      ]
      renderList(vi.fn(), {
        groups: sectionGroups,
        getGroupBoundaryId: (group: TestGroup) => {
          if (group.id === 'inner:d') return collision ? 'inner:b' : 'section:y'
          return group.id.startsWith('inner:') ? 'section:x' : group.id
        },
        dragCapabilities: { groups: true, items: false },
        canDragGroup: () => true,
        renderGroupFooter: (footer: unknown) => <div>Footer {String(footer)}</div>
      })
      await startRowDrag('group:inner:a')
      await hoverRow('group:inner:b', 'after')

      const indicators = document.querySelectorAll('[data-drop-indicator]')
      expect(indicators).toHaveLength(1)
      expect(indicators[0]).toHaveAttribute('data-drop-indicator', 'after')
      expect(indicators[0].parentElement).toBe(screen.getByText(endpoint).parentElement)
      await cancelRowDrag()
    }
  )

  it('keeps same-group item drops enabled independently from cross-group drops', async () => {
    const onDragEnd = renderList(vi.fn(), { dragCapabilities: { itemCrossGroup: false, itemSameGroup: true } })

    await dragRow({ source: 'item:a', target: 'item:b', side: 'after' })

    expect(onDragEnd).toHaveBeenCalledWith(expect.objectContaining({ sourceGroupId: 'first', targetGroupId: 'first' }))
  })

  it('keeps blocked groups stable while moving back to an allowed target', async () => {
    const onDragEnd = renderList(vi.fn(), {
      dragCapabilities: { itemCrossGroup: false, itemSameGroup: true },
      renderGroupFooter: (footer: unknown) => <div>Footer {String(footer)}</div>
    })

    await startRowDrag('item:a')
    expectRowsBlocked(getGroupRows('Header Second', 'Item Gamma', 'Footer Second'))

    await hoverRow('item:c', 'after')
    expectRowsBlocked(getGroupRows('Header Second', 'Item Gamma', 'Footer Second'))

    await hoverRow('item:b', 'after')

    const targetHeader = screen.getByText('Header First').parentElement
    const targetItem = screen.getByText('Item Beta').parentElement
    const targetFooter = screen.getByText('Footer First').parentElement

    expect(targetHeader).not.toHaveAttribute('data-drop-allowed')
    expect(targetItem).toHaveAttribute('data-drop-target', 'true')
    expect(targetItem).toHaveAttribute('data-drop-allowed', 'true')
    expect(targetItem).not.toHaveAttribute('data-drop-invalid')
    expect(targetFooter).not.toHaveAttribute('data-drop-allowed')
    expectRowsBlocked(getGroupRows('Header Second', 'Item Gamma', 'Footer Second'))

    await dropRow()

    expect(onDragEnd).toHaveBeenCalledWith(expect.objectContaining({ sourceGroupId: 'first', targetGroupId: 'first' }))
    for (const targetRow of [targetHeader, targetItem, targetFooter]) {
      expect(targetRow).not.toHaveAttribute('data-drop-target')
    }
    for (const row of getGroupRows('Header Second', 'Item Gamma', 'Footer Second')) {
      expect(row).not.toHaveAttribute('data-drop-blocked')
    }
  })

  it('keeps blocked group state over a blocked target and clears it on cancel', async () => {
    const onDragEnd = renderList(vi.fn(), {
      dragCapabilities: { itemCrossGroup: false },
      renderGroupFooter: (footer: unknown) => <div>Footer {String(footer)}</div>
    })

    await startRowDrag('item:a')
    const blockedRows = getGroupRows('Header Second', 'Item Gamma', 'Footer Second')
    expectRowsBlocked(blockedRows)

    await hoverRow('group:second', 'before')

    for (const row of blockedRows) {
      expect(row).not.toHaveAttribute('data-drop-target')
      expect(row).not.toHaveAttribute('data-drop-allowed')
    }
    expectRowsBlocked(blockedRows)

    await cancelRowDrag()

    expect(onDragEnd).not.toHaveBeenCalled()
    for (const targetRow of blockedRows) {
      expect(targetRow).not.toHaveAttribute('data-drop-blocked')
      expect(targetRow).not.toHaveAttribute('data-drop-invalid')
    }
  })

  it('emits nothing when Escape cancels a drag over an allowed target', async () => {
    const onDragEnd = renderList()

    await startRowDrag('item:a')
    await hoverRow('item:b', 'after')
    await cancelRowDrag()

    expect(onDragEnd).not.toHaveBeenCalled()
    expect(document.querySelector('[data-drop-indicator]')).toBeNull()
  })

  it('keeps non-draggable items available as drop targets', async () => {
    const onDragEnd = renderList(vi.fn(), {
      canDragItem: (item: TestItem) => item.id !== 'b',
      canDropItem: ({ overId }: { overId: unknown }) => overId === 'b'
    })

    await startRowDrag('item:a')
    await hoverRow('item:b', 'after')

    expect(
      screen.getByText('Item Beta').parentElement?.querySelector('[data-drop-indicator="after"]')
    ).toBeInTheDocument()
    await dropRow()
    expect(onDragEnd).toHaveBeenCalledWith(expect.objectContaining({ activeId: 'a', overId: 'b' }))
  })
})
