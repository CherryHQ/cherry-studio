/**
 * Simple wrapper for scrollIntoView with common default options.
 * Provides a unified interface with sensible defaults.
 *
 * @param element - The target element to scroll into view
 * @param options - Scroll options. If not provided, uses { behavior: 'smooth', block: 'center', inline: 'nearest' }
 */
export function scrollIntoView(
  element: HTMLElement,
  options?: ScrollIntoViewOptions
): void {
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
  const canScroll = scrollContainer.scrollHeight > scrollContainer.clientHeight ||
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
