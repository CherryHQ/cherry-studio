import { cn } from '@renderer/utils'

import { usePaneDropPreview } from './PaneDndProvider'
import { usePaneGeometry } from './PaneGeometryContext'

/**
 * Visual overlay showing the pending drop target for a given leaf pane.
 *
 * - Tab-bar insert line for reorder / move.
 * - Full-content overlay for center drops (append to pane).
 * - Half-content overlay for edge drops (split).
 *
 * The overlays are absolutely positioned relative to the pane's root div;
 * the host `LeafPaneView` must be `position: relative` for the layout to work.
 */
export function PaneDropIndicator({ paneId }: { paneId: string }) {
  const preview = usePaneDropPreview(paneId)
  const { geometryRef } = usePaneGeometry()

  if (!preview) return null

  if (preview.kind === 'reorder' || preview.kind === 'move') {
    const geom = geometryRef.current.get(paneId)
    if (!geom) return null
    const idx = preview.insertIndex
    const buttons = geom.tabButtonRects

    // Position the 2px line at either the right edge of tab[idx-1] or the left edge of tab[idx].
    let leftInBar: number
    if (buttons.length === 0) {
      leftInBar = 0
    } else if (idx <= 0) {
      leftInBar = buttons[0].rect.left - geom.tabBarRect.left
    } else if (idx >= buttons.length) {
      const last = buttons[buttons.length - 1]
      leftInBar = last.rect.left + last.rect.width - geom.tabBarRect.left
    } else {
      leftInBar = buttons[idx].rect.left - geom.tabBarRect.left
    }

    return (
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 z-20 w-[2px] rounded-full bg-primary"
        style={{
          left: leftInBar,
          height: geom.tabBarRect.height
        }}
      />
    )
  }

  // Split overlay — covers the half of the content area where the new pane will land.
  const positionClass = (() => {
    switch (preview.zone) {
      case 'left':
        return 'inset-y-0 left-0 w-1/2'
      case 'right':
        return 'inset-y-0 right-0 w-1/2'
      case 'top':
        return 'inset-x-0 top-0 h-1/2'
      case 'bottom':
        return 'inset-x-0 bottom-0 h-1/2'
      default:
        return 'inset-0'
    }
  })()

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute z-20 rounded-[8px] border-2 border-primary/40 bg-primary/20 transition-opacity',
        positionClass
      )}
    />
  )
}
