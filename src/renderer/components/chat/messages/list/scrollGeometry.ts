interface ScrollGeometryElement {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

function normalizeInset(bottomInset: number): number {
  return Math.max(0, bottomInset)
}

type ScrollSizeElement = Pick<ScrollGeometryElement, 'clientHeight' | 'scrollHeight'>

export function getEffectiveScrollSize(element: ScrollSizeElement, bottomInset = 0): number {
  return Math.max(element.clientHeight, element.scrollHeight - normalizeInset(bottomInset))
}

export function getRealBottom(element: ScrollSizeElement, bottomInset = 0): number {
  return Math.max(0, getEffectiveScrollSize(element, bottomInset) - element.clientHeight)
}

export function getDistanceToBottom(element: ScrollGeometryElement, bottomInset = 0): number {
  return getRealBottom(element, bottomInset) - element.scrollTop
}

export function isMoreThanOneViewportFromBottom(element: ScrollGeometryElement, bottomInset = 0): boolean {
  const viewportSize = element.clientHeight
  if (viewportSize <= 0) return false
  return getDistanceToBottom(element, bottomInset) > viewportSize
}
