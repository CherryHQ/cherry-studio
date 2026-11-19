// @vitest-environment jsdom
import { DndContext, type PointerSensorProps, useDraggable, useSensor, useSensors } from '@dnd-kit/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlurCancelPointerSensor } from '../utils'

async function startDrag() {
  const callbacks = {
    onCancel: vi.fn<PointerSensorProps['onCancel']>(),
    onEnd: vi.fn<PointerSensorProps['onEnd']>(),
    onMove: vi.fn<PointerSensorProps['onMove']>()
  }

  class ObservedPointerSensor extends BlurCancelPointerSensor {
    constructor(props: PointerSensorProps) {
      super({
        ...props,
        onCancel: () => {
          callbacks.onCancel()
          props.onCancel()
        },
        onEnd: () => {
          callbacks.onEnd()
          props.onEnd()
        },
        onMove: (coordinates) => {
          callbacks.onMove(coordinates)
          props.onMove(coordinates)
        }
      })
    }
  }

  function DragTarget() {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: 'item-1' })
    return (
      <button ref={setNodeRef} {...attributes} {...listeners} data-dragging={isDragging}>
        Drag item
      </button>
    )
  }

  function Harness() {
    const sensors = useSensors(useSensor(ObservedPointerSensor))
    return (
      <DndContext sensors={sensors} autoScroll={false}>
        <DragTarget />
      </DndContext>
    )
  }

  render(<Harness />)
  const target = screen.getByRole('button', { name: 'Drag item' })
  const event = Object.assign(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }), {
    isPrimary: true,
    pointerId: 1,
    pointerType: 'mouse'
  })
  fireEvent(target, event)
  await waitFor(() => expect(target.getAttribute('data-dragging')).toBe('true'))
  return { callbacks, target }
}

describe('BlurCancelPointerSensor', () => {
  afterEach(() => {
    fireEvent(window, new Event('blur'))
    cleanup()
  })

  it('cancels the drag when the window loses focus before any pointerup', async () => {
    const { callbacks, target } = await startDrag()

    fireEvent(window, new Event('blur'))

    await waitFor(() => expect(target.getAttribute('data-dragging')).toBe('false'))
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
  })

  it('stops following the pointer after a blur cancel', async () => {
    const { callbacks, target } = await startDrag()
    callbacks.onMove.mockClear()

    fireEvent(window, new Event('blur'))
    fireEvent(document, new MouseEvent('pointermove', { bubbles: true, clientX: 200, clientY: 200 }))

    await waitFor(() => expect(target.getAttribute('data-dragging')).toBe('false'))
    expect(callbacks.onMove).not.toHaveBeenCalled()
  })

  it('leaves a completed drag alone when the window loses focus afterwards', async () => {
    const { callbacks, target } = await startDrag()

    fireEvent(document, new MouseEvent('pointerup', { bubbles: true }))
    await waitFor(() => expect(target.getAttribute('data-dragging')).toBe('false'))
    fireEvent(window, new Event('blur'))

    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
    expect(callbacks.onCancel).not.toHaveBeenCalled()
  })
})
