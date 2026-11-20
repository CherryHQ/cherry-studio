import type * as ReactVirtual from '@tanstack/react-virtual'
import { installDndDomStubs } from '@test-mocks/dndDomStubs'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

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

function ToggleList({ draggable }: { draggable: boolean }) {
  return (
    <GroupedSortableVirtualList
      groups={[{ group: { id: 'group' }, header: { id: 'group' }, items: [{ id: 'alpha', label: 'Alpha' }] }]}
      getGroupId={(group) => group.id}
      getItemId={(item) => item.id}
      estimateItemSize={() => 40}
      dragCapabilities={{ groups: draggable, items: draggable }}
      renderGroupHeader={() => <input aria-label="Header draft" />}
      renderItem={(item) => <input aria-label={`${item.label} draft`} />}
    />
  )
}

describe('GroupedSortableVirtualList drag affordance', () => {
  beforeAll(installDndDomStubs)

  it('keeps row content mounted while dragging turns off and back on', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ToggleList draggable />)
    const itemInput = screen.getByRole('textbox', { name: 'Alpha draft' })
    const headerInput = screen.getByRole('textbox', { name: 'Header draft' })
    await user.type(itemInput, 'item')
    await user.type(headerInput, 'header')

    rerender(<ToggleList draggable={false} />)
    rerender(<ToggleList draggable />)

    expect(screen.getByRole('textbox', { name: 'Alpha draft' })).toBe(itemInput)
    expect(screen.getByRole('textbox', { name: 'Header draft' })).toBe(headerInput)
    expect(itemInput).toHaveValue('item')
    expect(headerInput).toHaveValue('header')
  })

  it('removes drag semantics from a row that stops being draggable', async () => {
    const { rerender } = render(<ToggleList draggable />)
    const wrapper = screen.getByRole('textbox', { name: 'Alpha draft' }).parentElement
    await waitFor(() => expect(wrapper).toHaveAttribute('aria-roledescription'))

    rerender(<ToggleList draggable={false} />)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

    for (const name of ['role', 'tabindex', 'aria-roledescription', 'aria-describedby', 'aria-disabled']) {
      expect(wrapper).not.toHaveAttribute(name)
    }
  })

  it('keeps non-draggable rows interactive without inherited drag semantics', async () => {
    const user = userEvent.setup()
    render(<TestList itemsDraggable={false} />)

    const row = screen.getByRole('option', { name: 'Alpha' })
    // Drag attributes land on a scheduler tick, so let one pass before asserting they never arrive.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
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

    const wrapper = await screen.findByRole('button', { name: 'Alpha' })
    expect(wrapper).toHaveAttribute('aria-disabled', 'false')
    expect(wrapper).toHaveAttribute('tabindex', '0')
    expect(wrapper).toHaveAttribute('aria-roledescription')
    expect(wrapper).toHaveAttribute('aria-describedby')

    await user.tab()
    expect(wrapper).toHaveFocus()
    await user.keyboard('[Space]')
    await waitFor(() => expect(wrapper).toHaveAttribute('aria-pressed', 'true'))
    await user.keyboard('[Escape]')
    await waitFor(() => expect(wrapper).toHaveAttribute('aria-pressed', 'false'))
  })
})
