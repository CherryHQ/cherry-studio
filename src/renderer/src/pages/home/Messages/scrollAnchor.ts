const MIN_SCROLL_DELTA = 0.5

export function keepElementTop(container: HTMLElement, element: HTMLElement, targetTop: number) {
  const delta = element.getBoundingClientRect().top - targetTop

  if (Math.abs(delta) <= MIN_SCROLL_DELTA) {
    return false
  }

  container.scrollTop += delta
  return true
}
