export type PhysicalHorizontalEdge = 'left' | 'right'

export interface HorizontalResizeOrigin {
  fixedX: number
  handleEdge: PhysicalHorizontalEdge
}

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
