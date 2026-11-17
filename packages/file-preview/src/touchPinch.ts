type PinchHandler = (scaleFactor: number, origin: [number, number]) => void

const spanOf = (touches: TouchList) =>
  Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)

/**
 * Reports two-finger pinch steps on `element` and stops the browser from zooming the page meanwhile.
 * `scaleFactor` is relative to the previous step; `origin` is the fingers' client-space midpoint.
 */
export function attachTouchPinch(element: HTMLElement, onPinch: PinchHandler, onEnd?: () => void): () => void {
  let lastSpan = 0
  const reset = (event: TouchEvent) => {
    if (lastSpan > 0) onEnd?.()
    lastSpan = event.touches.length === 2 ? spanOf(event.touches) : 0
  }
  const move = (event: TouchEvent) => {
    if (event.touches.length !== 2 || lastSpan === 0) return
    event.preventDefault()
    const span = spanOf(event.touches)
    if (span === 0) return
    const [first, second] = [event.touches[0], event.touches[1]]
    onPinch(span / lastSpan, [(first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2])
    lastSpan = span
  }
  element.addEventListener('touchstart', reset, { passive: true })
  element.addEventListener('touchmove', move, { passive: false })
  element.addEventListener('touchend', reset)
  element.addEventListener('touchcancel', reset)
  return () => {
    element.removeEventListener('touchstart', reset)
    element.removeEventListener('touchmove', move)
    element.removeEventListener('touchend', reset)
    element.removeEventListener('touchcancel', reset)
  }
}
