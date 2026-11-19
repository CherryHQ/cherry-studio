import type * as ReactVirtual from '@tanstack/react-virtual'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { GroupedSortableVirtualList } from '..'

vi.mock('@tanstack/react-virtual', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactVirtual>()),
  useVirtualizer: (options: { count: number; estimateSize: (index: number) => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: `row-${index}`,
        start: index * 40,
        size: options.estimateSize(index)
      })),
    getTotalSize: () => options.count * 40,
    measureElement: vi.fn()
  })
}))

function TestList({ itemsDraggable }: { itemsDraggable: boolean }) {
  const [selectedId, setSelectedId] = useState<string>()

  return (
    <GroupedSortableVirtualList
      groups={[{ group: { id: 'group' }, items: [{ id: 'alpha', label: 'Alpha' }] }]}
      getGroupId={(group) => group.id}
      getItemId={(item) => item.id}
      estimateItemSize={() => 40}
      dragCapabilities={{ items: itemsDraggable }}
      renderItem={(item) => (
        <div role="option" tabIndex={-1} aria-selected={selectedId === item.id} onClick={() => setSelectedId(item.id)}>
          {item.label}
        </div>
      )}
    />
  )
}

describe('GroupedSortableVirtualList drag affordance', () => {
  it('keeps non-draggable rows interactive without inherited drag semantics', async () => {
    const user = userEvent.setup()
    render(<TestList itemsDraggable={false} />)

    const row = screen.getByRole('option', { name: 'Alpha' })
    // The non-draggable wrapper has no semantic role to query.
    const wrapper = row.parentElement
    expect(wrapper).not.toHaveAttribute('aria-disabled', 'true')
    expect(wrapper).not.toHaveAttribute('role')
    expect(wrapper).not.toHaveAttribute('tabindex')
    expect(wrapper).not.toHaveAttribute('aria-roledescription')
    expect(wrapper).not.toHaveAttribute('aria-describedby')
    expect(row.closest('[aria-disabled="true"]')).toBeNull()

    await user.click(row)

    expect(screen.getByRole('option', { name: 'Alpha', selected: true })).toBeInTheDocument()
  })

  it('keeps draggable rows focusable with working keyboard drag semantics', async () => {
    const user = userEvent.setup()
    render(<TestList itemsDraggable />)

    const wrapper = screen.getByRole('button', { name: 'Alpha' })
    expect(wrapper).toHaveAttribute('aria-disabled', 'false')
    expect(wrapper).toHaveAttribute('tabindex', '0')
    expect(wrapper).toHaveAttribute('aria-roledescription', 'sortable')
    expect(wrapper).toHaveAttribute('aria-describedby')

    await user.tab()
    expect(wrapper).toHaveFocus()
    await user.keyboard('[Space]')
    expect(wrapper).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('[Escape]')
    expect(wrapper).not.toHaveAttribute('aria-pressed')
  })
})
