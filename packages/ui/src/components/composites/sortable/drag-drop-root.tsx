import type { Draggable } from '@dnd-kit/dom'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import { DragDropProvider, KeyboardSensor, PointerSensor, useDragDropManager } from '@dnd-kit/react'
import { type ComponentProps, useEffect, useRef } from 'react'

function preventActivation(event: PointerEvent, source: Draggable) {
  // macOS turns Control-click into a context menu.
  if (event.ctrlKey) return true
  // PointerSensor checks that the target is an Element before it calls this.
  const target = event.target as Element
  // A nested list inside the marked region stays draggable: the marker only guards rows that contain it.
  const noDnd = target.closest('[data-no-dnd]')
  if (noDnd && source.element?.contains(noDnd)) return true
  // The row itself is a button (nav item, launchpad tile), so a press on it must still drag.
  if (target.closest('[data-dnd-row-control]')) return false
  return PointerSensor.defaults.preventActivation?.(event, source) ?? false
}

function activationConstraints(event: PointerEvent) {
  if (event.pointerType === 'touch') {
    return [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
  }
  // The library default also activates after a 200ms hold, which would swallow a slow click on a row.
  return [new PointerActivationConstraints.Distance({ value: 8 })]
}

const POINTER_SENSOR = PointerSensor.configure({ activationConstraints, preventActivation })

const SENSORS = [POINTER_SENSOR, KeyboardSensor]

/**
 * Sensors for a draggable whose handle is a button: Enter stays the button's click, and only Space picks it up.
 * Pass them as the draggable's `sensors`, which replace the root's sensors for that draggable.
 */
export const BUTTON_HANDLE_DRAG_SENSORS = [
  POINTER_SENSOR,
  KeyboardSensor.configure({
    keyboardCodes: { ...KeyboardSensor.defaults.keyboardCodes, start: ['Space'], end: ['Space', 'Tab'] }
  })
]

/**
 * Pointer capture hides the gesture from the row, so a long-press timer it holds (Radix ContextMenu)
 * would fire after the finger moved or lifted and open a modal menu. The timer clears on `pointermove`.
 */
function releaseRowLongPress(activatorEvent: Event | null) {
  if (!(activatorEvent instanceof PointerEvent) || activatorEvent.pointerType === 'mouse') return

  const { target, pointerType, clientX, clientY } = activatorEvent
  target?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType, clientX, clientY }))
}

/**
 * An overlay that steals focus without hiding the page (Windows `Win+Shift+S`) swallows the
 * `pointerup`, so the dragged item would stay glued to the cursor, swallowing every later click.
 */
function CancelDragOnWindowBlur() {
  const manager = useDragDropManager()

  useEffect(() => {
    if (!manager) return

    const cancelDrag = () => {
      manager.actions.stop({ canceled: true })
      // Sensors stay attached after an outside stop, and only they know about a press that has not activated.
      manager.sensors.forEach((sensor) => sensor.destroy())
    }

    window.addEventListener('blur', cancelDrag)
    return () => window.removeEventListener('blur', cancelDrag)
  }, [manager])

  return null
}

export type DragDropRootProps = Omit<ComponentProps<typeof DragDropProvider>, 'sensors'>

/**
 * `DragDropProvider` with the app's pointer and keyboard sensors, window-blur cancel,
 * and release of row long-press menus once a touch drag moves.
 */
export function DragDropRoot({ children, onDragStart, onDragMove, onDragEnd, ...props }: DragDropRootProps) {
  const longPressReleased = useRef(false)

  return (
    <DragDropProvider
      {...props}
      sensors={SENSORS}
      onDragStart={(event, manager) => {
        longPressReleased.current = false
        onDragStart?.(event, manager)
      }}
      onDragMove={(event, manager) => {
        // Holding still keeps the long-press menu: only real movement gets here.
        if (!longPressReleased.current) {
          longPressReleased.current = true
          releaseRowLongPress(event.operation.activatorEvent)
        }
        onDragMove?.(event, manager)
      }}
      onDragEnd={(event, manager) => {
        releaseRowLongPress(event.operation.activatorEvent)
        onDragEnd?.(event, manager)
      }}>
      <CancelDragOnWindowBlur />
      {children}
    </DragDropProvider>
  )
}
