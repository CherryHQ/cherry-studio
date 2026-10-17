import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterAll(() => {
  if (originalScrollIntoView) {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
})

const virtualMocks = vi.hoisted(() => ({
  useVirtualizer: vi.fn((options: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => options.count * 40,
    getVirtualIndexes: () => Array.from({ length: options.count }, (_, index) => index),
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: `row-${index}`,
        size: options.estimateSize(index),
        start: index * 40
      })),
    measure: vi.fn(),
    measureElement: vi.fn(),
    resizeItem: vi.fn(),
    scrollElement: null,
    scrollToIndex: vi.fn(),
    scrollToOffset: vi.fn()
  }))
}))

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: vi.fn((range) =>
    Array.from({ length: range.endIndex - range.startIndex + 1 }, (_, index) => range.startIndex + index)
  ),
  useVirtualizer: virtualMocks.useVirtualizer
}))

import { GroupedSortableVirtualList } from '..'

const groups = [{ group: { id: 'first' }, header: 'First', items: [{ id: 'alpha', label: 'Alpha' }] }]

type RenderListOptions = {
  draggableGroups?: boolean
  renderGroupHeader?: (header: string) => ReactNode
}

function renderList(
  renderItem: (item: { id: string; label: string }) => ReactNode,
  onDragStart = vi.fn(),
  { draggableGroups = false, renderGroupHeader }: RenderListOptions = {}
) {
  render(
    <GroupedSortableVirtualList
      groups={groups}
      getGroupId={(group) => group.id}
      getItemId={(item) => item.id}
      dragCapabilities={{ groups: draggableGroups }}
      estimateItemSize={() => 40}
      renderGroupHeader={renderGroupHeader}
      renderItem={renderItem}
      onDragEnd={() => {}}
      onDragStart={onDragStart}
    />
  )

  return onDragStart
}

describe('GroupedSortableVirtualList keyboard activation', () => {
  it('does not start dragging when IME completion keys originate from a nested input', () => {
    const onDragStart = renderList((item) => <input aria-label={`Rename ${item.label}`} />)

    const input = screen.getByRole('textbox', { name: 'Rename Alpha' })
    // userEvent does not expose composition-state keyboard events.
    fireEvent.keyDown(input, { code: 'Space', isComposing: true, key: ' ' })
    fireEvent.keyDown(input, { code: 'Enter', isComposing: true, key: 'Enter' })

    expect(onDragStart).not.toHaveBeenCalled()
  })

  it('starts dragging when Enter originates from the sortable row', async () => {
    const onDragStart = renderList((item) => <span>{item.label}</span>)
    const user = userEvent.setup()

    screen.getByRole('button', { name: 'Alpha' }).focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onDragStart).toHaveBeenCalledTimes(1))
  })

  it('does not start group dragging when IME completion keys originate from a nested input', () => {
    const onDragStart = renderList((item) => <span>{item.label}</span>, vi.fn(), {
      draggableGroups: true,
      renderGroupHeader: (header) => <input aria-label={`Rename ${header}`} />
    })

    const input = screen.getByRole('textbox', { name: 'Rename First' })
    // userEvent does not expose composition-state keyboard events.
    fireEvent.keyDown(input, { code: 'Space', isComposing: true, key: ' ' })
    fireEvent.keyDown(input, { code: 'Enter', isComposing: true, key: 'Enter' })

    expect(onDragStart).not.toHaveBeenCalled()
  })

  it('starts group dragging when Enter originates from the group row', async () => {
    const onDragStart = renderList((item) => <span>{item.label}</span>, vi.fn(), {
      draggableGroups: true,
      renderGroupHeader: (header) => <span>{header}</span>
    })
    const user = userEvent.setup()

    screen.getByRole('button', { name: 'First' }).focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onDragStart).toHaveBeenCalledTimes(1))
  })
})
