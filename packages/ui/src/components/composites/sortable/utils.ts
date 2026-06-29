import { PointerSensor } from '@dnd-kit/core'

/**
 * Prevent drag on elements marked with data-no-dnd.
 */
export class PortalSafePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown',
      handler: ({ nativeEvent: event }, { onActivation }) => {
        // Match dnd-kit's default guard: only a primary left-button press may
        // start a drag — never right-click (which opens the context menu) or
        // middle-click. Overriding `activators` drops this guard otherwise.
        if (!event.isPrimary || event.button !== 0) {
          return false
        }

        let target = event.target as HTMLElement

        while (target) {
          if (target.dataset?.noDnd) {
            return false
          }
          target = target.parentElement as HTMLElement
        }

        onActivation?.({ event })
        return true
      }
    }
  ] as (typeof PointerSensor)['activators']
}
