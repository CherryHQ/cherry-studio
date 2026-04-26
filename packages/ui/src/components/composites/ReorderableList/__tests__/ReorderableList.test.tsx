// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReorderableList } from '..'

const sortablePropsStore: { current?: any } = {}

vi.mock('../../Sortable', () => ({
  Sortable: ({ items, renderItem, ...props }: any) => {
    sortablePropsStore.current = props

    return (
      <div data-testid="sortable">
        {items.map((item: any, index: number) => (
          <div key={item.id}>{renderItem(item, { dragging: index === 1 })}</div>
        ))}
      </div>
    )
  }
}))

describe('ReorderableList', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
  const visibleItems = [items[0], items[2], items[4]]

  beforeEach(() => {
    sortablePropsStore.current = undefined
    vi.clearAllMocks()
  })

  it('renders only visible items and passes the visible index to renderItem', () => {
    render(
      <ReorderableList
        items={items}
        visibleItems={visibleItems}
        getId={(item) => item.id}
        onReorder={vi.fn()}
        renderItem={(item, index, state) => (
          <div>
            {item.id}:{index}:{state.dragging ? 'dragging' : 'idle'}
          </div>
        )}
      />
    )

    expect(screen.getByText('a:0:idle')).toBeInTheDocument()
    expect(screen.getByText('c:1:dragging')).toBeInTheDocument()
    expect(screen.getByText('e:2:idle')).toBeInTheDocument()
    expect(screen.queryByText(/b:/)).not.toBeInTheDocument()
  })

  it('reorders the full list when a visible subset is sorted', () => {
    const onReorder = vi.fn()

    render(
      <ReorderableList
        items={items}
        visibleItems={visibleItems}
        getId={(item) => item.id}
        onReorder={onReorder}
        renderItem={(item) => <div>{item.id}</div>}
      />
    )

    sortablePropsStore.current.onSortEnd({ oldIndex: 2, newIndex: 0 })

    expect(onReorder).toHaveBeenCalledWith([items[4], items[0], items[1], items[2], items[3]])
  })

  it('tracks drag state across start, end, and cancel', () => {
    const onDragStateChange = vi.fn()

    render(
      <ReorderableList
        items={items}
        getId={(item) => item.id}
        onReorder={vi.fn()}
        onDragStateChange={onDragStateChange}
        renderItem={(item) => <div>{item.id}</div>}
      />
    )

    sortablePropsStore.current.onDragStart()
    sortablePropsStore.current.onDragEnd()
    sortablePropsStore.current.onDragCancel()

    expect(onDragStateChange).toHaveBeenNthCalledWith(1, true)
    expect(onDragStateChange).toHaveBeenNthCalledWith(2, false)
    expect(onDragStateChange).toHaveBeenNthCalledWith(3, false)
  })

  it('does not reorder or emit drag state when disabled', () => {
    const onReorder = vi.fn()
    const onDragStateChange = vi.fn()

    render(
      <ReorderableList
        items={items}
        getId={(item) => item.id}
        onReorder={onReorder}
        onDragStateChange={onDragStateChange}
        disabled
        renderItem={(item) => <div>{item.id}</div>}
      />
    )

    sortablePropsStore.current.onDragStart()
    sortablePropsStore.current.onSortEnd({ oldIndex: 0, newIndex: 1 })

    expect(onReorder).not.toHaveBeenCalled()
    expect(onDragStateChange).not.toHaveBeenCalled()
  })
})
