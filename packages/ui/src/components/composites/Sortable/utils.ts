import { PointerSensor } from '@dnd-kit/core'

export const PORTAL_NO_DND_SELECTORS = [
  '.ant-dropdown',
  '.ant-select-dropdown',
  '.ant-popover',
  '.ant-tooltip',
  '.ant-modal'
].join(',')

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
          if (target.closest(PORTAL_NO_DND_SELECTORS) || target.dataset?.noDnd) {
            return false
          }
          target = target.parentElement as HTMLElement
        }
        return true
      }
    }
  ] as (typeof PointerSensor)['activators']
}
