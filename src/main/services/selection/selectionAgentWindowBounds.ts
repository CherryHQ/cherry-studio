import type { Rectangle, Size } from 'electron'

/** Keeps selection windows this far from the work-area edges, matching the action window. */
const GAP = 6

function clampSize(size: Size, workArea: Rectangle): Size {
  return {
    width: Math.min(size.width, workArea.width - 2 * GAP),
    height: Math.min(size.height, workArea.height - 2 * GAP)
  }
}

function clampAxis(start: number, length: number, areaStart: number, areaLength: number): number {
  return Math.round(Math.min(Math.max(start, areaStart + GAP), areaStart + areaLength - length - GAP))
}

/** Centers the window under the toolbar's top edge, or on the work area when there is no toolbar to follow. */
export function placeSelectionAgentWindow(size: Size, anchor: Rectangle | null, workArea: Rectangle): Rectangle {
  const { width, height } = clampSize(size, workArea)
  const x = anchor ? anchor.x + (anchor.width - width) / 2 : workArea.x + (workArea.width - width) / 2
  const y = anchor ? anchor.y : workArea.y + (workArea.height - height) / 2
  return {
    x: clampAxis(x, width, workArea.x, workArea.width),
    y: clampAxis(y, height, workArea.y, workArea.height),
    width,
    height
  }
}

/** Grows the window downward from its top edge; when the space below runs out, it keeps its bottom edge instead. */
export function resizeSelectionAgentWindow(bounds: Rectangle, size: Size, workArea: Rectangle): Rectangle {
  const { width, height } = clampSize(size, workArea)
  const fitsBelow = bounds.y + height <= workArea.y + workArea.height - GAP
  const y = fitsBelow ? bounds.y : bounds.y + bounds.height - height
  return {
    x: clampAxis(bounds.x + (bounds.width - width) / 2, width, workArea.x, workArea.width),
    y: clampAxis(y, height, workArea.y, workArea.height),
    width,
    height
  }
}
