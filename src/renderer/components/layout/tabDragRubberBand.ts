const DEFAULT_RUBBER_BAND_OPTIONS = {
  resistance: 0.25,
  maxOverdrag: 12,
  leftInset: 0,
  rightInset: 0
}

type RubberBandOptions = Partial<typeof DEFAULT_RUBBER_BAND_OPTIONS>

const getRubberBandOffset = (overflow: number, boundaryWidth: number, resistance: number, maxOverdrag: number) => {
  if (overflow <= 0 || boundaryWidth <= 0 || resistance <= 0 || maxOverdrag <= 0) {
    return 0
  }

  const offset = (overflow * boundaryWidth * resistance) / (boundaryWidth + overflow * resistance)
  return Math.min(offset, maxOverdrag)
}

export const applyHorizontalRubberBandTranslateX = (
  translateX: number,
  draggedRect: DOMRectReadOnly,
  boundaryRect: DOMRectReadOnly,
  options: RubberBandOptions = {}
) => {
  const { resistance, maxOverdrag, leftInset, rightInset } = { ...DEFAULT_RUBBER_BAND_OPTIONS, ...options }

  const hardMinX = boundaryRect.left - draggedRect.left
  const hardMaxX = boundaryRect.right - draggedRect.left - draggedRect.width
  const rawMinX = boundaryRect.left + leftInset - draggedRect.left
  const rawMaxX = boundaryRect.right - rightInset - draggedRect.left - draggedRect.width

  if (rawMaxX < rawMinX) {
    // Safe area collapsed (insets exceed available width). Fall back to a hard
    // physical-bounds clamp so the tab cannot fly off-screen with no resistance.
    if (hardMaxX < hardMinX) return translateX
    if (translateX < hardMinX) return hardMinX
    if (translateX > hardMaxX) return hardMaxX
    return translateX
  }

  const minX = Math.min(rawMinX, 0)
  const maxX = Math.max(rawMaxX, 0)
  const leftMaxOverdrag = Math.min(maxOverdrag, Math.max(0, minX - hardMinX))
  const rightMaxOverdrag = Math.min(maxOverdrag, Math.max(0, hardMaxX - maxX))

  if (translateX < minX) {
    return minX - getRubberBandOffset(minX - translateX, boundaryRect.width, resistance, leftMaxOverdrag)
  }

  if (translateX > maxX) {
    return maxX + getRubberBandOffset(translateX - maxX, boundaryRect.width, resistance, rightMaxOverdrag)
  }

  return translateX
}
