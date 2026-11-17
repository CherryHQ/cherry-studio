// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { KeyboardSensor, PointerSensor, useDragDropManager } from '@dnd-kit/react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReorderableList } from '../../reorderable-list'
import Sortable from '../sortable'
import { installDndDomStubs } from './dnd-dom-stubs'

type Item = { id: string }
type Manager = NonNullable<ReturnType<typeof useDragDropManager>>

const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
const manager: { current: Manager | null } = { current: null }

function ManagerProbe() {
  manager.current = useDragDropManager()
  return null
}

const renderRow = (item: Item) => (
  <div data-testid={`row-${item.id}`}>
    <ManagerProbe />
    {item.id}
  </div>
)

const rowOrder = () => [...document.querySelectorAll('[data-index]')].map((row) => row.textContent)
const tick = (ms = 0) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

function pointer(target: Element | Document, type: string, init: PointerEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        button: 0,
        pointerType: 'mouse',
        ...init
      })
    )
  })
}

function pressAndMove(target: Element, init: PointerEventInit = {}) {
  pointer(target, 'pointerdown', { clientX: 10, clientY: 10, ...init })
  pointer(document, 'pointermove', { clientX: 10, clientY: 40, ...init })
  return tick()
}

async function startKeyboardDrag(row: HTMLElement) {
  const activator = row.closest<HTMLElement>('[data-index]')!
  activator.focus()
  act(() => {
    activator.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'Space', key: ' ' }))
  })
  await tick()
}

// Awaiting setDropTarget inside act would deadlock: it resolves on the commit that act is holding back.
async function dropOver(id: string | null) {
  act(() => void manager.current?.actions.setDropTarget(id))
  await tick(10)
}

