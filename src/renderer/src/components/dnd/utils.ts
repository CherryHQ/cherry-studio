import { defaultDropAnimationSideEffects, type DropAnimation, PointerSensor } from '@dnd-kit/core'

export const PORTAL_NO_DND_SELECTORS = [
  '.ant-dropdown',
  '.ant-select-dropdown',
  '.ant-popover',
  '.ant-tooltip',
  '.ant-modal'
].join(',')

/**
 * Default drop animation config.
 * The opacity is set so to match the drag overlay case.
 */
export const dropAnimationConfig: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.25'
      }
    }
  })
}

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
