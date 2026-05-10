const MIN_SCROLL_DELTA = 0.5
const MIN_ANCHOR_PRESERVE_FRAMES = 180
const IDLE_ANCHOR_PRESERVE_FRAMES = 30

export type ScrollAnchorAlignment = 'preserve' | 'top'

export function keepElementTop(container: HTMLElement, element: HTMLElement, targetTop: number) {
  const delta = element.getBoundingClientRect().top - targetTop

  if (Math.abs(delta) <= MIN_SCROLL_DELTA) {
    return false
  }

  container.scrollTop += delta
  return true
}

export function shouldKeepPreservingAnchor({
  frameCount,
  hasProcessingResponse,
  idleFrames
}: {
  frameCount: number
  hasProcessingResponse: boolean
  idleFrames: number
}) {
  return hasProcessingResponse || frameCount < MIN_ANCHOR_PRESERVE_FRAMES || idleFrames < IDLE_ANCHOR_PRESERVE_FRAMES
}

export function getPreservedDisplayCount(displayCount: number, currentDisplayLength: number) {
  return Math.max(displayCount, currentDisplayLength)
}

export function getAnchorTargetTop({
  alignment,
  anchorTop,
  containerTop
}: {
  alignment: ScrollAnchorAlignment
  anchorTop: number
  containerTop: number
}) {
  return alignment === 'top' ? containerTop : anchorTop
}