const stopDrag = (canceled = false) =>
  act(async () => {
    manager.current?.actions.stop({ canceled })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

describe('Sortable', () => {
  beforeAll(installDndDomStubs)

  beforeEach(() => {
    manager.current = null
  })

  afterEach(cleanup)

  describe('drop outcomes', () => {
    it('reports the move and keeps the new order when the consumer accepts the drop', async () => {
      const onSortEnd = vi.fn()

      function Accepting() {
        const [list, setList] = useState(items)
        return (
          <Sortable
            items={list}
            itemKey="id"
            renderItem={renderRow}
            onSortEnd={(move) => {
              onSortEnd(move)
              const next = [...list]
              next.splice(move.newIndex, 0, next.splice(move.oldIndex, 1)[0])
              setList(next)
            }}
          />
        )
      }

      render(<Accepting />)
      await startKeyboardDrag(screen.getByTestId('row-a'))
      await dropOver('c')
      expect(rowOrder()).toEqual(['b', 'c', 'a'])

      await stopDrag()

      expect(onSortEnd).toHaveBeenCalledExactlyOnceWith({ oldIndex: 0, newIndex: 2 })
      expect(rowOrder()).toEqual(['b', 'c', 'a'])
    })

    it('puts rows back in `items` order when the consumer rejects the drop', async () => {
      const onSortEnd = vi.fn()
      render(<Sortable items={items} itemKey="id" renderItem={renderRow} onSortEnd={onSortEnd} />)

      await startKeyboardDrag(screen.getByTestId('row-a'))
      await dropOver('c')
      await stopDrag()

      expect(onSortEnd).toHaveBeenCalledOnce()
      expect(rowOrder()).toEqual(['a', 'b', 'c'])
    })

    it('restores the order and reports no move when the drag is cancelled', async () => {
      const onSortEnd = vi.fn()
      const onDragCancel = vi.fn()
      const onDragEnd = vi.fn()
      render(
        <Sortable
          items={items}
          itemKey="id"
          renderItem={renderRow}
          onSortEnd={onSortEnd}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        />
      )

      await startKeyboardDrag(screen.getByTestId('row-a'))
      await dropOver('c')
      await stopDrag(true)

      expect(onDragCancel).toHaveBeenCalledOnce()
      expect(onDragEnd).not.toHaveBeenCalled()
      expect(onSortEnd).not.toHaveBeenCalled()
      expect(rowOrder()).toEqual(['a', 'b', 'c'])
    })

    it('commits the order on screen when the drop lands outside every row', async () => {
      const onSortEnd = vi.fn()
      render(<Sortable items={items} itemKey="id" renderItem={renderRow} onSortEnd={onSortEnd} />)

      await startKeyboardDrag(screen.getByTestId('row-a'))
      await dropOver('c')
      await dropOver(null)
      await stopDrag()

      expect(onSortEnd).toHaveBeenCalledExactlyOnceWith({ oldIndex: 0, newIndex: 2 })
    })

    it('ignores a dragover that arrives after the drop, while the drop is still rendering', async () => {
      render(<Sortable items={items} itemKey="id" renderItem={renderRow} onSortEnd={() => {}} />)
      await startKeyboardDrag(screen.getByTestId('row-a'))

      act(() => {
        manager.current?.actions.stop({ canceled: false })
        void manager.current?.actions.setDropTarget('c')
      })
      await tick(20)

      expect(rowOrder()).toEqual(['a', 'b', 'c'])
    })

    it('keeps the other rows in place when the dragged row leaves `items` before the first dragover', async () => {
      const props = { itemKey: 'id' as const, renderItem: renderRow, onSortEnd: () => {} }
      const { rerender } = render(<Sortable items={items} {...props} />)
      await startKeyboardDrag(screen.getByTestId('row-a'))

      rerender(<Sortable items={items.slice(1)} {...props} />)
      await dropOver('b')

      expect(rowOrder()).toEqual(['b', 'c'])
      await stopDrag(true)
    })

    it('lets a row return past the neighbour it just displaced', async () => {
      render(<Sortable items={items} itemKey="id" renderItem={renderRow} onSortEnd={() => {}} />)

      await startKeyboardDrag(screen.getByTestId('row-a'))
      await dropOver('b')
      expect(rowOrder()).toEqual(['b', 'a', 'c'])

      await dropOver('b')

      expect(rowOrder()).toEqual(['a', 'b', 'c'])
    })
  })

  describe('pointer activation', () => {
    function renderList(renderItem: (item: Item) => React.ReactNode, onDragStart = vi.fn()) {
      render(
        <Sortable items={items} itemKey="id" onDragStart={onDragStart} onSortEnd={() => {}} renderItem={renderItem} />
      )
      return onDragStart
    }

    it('starts a mouse drag from the row body after the movement threshold', async () => {
      const onDragStart = renderList(renderRow)

      await pressAndMove(screen.getByTestId('row-a'))

      expect(onDragStart).toHaveBeenCalledExactlyOnceWith({ activeId: 'a' })
      await stopDrag()
    })

    it('treats a slow click as a click', async () => {
      const onDragStart = renderList(renderRow)

      pointer(screen.getByTestId('row-a'), 'pointerdown', { clientX: 10, clientY: 10 })
      await tick(250)

      expect(onDragStart).not.toHaveBeenCalled()
      pointer(document, 'pointerup')
    })

    it('ignores a secondary button', async () => {
      const onDragStart = renderList(renderRow)

      await pressAndMove(screen.getByTestId('row-a'), { button: 2 })

      expect(onDragStart).not.toHaveBeenCalled()
      pointer(document, 'pointerup', { button: 2 })
    })

    it('starts no drag from a control inside the row, for mouse and touch', async () => {
      const onDragStart = renderList((item) => <button type="button">{`open ${item.id}`}</button>)
      const control = screen.getByRole('button', { name: 'open a' })

      await pressAndMove(control)
      pointer(document, 'pointerup')
      pointer(control, 'pointerdown', { pointerType: 'touch' })
      await tick(300)

      expect(onDragStart).not.toHaveBeenCalled()
      pointer(document, 'pointerup', { pointerType: 'touch' })
    })

    it('starts a drag from a button that is the row itself', async () => {
      const onDragStart = renderList((item) => (
        <button type="button" data-dnd-row-control>
          {`tile ${item.id}`}
        </button>
      ))

      await pressAndMove(screen.getByRole('button', { name: 'tile a' }))

      expect(onDragStart).toHaveBeenCalledOnce()
      await stopDrag()
    })

    it('starts no drag from a region marked data-no-dnd', async () => {
      const onDragStart = renderList((item) => (
        <div>
          <span>{item.id}</span>
          <div data-no-dnd data-testid={`region-${item.id}`} />
        </div>
      ))

      await pressAndMove(screen.getByTestId('region-a'))

      expect(onDragStart).not.toHaveBeenCalled()
      pointer(document, 'pointerup')
    })

    it('drags a nested row inside a data-no-dnd region without moving its parent row', async () => {
      const onOuterDragStart = vi.fn()
      const onInnerDragStart = vi.fn()
      render(
        <Sortable
          items={[{ id: 'group' }]}
          itemKey="id"
          onDragStart={onOuterDragStart}
          onSortEnd={() => {}}
          renderItem={() => (
            <div data-no-dnd>
              <Sortable
                items={[{ id: 'inner' }]}
                itemKey="id"
                onDragStart={onInnerDragStart}
                onSortEnd={() => {}}
                renderItem={(item) => <div data-testid={`nested-${item.id}`}>{item.id}</div>}
              />
            </div>
          )}
        />
      )

      await pressAndMove(screen.getByTestId('nested-inner'))

      expect(onInnerDragStart).toHaveBeenCalledOnce()
      expect(onOuterDragStart).not.toHaveBeenCalled()
      pointer(document, 'pointerup')
    })

    it('refuses to drag a row marked by isItemDragDisabled but still lets it take a drop', async () => {
      const onDragStart = vi.fn()
      render(
        <Sortable
          items={items}
          itemKey="id"
          isItemDragDisabled={(item) => item.id === 'b'}
          onDragStart={onDragStart}
          onSortEnd={() => {}}
          renderItem={renderRow}
        />
      )

      await pressAndMove(screen.getByTestId('row-b'))
      expect(onDragStart).not.toHaveBeenCalled()
      pointer(document, 'pointerup')

      await startKeyboardDrag(screen.getByTestId('row-b'))
      expect(onDragStart).not.toHaveBeenCalled()

      const row = manager.current!.registry
      expect(row.draggables.get('b')?.disabled).toBe(true)
      expect(row.droppables.get('b')?.disabled).toBe(false)

      await startKeyboardDrag(screen.getByTestId('row-a'))
      await dropOver('b')
      expect(rowOrder()).toEqual(['b', 'a', 'c'])
      await stopDrag(true)
    })

    it('keeps a drag-disabled row out of the tab order until it can drag again', async () => {
      const list = (disabledId: string | null) => (
        <Sortable
          items={items}
          itemKey="id"
          isItemDragDisabled={(item) => item.id === disabledId}
          onSortEnd={() => {}}
          renderItem={renderRow}
        />
      )
      const { rerender } = render(list('b'))
      await tick(50)

      const row = screen.getByTestId('row-b').closest('[data-index]')
      expect(row).toHaveAttribute('tabindex', '-1')
      expect(row).toHaveAttribute('role', 'group')

      rerender(list(null))
      await waitFor(() => expect(row).toHaveAttribute('tabindex', '0'))
      expect(row).toHaveAttribute('role', 'button')
    })

    it('requires a touch to hold before it drags', async () => {
      const onDragStart = renderList(renderRow)

      pointer(screen.getByTestId('row-a'), 'pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 })
      await tick(100)
      expect(onDragStart).not.toHaveBeenCalled()

      await tick(200)
      expect(onDragStart).toHaveBeenCalledOnce()
      await stopDrag()
    })

    it('gives up a touch that scrolls before the hold completes', async () => {
      const onDragStart = renderList(renderRow)

      pointer(screen.getByTestId('row-a'), 'pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 })
      pointer(document, 'pointermove', { pointerType: 'touch', clientX: 10, clientY: 60 })
      await tick(300)

      expect(onDragStart).not.toHaveBeenCalled()
      pointer(document, 'pointerup', { pointerType: 'touch' })
    })

    it('uses only the library sensors', async () => {
      render(<Sortable items={items} itemKey="id" onSortEnd={() => {}} renderItem={renderRow} />)
      await tick()

      const sensors = manager.current!.sensors.map((sensor) => sensor.constructor)

      expect(sensors).toEqual([PointerSensor, KeyboardSensor])
    })
  })

  describe('touch long-press on a row', () => {
    async function startTouchDrag(onRowPointerMove: () => void) {
      render(
        <Sortable
          items={items}
          itemKey="id"
          onSortEnd={() => {}}
          renderItem={(item) => (
            <div data-testid={`row-${item.id}`} onPointerMove={onRowPointerMove}>
              <ManagerProbe />
              {item.id}
            </div>
          )}
        />
      )

      pointer(screen.getByTestId('row-a'), 'pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 })
      await tick(300)
    }

    it('tells the row the gesture moved, which is what clears its long-press timer', async () => {
      const onRowPointerMove = vi.fn()
      await startTouchDrag(onRowPointerMove)

      await act(async () => {
        manager.current?.actions.move({ to: { x: 10, y: 80 } })
      })

      expect(onRowPointerMove).toHaveBeenCalledOnce()
      await stopDrag()
    })

    it('tells the row the gesture ended when the finger lifts without moving', async () => {
      const onRowPointerMove = vi.fn()
      await startTouchDrag(onRowPointerMove)

      await stopDrag()

      expect(onRowPointerMove).toHaveBeenCalledOnce()
    })

    it('leaves the timer running while the finger holds still, so the menu can still open', async () => {
      const onRowPointerMove = vi.fn()
      await startTouchDrag(onRowPointerMove)

      expect(onRowPointerMove).not.toHaveBeenCalled()
      await stopDrag(true)
    })
  })

  describe('window blur', () => {
    const blur = () => act(() => void window.dispatchEvent(new Event('blur')))

    it('cancels an active pointer drag and stops following the pointer', async () => {
      const onDragCancel = vi.fn()
      render(
        <Sortable items={items} itemKey="id" onDragCancel={onDragCancel} onSortEnd={() => {}} renderItem={renderRow} />
      )
      await pressAndMove(screen.getByTestId('row-a'))
      await dropOver('c')

      blur()
      await tick()

      expect(onDragCancel).toHaveBeenCalledOnce()
      expect(rowOrder()).toEqual(['a', 'b', 'c'])
    })

    it('cancels an active keyboard drag', async () => {
      const onDragCancel = vi.fn()
      render(
        <Sortable items={items} itemKey="id" onDragCancel={onDragCancel} onSortEnd={() => {}} renderItem={renderRow} />
      )
      await startKeyboardDrag(screen.getByTestId('row-a'))

      blur()
      await tick()

      expect(onDragCancel).toHaveBeenCalledOnce()
    })

    it('releases the keyboard sensor, so the next key is not swallowed', async () => {
      render(<Sortable items={items} itemKey="id" onSortEnd={() => {}} renderItem={renderRow} />)
      await startKeyboardDrag(screen.getByTestId('row-a'))

      blur()
      await tick()

      const keydown = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'Space', key: ' ' })
      act(() => void document.dispatchEvent(keydown))
      expect(keydown.defaultPrevented).toBe(false)
    })

    it('can start a new drag after a blur cancel', async () => {
      const onDragStart = vi.fn()
      render(
        <Sortable items={items} itemKey="id" onDragStart={onDragStart} onSortEnd={() => {}} renderItem={renderRow} />
      )
      await pressAndMove(screen.getByTestId('row-a'))
      blur()
      await tick(20)

      await pressAndMove(screen.getByTestId('row-b'))

      expect(onDragStart).toHaveBeenLastCalledWith({ activeId: 'b' })
      await stopDrag()
    })

    it('drops a press that has not activated yet, so a swallowed pointerup cannot start a drag', async () => {
      const onDragStart = vi.fn()
      render(
        <Sortable items={items} itemKey="id" onDragStart={onDragStart} onSortEnd={() => {}} renderItem={renderRow} />
      )

      pointer(screen.getByTestId('row-a'), 'pointerdown', { clientX: 10, clientY: 10 })
      blur()
      pointer(document, 'pointermove', { clientX: 10, clientY: 40 })
      await tick()

      expect(onDragStart).not.toHaveBeenCalled()
    })
  })

  describe('rendering', () => {
    it('marks only the overlay copy with overlay:true while dragging', async () => {
      const states: Array<{ dragging: boolean; overlay: boolean }> = []
      render(
        <Sortable
          items={items}
          itemKey="id"
          onSortEnd={() => {}}
          renderItem={(item, state) => {
            states.push(state)
            return renderRow(item)
          }}
        />
      )
      expect(states.every((state) => !state.overlay && !state.dragging)).toBe(true)

      await startKeyboardDrag(screen.getByTestId('row-a'))

      await waitFor(() => expect(states.some((state) => state.overlay)).toBe(true))
      expect(states.some((state) => state.dragging && !state.overlay)).toBe(true)
      await stopDrag(true)
    })

    it('routes activation to the handle in dragHandle mode', async () => {
      const onDragStart = vi.fn()
      render(
        <Sortable
          items={items}
          itemKey="id"
          dragHandle
          onDragStart={onDragStart}
          onSortEnd={() => {}}
          renderItem={(item, state) => (
            <div>
              <button type="button" ref={state.dragHandleProps?.ref}>{`handle ${item.id}`}</button>
              <span>{`label ${item.id}`}</span>
            </div>
          )}
        />
      )

      await pressAndMove(screen.getByText('label a'))
      expect(onDragStart).not.toHaveBeenCalled()
      pointer(document, 'pointerup')

      await pressAndMove(screen.getByRole('button', { name: 'handle a' }))
      expect(onDragStart).toHaveBeenCalledOnce()
    })

    it('announces through localized strings passed to ReorderableList', async () => {
      const accessibility = {
        screenReaderInstructions: { draggable: '拖动排序说明' },
        announcements: {
          onDragStart: ({ activeId }: { activeId: string | number }) => `已拿起 ${activeId}`,
          onDragOver: () => undefined,
          onDragEnd: ({ activeId }: { activeId: string | number }) => `已放下 ${activeId}`,
          onDragCancel: ({ activeId }: { activeId: string | number }) => `已取消 ${activeId}`
        }
      }
      render(
        <ReorderableList
          items={items}
          getId={(item) => item.id}
          onReorder={() => {}}
          accessibility={accessibility}
          renderItem={renderRow}
        />
      )
      await tick(50)

      await startKeyboardDrag(screen.getByTestId('row-a'))
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已拿起 a'))
      expect(document.body).toHaveTextContent('拖动排序说明')

      await stopDrag(true)
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已取消 a'))
    })
  })
})
