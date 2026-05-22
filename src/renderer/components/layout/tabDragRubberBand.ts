const DEFAULT_RUBBER_BAND_OPTIONS = {
  resistance: 0.25,
  maxOverdrag: 12,
  leftInset: 0,
  rightInset: 0
}

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
  options: Partial<typeof DEFAULT_RUBBER_BAND_OPTIONS> = {}
) => {
  const resistance = options.resistance ?? DEFAULT_RUBBER_BAND_OPTIONS.resistance
  const maxOverdrag = options.maxOverdrag ?? DEFAULT_RUBBER_BAND_OPTIONS.maxOverdrag
  const leftInset = options.leftInset ?? DEFAULT_RUBBER_BAND_OPTIONS.leftInset
  const rightInset = options.rightInset ?? DEFAULT_RUBBER_BAND_OPTIONS.rightInset

  const minX = boundaryRect.left + leftInset - draggedRect.left
  const maxX = boundaryRect.right - rightInset - draggedRect.left - draggedRect.width

  if (translateX < minX) {
    return minX - getRubberBandOffset(minX - translateX, boundaryRect.width, resistance, maxOverdrag)
  }

  if (translateX > maxX) {
    return maxX + getRubberBandOffset(translateX - maxX, boundaryRect.width, resistance, maxOverdrag)
  }

  return translateX
}
