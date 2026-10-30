// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Sortable from '../sortable'

const items = [{ id: 'alpha', label: 'Alpha' }]

function holdTouch(target: Element) {
  const event = createEvent.touchStart(target)
  // jsdom's TouchEvent ignores the `touches` init value.
  Object.defineProperty(event, 'touches', { value: [{ clientX: 10, clientY: 10 }] })
  fireEvent(target, event)
  act(() => {
    vi.advanceTimersByTime(250)
  })
}

function renderRow(onDragStart: () => void) {
  render(
    <Sortable
      items={items}
      itemKey="id"
      onDragStart={onDragStart}
      onSortEnd={() => {}}
      renderItem={(item) => (
        <div>
          <span>{item.label}</span>
          <div data-no-dnd="true">
            <button type="button">Edit</button>
          </div>
        </div>
      )}
    />
  )
}

describe('Sortable touch activation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts dragging when the row is held', () => {
    const onDragStart = vi.fn()
    renderRow(onDragStart)

    holdTouch(screen.getByText('Alpha'))

    expect(onDragStart).toHaveBeenCalledTimes(1)
  })

  it('does not start dragging when a control marked data-no-dnd is held', () => {
    const onDragStart = vi.fn()
    renderRow(onDragStart)

    holdTouch(screen.getByRole('button', { name: 'Edit' }))

    expect(onDragStart).not.toHaveBeenCalled()
  })
})
