export type PhysicalHorizontalEdge = 'left' | 'right'

export interface HorizontalResizeOrigin {
  fixedX: number
  handleEdge: PhysicalHorizontalEdge
}

/**
 * Decide which physical edge a resize handle grabbed, so the opposite edge can
 * stay pinned for the rest of the drag. Measuring this instead of deriving it
 * from the reading direction is what makes the drag work in LTR and RTL alike.
 *
 * The edge is inferred from which half of `rect` the pointer landed in, which
 * assumes the pane is comfortably wider than its handle — true for every pane
 * here (all have min widths far above the 8px handles). Pass the *pane* rect,
 * not an outer container: a container much wider than the pane would put a
 * near-edge pointer on the wrong side of the midpoint.
 */
export function getHorizontalResizeOrigin(
  rect: Pick<DOMRect, 'left' | 'right'>,
  pointerX: number
): HorizontalResizeOrigin {
  const handleEdge = pointerX <= (rect.left + rect.right) / 2 ? 'left' : 'right'
  return {
    fixedX: handleEdge === 'left' ? rect.right : rect.left,
    handleEdge
  }
}

export function getHorizontalResizeWidth(origin: HorizontalResizeOrigin, pointerX: number): number {
  return origin.handleEdge === 'left' ? origin.fixedX - pointerX : pointerX - origin.fixedX
}

export function getHorizontalResizeDelta(
  origin: HorizontalResizeOrigin,
  startPointerX: number,
  pointerX: number
): number {
  const physicalDelta = pointerX - startPointerX
  return origin.handleEdge === 'left' ? -physicalDelta : physicalDelta
}
