import type { DragDropManager } from '@dnd-kit/dom'
import { useDragDropManager } from '@dnd-kit/react'
import { act } from '@testing-library/react'
import { type ComponentProps, useEffect } from 'react'

import { DragDropRoot } from '@cherrystudio/ui/components/composites/sortable/drag-drop-root'

import { installDndDomStubs } from './dndDomStubs'

/**
 * Drives real `@dnd-kit/react` drags in jsdom for lists rendered under `DragDropRoot`.
 * The renderer setup mocks `@cherrystudio/ui` with `DragDropRootWithTestDriver`, so any list can be driven.
 */

const managers = new Set<DragDropManager>()

function ManagerProbe() {
  const manager = useDragDropManager() as DragDropManager | null
  useEffect(() => {
    if (!manager) return
    managers.add(manager)
    return () => {
      managers.delete(manager)
    }
  }, [manager])
  return null
}

export function DragDropRootWithTestDriver({ children, ...props }: ComponentProps<typeof DragDropRoot>) {
  return (
    <DragDropRoot {...props}>
      <ManagerProbe />
      {children}
    </DragDropRoot>
  )
}

function managerFor(id: string) {
  for (const manager of managers) {
    if (manager.registry.draggables.get(id) || manager.registry.droppables.get(id)) return manager
  }
  throw new Error(`No drag-and-drop row registered as ${id}`)
}

function activeManager() {
  for (const manager of managers) {
    if (!manager.dragOperation.status.idle) return manager
  }
  throw new Error('No drag in progress')
}

// jsdom has no layout. The dragged row sits at 200–240px; a target is placed above or below it
// so that the dragged row's center lands on the requested side of the target's center.
const SOURCE_RECT = new DOMRect(0, 200, 240, 40)
const rects = new Map<Element, DOMRect>()
let restoreLayout: (() => void) | null = null

function placeRect(element: Element, rect: DOMRect) {
  rects.set(element, rect)
  if (restoreLayout) return
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.hasAttribute('data-dnd-overlay')) return SOURCE_RECT
    return rects.get(this) ?? original.call(this)
  }
  restoreLayout = () => {
    Element.prototype.getBoundingClientRect = original
    rects.clear()
    restoreLayout = null
  }
}

const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)))

let activator: HTMLElement | null = null

function pressKey(target: Element, code: 'Space' | 'Escape') {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code, key: code === 'Space' ? ' ' : code })
    )
  })
}

/** Picks a row up with the keyboard, as a user would with Space. */
export async function startRowDrag(sourceId: string) {
  installDndDomStubs()
  const manager = managerFor(sourceId)
  const draggable = manager.registry.draggables.get(sourceId)
  const element = draggable?.handle ?? draggable?.element
  if (!(element instanceof HTMLElement)) throw new Error(`Row ${sourceId} cannot be dragged`)

  if (draggable?.element) placeRect(draggable.element, SOURCE_RECT)
  activator = element
  element.focus()
  pressKey(element, 'Space')
  await tick()
  if (!manager.dragOperation.status.dragging) throw new Error(`Row ${sourceId} did not start dragging`)
}

/** Moves the active drag over a row, landing before or after its center. */
export async function hoverRow(targetId: string, side: 'before' | 'after') {
  const manager = activeManager()
  const droppable = manager.registry.droppables.get(targetId)
  if (!droppable?.element) throw new Error(`No drop target registered as ${targetId}`)

  placeRect(droppable.element, new DOMRect(0, side === 'before' ? 240 : 160, 240, 40))
  act(() => {
    ;(droppable as typeof droppable & { refreshShape: () => void }).refreshShape()
    // Awaiting setDropTarget inside act would deadlock: it resolves on the commit that act is holding back.
    void manager.actions.setDropTarget(targetId)
  })
  await tick()
}

export async function dropRow() {
  activeManager()
  pressKey(activator ?? document.body, 'Space')
  await tick()
  restoreLayout?.()
}

export async function cancelRowDrag() {
  activeManager()
  pressKey(activator ?? document.body, 'Escape')
  await tick()
  restoreLayout?.()
}

export async function dragRow({ source, target, side }: { source: string; target: string; side: 'before' | 'after' }) {
  await startRowDrag(source)
  await hoverRow(target, side)
  await dropRow()
}
