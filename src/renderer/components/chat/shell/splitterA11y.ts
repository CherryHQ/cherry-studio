import type { PhysicalHorizontalEdge } from '@renderer/utils/horizontalGeometry'
import type { KeyboardEvent } from 'react'

const SPLITTER_KEYBOARD_STEP = 16

interface VerticalSplitterOptions {
  width: number
  min: number
  max: number
  label: string
  /** Clamp + apply the next width (same clamp the pointer drag uses). */
  onResize: (nextWidth: number) => void
  /** Physical edge occupied by the handle; the matching Arrow key grows the pane. */
  handleEdge?: PhysicalHorizontalEdge
}

/**
 * Turns a bare drag handle into a focusable, keyboard-operable vertical splitter
 * (WAI-ARIA `separator`): Arrow keys nudge the width, Home/End jump to min/max.
 * Keyboard and screen-reader users can now discover and adjust pane widths.
 */
export function getVerticalSplitterProps({
  width,
  min,
  max,
  label,
  onResize,
  handleEdge = 'right'
}: VerticalSplitterOptions) {
  const grow = handleEdge === 'left' ? 'ArrowLeft' : 'ArrowRight'
  const shrink = handleEdge === 'left' ? 'ArrowRight' : 'ArrowLeft'

  return {
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': width,
    'aria-label': label,
    tabIndex: 0,
    onKeyDown: (event: KeyboardEvent) => {
      switch (event.key) {
        case grow:
          event.preventDefault()
          onResize(width + SPLITTER_KEYBOARD_STEP)
          break
        case shrink:
          event.preventDefault()
          onResize(width - SPLITTER_KEYBOARD_STEP)
          break
        case 'Home':
          event.preventDefault()
          onResize(min)
          break
        case 'End':
          event.preventDefault()
          onResize(max)
          break
      }
    }
  }
}
