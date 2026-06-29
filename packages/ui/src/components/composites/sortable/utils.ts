import { PointerSensor } from '@dnd-kit/core'

/**
 * Prevent drag on elements with specific classes or data-no-dnd attribute
 */
export class PortalSafePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown',
      handler: ({ nativeEvent: event }) => {
        let target = event.target as HTMLElement

        while (target) {
          if (target.dataset?.noDnd) {
            return false
          }
          target = target.parentElement as HTMLElement
        }
        return true
      }
    }
  ] as (typeof PointerSensor)['activators']
}
