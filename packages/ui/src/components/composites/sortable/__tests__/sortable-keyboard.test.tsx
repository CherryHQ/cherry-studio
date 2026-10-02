// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Sortable from '../sortable'

const items = [{ id: 'alpha', label: 'Alpha' }]

describe('Sortable keyboard activation', () => {
  it('does not start dragging when IME completion keys originate from a nested input', () => {
    const onDragStart = vi.fn()

    render(
      <Sortable
        items={items}
        itemKey="id"
        onDragStart={onDragStart}
        onSortEnd={() => {}}
        renderItem={(item) => <input aria-label={`Rename ${item.label}`} />}
      />
    )

    const input = screen.getByRole('textbox', { name: 'Rename Alpha' })
    // userEvent does not expose composition-state keyboard events.
    fireEvent.keyDown(input, { code: 'Space', isComposing: true, key: ' ' })
    fireEvent.keyDown(input, { code: 'Enter', isComposing: true, key: 'Enter' })

    expect(onDragStart).not.toHaveBeenCalled()
  })

  it('starts dragging when Enter originates from the sortable row', async () => {
    const onDragStart = vi.fn()
    const user = userEvent.setup()

    render(
      <Sortable
        items={items}
        itemKey="id"
        onDragStart={onDragStart}
        onSortEnd={() => {}}
        renderItem={(item) => <span>{item.label}</span>}
      />
    )

    screen.getByRole('button', { name: 'Alpha' }).focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onDragStart).toHaveBeenCalledTimes(1))
  })
})
