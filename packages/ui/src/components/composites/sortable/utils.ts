import { PointerSensor, type PointerSensorProps } from '@dnd-kit/core'
import { getWindow } from '@dnd-kit/utilities'

/** dnd-kit keeps `handleCancel` private, yet it is the only path that both detaches the sensor and notifies DndContext. */
type PointerSensorCancel = { handleCancel(): void }

/**
 * Pointer sensor that also cancels the drag when the window loses focus.
 *
 * dnd-kit only cancels on `resize` and `visibilitychange`. An overlay that steals focus without
 * hiding the page (Windows `Win+Shift+S`) swallows the `pointerup`, so neither fires and the dragged
 * item stays glued to the cursor, swallowing every later click.
 */
export class BlurCancelPointerSensor extends PointerSensor {
  constructor(props: PointerSensorProps) {
    // Same window dnd-kit attaches its own resize / visibilitychange listeners to.
    const view = getWindow(props.event.target)
    let blurListener: (() => void) | null = null

    const stopListeningForBlur = () => {
      if (!blurListener) return
      view.removeEventListener('blur', blurListener)
      blurListener = null
    }

    super({
      ...props,
      onCancel: () => {
        stopListeningForBlur()
        props.onCancel()
      },
      onEnd: () => {
        stopListeningForBlur()
        props.onEnd()
      }
    })

    // SAFETY: dnd-kit 6.3.1's private handleCancel detaches the sensor and notifies DndContext.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The private SDK declaration erases its signature; indexed access would become any.
    blurListener = () => (this as unknown as PointerSensorCancel).handleCancel()
    view.addEventListener('blur', blurListener)
  }
}
