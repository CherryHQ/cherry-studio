import { loggerService } from '@logger'

const logger = loggerService.withContext('utils/dom')

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

const isOverflowScrollable = (overflow: string): boolean => {
  return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay'
}

const isElementScrollable = (element: HTMLElement): boolean => {
  const style = window.getComputedStyle(element)
  const overflowYScrollable = isOverflowScrollable(style.overflowY)
  const overflowXScrollable = isOverflowScrollable(style.overflowX)

  const canScrollY = overflowYScrollable && element.scrollHeight > element.clientHeight
  const canScrollX = overflowXScrollable && element.scrollWidth > element.clientWidth

  return canScrollY || canScrollX
}

/**
 * 查找最近的可滚动祖先容器（包含自身）。
 *
 * 说明：
 * - 仅当元素存在“可滚动空间”且 overflow 为 scroll/auto/overlay 时，认为其可滚动。
 * - 可通过 boundary 限制查找范围：当遍历到 boundary 时停止继续向上查找（用于避免滚动到更外层页面）。
 */
export function findNearestScrollableAncestor(element: HTMLElement, boundary?: HTMLElement | null): HTMLElement | null {
  let current: HTMLElement | null = element

  while (current) {
    if (isElementScrollable(current)) {
      return current
    }

    if (boundary && current === boundary) {
      break
    }
    current = current.parentElement
  }

  return null
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
    // 未指定容器：优先滚动最近的可滚动祖先（在固定布局/嵌套滚动场景下更可靠）。
    const fallbackContainer = findNearestScrollableAncestor(element)
    if (fallbackContainer) {
      scrollElementIntoView(element, fallbackContainer, behavior)
      return
    }

    // 找不到滚动容器，再退回浏览器默认行为
    scrollIntoView(element, { behavior, block: 'center', inline: 'nearest' })
    return
  }

  // 仅凭 scrollHeight/clientHeight 可能会把 overflow=visible/hidden 的容器误判为“可滚动”，导致滚动无效。
  // 这里明确要求 overflow 可滚动 + 存在滚动空间，才认为容器可滚动。
  const canScroll = isElementScrollable(scrollContainer)

  if (!canScroll) {
    // 容器不可滚动：尝试回退到 element 最近的可滚动祖先（常见于错误传入了外层 wrapper 的情况）。
    const boundary = scrollContainer.contains(element) ? scrollContainer : null
    const fallbackContainer = findNearestScrollableAncestor(element, boundary)
    if (fallbackContainer && fallbackContainer !== scrollContainer) {
      scrollElementIntoView(element, fallbackContainer, behavior)
      return
    }

    // 仍然无法确定滚动容器：退回默认滚动
    scrollIntoView(element, { behavior, block: 'center', inline: 'nearest' })
    return
  }

  // 容器可滚动：使用“相对滚动”把当前命中项居中，避免在反向列表（column-reverse）里计算绝对 scrollTop 出错。
  const containerRect = scrollContainer.getBoundingClientRect()
  const elRect = element.getBoundingClientRect()

  const containerCenterY = containerRect.top + containerRect.height / 2
  const elementCenterY = elRect.top + elRect.height / 2
  const deltaY = elementCenterY - containerCenterY

  if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 1) {
    return
  }

  const containerStyle = window.getComputedStyle(scrollContainer)
  const isColumnReverse = containerStyle.flexDirection === 'column-reverse'
  const scrollDeltaY = isColumnReverse ? -deltaY : deltaY

  if (typeof (scrollContainer as any).scrollBy === 'function') {
    ;(scrollContainer as any).scrollBy({ top: scrollDeltaY, behavior })
    return
  }

  // 兼容兜底：没有 scrollBy 时用 scrollTo/scrollTop
  if (typeof scrollContainer.scrollTo === 'function') {
    scrollContainer.scrollTo({ top: scrollContainer.scrollTop + scrollDeltaY, behavior })
    return
  }

  scrollContainer.scrollTop += scrollDeltaY
}

/**
 * 将一组 Range 按可视位置（从上到下、从左到右）排序。
 *
 * 背景：
 * - DOM 遍历顺序不一定等同于视觉顺序（例如 `flex-direction: column-reverse` 的消息列表）。
 * - 本地搜索 next/prev 需要遵循用户“屏幕上的上下顺序”。
 *
 * 注意：
 * - 该排序会触发布局读取（getClientRects / getBoundingClientRect），因此对超大量匹配项会跳过排序以避免卡顿。
 */
export function sortRangesByViewportPosition(ranges: Range[], maxSortable: number = 500): Range[] {
  if (ranges.length <= 1) return ranges
  if (ranges.length > maxSortable) return ranges

  const decorated = ranges.map((range, index) => {
    let top = Number.POSITIVE_INFINITY
    let left = Number.POSITIVE_INFINITY

    try {
      const rects = range.getClientRects?.()
      const rect = rects && rects.length > 0 ? rects[0] : range.getBoundingClientRect?.()

      if (rect && Number.isFinite(rect.top)) top = rect.top
      if (rect && Number.isFinite(rect.left)) left = rect.left
    } catch {
      // 忽略：保留为 Infinity，放到排序末尾
    }

    return { range, index, top, left }
  })

  decorated.sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top
    if (a.left !== b.left) return a.left - b.left
    return a.index - b.index
  })

  return decorated.map((x) => x.range)
}
