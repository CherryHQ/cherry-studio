// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useDraggable } from '@dnd-kit/react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { BUTTON_HANDLE_DRAG_SENSORS, DragDropRoot } from '../drag-drop-root'
import Sortable from '../sortable'
import { installDndDomStubs } from './dnd-dom-stubs'

const items = [{ id: 'a' }, { id: 'b' }]

const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

async function pressMoveRelease(target: Element, init: PointerEventInit) {
  const dispatch = (node: Element | Document, type: string, clientY: number) =>
    act(() => {
      node.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          isPrimary: true,
          button: 0,
          pointerType: 'mouse',
          clientX: 10,
          clientY,
          ...init
        })
      )
    })
  dispatch(target, 'pointerdown', 10)
  dispatch(document, 'pointermove', 40)
  await tick()
  dispatch(document, 'pointerup', 40)
  await tick()
}

describe('DragDropRoot', () => {
  beforeAll(installDndDomStubs)
  afterEach(cleanup)

  it('starts no drag from a Control-click, which macOS turns into a context menu', async () => {
    const onDragStart = vi.fn()
    render(
      <Sortable
        items={items}
        itemKey="id"
        onDragStart={onDragStart}
        onSortEnd={() => {}}
        renderItem={(item) => <div data-testid={`row-${item.id}`}>{item.id}</div>}
      />
    )

    await pressMoveRelease(screen.getByTestId('row-a'), { ctrlKey: true })
    expect(onDragStart).not.toHaveBeenCalled()

    await pressMoveRelease(screen.getByTestId('row-a'), {})
    expect(onDragStart).toHaveBeenCalledExactlyOnceWith({ activeId: 'a' })
  })

  it('keeps Enter as the click of a button handle and picks it up with Space', async () => {
    const onClick = vi.fn()
    const onDragStart = vi.fn()
    const user = userEvent.setup()

    function Row() {
      const { ref, handleRef } = useDraggable({ id: 'a', sensors: BUTTON_HANDLE_DRAG_SENSORS })
      return (
        <div ref={ref}>
          <button ref={handleRef} type="button" onClick={onClick}>
            Open
          </button>
        </div>
      )
    }

    render(
      <DragDropRoot onDragStart={onDragStart}>
        <Row />
      </DragDropRoot>
    )

    screen.getByRole('button', { name: 'Open' }).focus()
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledOnce()
    expect(onDragStart).not.toHaveBeenCalled()

    await user.keyboard(' ')
    await waitFor(() => expect(onDragStart).toHaveBeenCalledOnce())
  })
})
