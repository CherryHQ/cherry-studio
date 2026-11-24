import { loggerService } from '@logger'

const logger = loggerService.withContext('utils/dom')

export function getEventTargetNode(target: EventTarget | null): Node | null {
  if (!target || !('nodeType' in target) || typeof target.nodeType !== 'number') return null

  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Browser event targets supply native nodes; this bridge preserves cross-realm identity and does not validate arbitrary external objects.
  return target as Node
}

export function isElementNode(node: Node | null): node is Element {
  return node?.nodeType === 1
}

export function getEventTargetElement(target: EventTarget | null): Element | null {
  const node = getEventTargetNode(target)

  return isElementNode(node) ? node : (node?.parentElement ?? null)
}

interface ChromiumScrollIntoViewOptions extends ScrollIntoViewOptions {
  /**
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView#container
   * @see https://github.com/microsoft/TypeScript/issues/62803
   */
  container?: 'all' | 'nearest'
}

/**
 * Simple wrapper for scrollIntoView with common default options.
 * Provides a unified interface with sensible defaults.
 *
 * @param element - The target element to scroll into view
 * @param options - Scroll options. If not provided, uses { behavior: 'smooth', block: 'center', inline: 'nearest' }
 */
export function scrollIntoView(element: HTMLElement, options?: ChromiumScrollIntoViewOptions): void {
  if (!element) {
    logger.warn('[scrollIntoView] Unexpected falsy element. Do nothing as fallback.')

    return
  }

  const defaultOptions: ScrollIntoViewOptions = {
    behavior: 'smooth',
    block: 'center',
    inline: 'nearest'
  }

  element.scrollIntoView(options ?? defaultOptions)
}

/**
 * Intelligently scrolls an element into view at the center position.
 * Prioritizes scrolling within the specified container to avoid scrolling the entire page.
 *
 * @param element - The target element to scroll into view
 * @param scrollContainer - Optional scroll container. If provided and scrollable, scrolling happens within it; otherwise uses browser default scrolling
 * @param behavior - Scroll behavior, defaults to 'smooth'
 */
export function scrollElementIntoView(
  element: HTMLElement,
  scrollContainer?: HTMLElement | null,
  behavior: ScrollBehavior = 'smooth'
): void {
  if (!scrollContainer) {
    // No container specified, use browser default scrolling
    scrollIntoView(element, { behavior, block: 'center', inline: 'nearest' })

    return
  }

  // Check if container is scrollable
  const canScroll =
    scrollContainer.scrollHeight > scrollContainer.clientHeight ||
    scrollContainer.scrollWidth > scrollContainer.clientWidth

  if (canScroll) {
    // Container is scrollable, scroll within the container
    const containerRect = scrollContainer.getBoundingClientRect()
    const elRect = element.getBoundingClientRect()

    // Calculate element's scrollable offset position relative to the container
    const elementTopWithinContainer = elRect.top - containerRect.top + scrollContainer.scrollTop
    const desiredTop = elementTopWithinContainer - Math.max(0, scrollContainer.clientHeight - elRect.height) / 2

    scrollContainer.scrollTo({ top: Math.max(0, desiredTop), behavior })
  } else {
    // Container is not scrollable, fallback to browser default scrolling
    scrollIntoView(element, { behavior, block: 'center', inline: 'nearest' })
  }
}
