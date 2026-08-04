import { MESSAGE_SEARCH_EXCLUDED_ELEMENT_SELECTOR } from './messageSearchText'

const MESSAGE_PART_SELECTOR = '[data-message-part-id]'

function getRangeElement(range: Range): HTMLElement | null {
  const container = range.commonAncestorContainer
  return container instanceof HTMLElement ? container : container.parentElement
}

export function createMessageSearchNodeFilter(): NodeFilter {
  return {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || parent.closest(MESSAGE_SEARCH_EXCLUDED_ELEMENT_SELECTOR)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  }
}

export function getMountedMessagePartElements(scope: HTMLElement): Map<string, HTMLElement> {
  const elements = new Map<string, HTMLElement>()
  for (const element of scope.querySelectorAll<HTMLElement>(MESSAGE_PART_SELECTOR)) {
    const partId = element.dataset.messagePartId
    if (partId && !elements.has(partId)) elements.set(partId, element)
  }
  return elements
}

export function requestUserMessagePartExpansion(partElement: HTMLElement): boolean {
  const toggle = partElement.querySelector<HTMLButtonElement>('[data-user-message-content-toggle]')
  if (!toggle || toggle.getAttribute('aria-expanded') !== 'false') return false
  toggle.click()
  return true
}

function canScrollAxis(element: HTMLElement, axis: 'x' | 'y'): boolean {
  const style = window.getComputedStyle(element)
  const overflow = axis === 'x' ? style.overflowX : style.overflowY
  if (overflow === 'visible' || overflow === 'unset') return false
  return axis === 'x' ? element.scrollWidth > element.clientWidth + 1 : element.scrollHeight > element.clientHeight + 1
}

function revealRangeInElement(range: Range, element: HTMLElement): void {
  const rangeRect = range.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()

  if (canScrollAxis(element, 'x') && (rangeRect.left < elementRect.left || rangeRect.right > elementRect.right)) {
    element.scrollLeft += rangeRect.left + rangeRect.width / 2 - (elementRect.left + elementRect.width / 2)
  }
  if (canScrollAxis(element, 'y') && (rangeRect.top < elementRect.top || rangeRect.bottom > elementRect.bottom)) {
    element.scrollTop += rangeRect.top + rangeRect.height / 2 - (elementRect.top + elementRect.height / 2)
  }
}

/** Reveal a match inside card/grid scrollers before the outer virtual list scrolls. */
export function revealRangeInNestedScrollContainers(range: Range, outerScroller: HTMLElement | null): void {
  const rangeElement = getRangeElement(range)
  if (!rangeElement) return

  let ancestor = rangeElement.parentElement
  while (ancestor && ancestor !== outerScroller) {
    revealRangeInElement(range, ancestor)
    ancestor = ancestor.parentElement
  }
}
