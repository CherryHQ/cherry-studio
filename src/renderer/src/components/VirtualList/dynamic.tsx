import type { Range, ScrollToOptions, VirtualItem, VirtualizerOptions } from '@tanstack/react-virtual'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import React, { memo, useCallback, useImperativeHandle, useMemo, useRef } from 'react'

type InheritedVirtualizerOptions = Partial<
  Omit<
    VirtualizerOptions<HTMLDivElement, Element>,
    | 'count' // 由 items.length 决定
    | 'getScrollElement' // 由内部 scrollerRef 决定
    | 'estimateSize' // 提升为一级必选 prop
    | 'rangeExtractor' // isSticky 提供更简单的抽象
  >
>

export interface DynamicVirtualListRef {
  /** Resets any prev item measurements. */
  measure: () => void
  /** Returns the scroll element for the virtualizer. */
  scrollElement: () => HTMLDivElement | null
  /** Scrolls the virtualizer to the pixel offset provided. */
  scrollToOffset: (offset: number, options?: ScrollToOptions) => void
  /** Scrolls the virtualizer to the items of the index provided. */
  scrollToIndex: (index: number, options?: ScrollToOptions) => void
  /** Resizes an item. */
  resizeItem: (index: number, size: number) => void
  /** Returns the total size in pixels for the virtualized items. */
  getTotalSize: () => number
  /** Returns the virtual items for the current state of the virtualizer. */
  getVirtualItems: () => VirtualItem[]
  /** Returns the virtual row indexes for the current state of the virtualizer. */
  getVirtualIndexes: () => number[]
}

export interface DynamicVirtualListProps<T> extends InheritedVirtualizerOptions {
  ref?: React.Ref<DynamicVirtualListRef>

  /** 列表数据 */
  items: T[]

  /** 列表项渲染函数 */
  children: (item: T, index: number) => React.ReactNode

  /** 列表项大小估计函数（初始估计） */
  estimateSize: (index: number) => number

  /**
   * sticky 项判断函数，不能与 rangeExtractor 同时使用
   */
  isSticky?: (index: number) => boolean

  /**
   * 范围提取函数，不能与 isSticky 同时使用
   */
  rangeExtractor?: (range: Range) => number[]

  /** 滚动容器样式 */
  scrollerStyle?: React.CSSProperties

  /** 列表项样式 */
  itemContainerStyle?: React.CSSProperties
}

function DynamicVirtualList<T>(props: DynamicVirtualListProps<T>) {
  const {
    ref,
    items,
    children,
    estimateSize,
    isSticky,
    rangeExtractor: customRangeExtractor,
    scrollerStyle,
    itemContainerStyle,
    ...restOptions
  } = props

  const internalScrollerRef = useRef<HTMLDivElement>(null)
  const scrollerRef = internalScrollerRef

  const activeStickyIndexRef = useRef(0)

  const stickyIndexes = useMemo(() => {
    if (!isSticky) return []
    return items.map((_, index) => (isSticky(index) ? index : -1)).filter((index) => index !== -1)
  }, [items, isSticky])

  const internalStickyRangeExtractor = useCallback(
    (range: Range) => {
      const newActiveStickyIndex =
        [...stickyIndexes].reverse().find((index) => range.startIndex >= index) ?? stickyIndexes[0] ?? 0

      if (newActiveStickyIndex !== activeStickyIndexRef.current) {
        activeStickyIndexRef.current = newActiveStickyIndex
      }

      const next = new Set([activeStickyIndexRef.current, ...defaultRangeExtractor(range)])
      return [...next].sort((a, b) => a - b)
    },
    [stickyIndexes]
  )

  const rangeExtractor = customRangeExtractor ?? (isSticky ? internalStickyRangeExtractor : undefined)

  const virtualizer = useVirtualizer({
    ...restOptions,
    count: items.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize,
    rangeExtractor
  })

  useImperativeHandle(
    ref,
    () => ({
      measure: () => virtualizer.measure(),
      scrollElement: () => virtualizer.scrollElement,
      scrollToOffset: (offset, options) => virtualizer.scrollToOffset(offset, options),
      scrollToIndex: (index, options) => virtualizer.scrollToIndex(index, options),
      resizeItem: (index, size) => virtualizer.resizeItem(index, size),
      getTotalSize: () => virtualizer.getTotalSize(),
      getVirtualItems: () => virtualizer.getVirtualItems(),
      getVirtualIndexes: () => virtualizer.getVirtualIndexes()
    }),
    [virtualizer]
  )

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()
  const { horizontal } = restOptions

  return (
    <div
      ref={scrollerRef}
      style={{
        overflow: 'auto',
        ...scrollerStyle
      }}>
      <div
        style={{
          position: 'relative',
          width: horizontal ? `${totalSize}px` : '100%',
          height: !horizontal ? `${totalSize}px` : '100%'
        }}>
        {virtualItems.map((virtualItem) => {
          const isItemSticky = stickyIndexes.includes(virtualItem.index)
          const isItemActiveSticky = isItemSticky && activeStickyIndexRef.current === virtualItem.index

          const style: React.CSSProperties = {
            ...itemContainerStyle,
            position: isItemActiveSticky ? 'sticky' : 'absolute',
            top: 0,
            left: 0,
            zIndex: isItemSticky ? 1 : undefined,
            ...(horizontal
              ? {
                  transform: isItemActiveSticky ? undefined : `translateX(${virtualItem.start}px)`,
                  height: '100%'
                }
              : {
                  transform: isItemActiveSticky ? undefined : `translateY(${virtualItem.start}px)`,
                  width: '100%'
                })
          }

          return (
            <div key={virtualItem.key} data-index={virtualItem.index} ref={virtualizer.measureElement} style={style}>
              {children(items[virtualItem.index], virtualItem.index)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default memo(DynamicVirtualList) as <T>(props: DynamicVirtualListProps<T>) => React.ReactElement
