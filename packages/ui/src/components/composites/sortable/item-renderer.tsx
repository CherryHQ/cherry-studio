import React from 'react'

import type { RenderItemType, SortableDragHandleProps } from './types'

interface ItemRendererProps<T> {
  ref?: React.Ref<HTMLDivElement>
  index?: number
  item: T
  renderItem: RenderItemType<T>
  dragging?: boolean
  /** The library would otherwise mark this row a focusable button, which it is not. */
  dragDisabled?: boolean
  dragOverlay?: boolean
  ghost?: boolean
  dragHandleProps?: SortableDragHandleProps
  itemStyle?: React.CSSProperties
}

export function ItemRenderer<T>({
  ref,
  index,
  item,
  renderItem,
  dragging,
  dragDisabled,
  dragOverlay,
  ghost,
  dragHandleProps,
  itemStyle
}: ItemRendererProps<T>) {
  return (
    <div
      ref={ref}
      data-index={index}
      role={dragDisabled ? 'group' : undefined}
      tabIndex={dragDisabled ? -1 : undefined}
      className="box-border origin-top-left touch-manipulation"
      style={{
        ...itemStyle,
        ...(dragOverlay ? ({ '--scale': 1.02, zIndex: 999, position: 'relative' } as React.CSSProperties) : {})
      }}>
      <div
        style={{
          position: 'relative',
          boxSizing: 'border-box',
          touchAction: 'manipulation',
          transformOrigin: '50% 50%',
          transform: dragOverlay ? 'scale(var(--scale))' : 'scale(var(--scale, 1))',
          zIndex: dragging && !dragOverlay ? 0 : undefined,
          opacity: dragging && !dragOverlay ? (ghost ? 0.25 : 0) : 1,
          cursor: dragOverlay ? 'inherit' : (itemStyle?.cursor ?? 'pointer'),
          pointerEvents: dragOverlay ? 'none' : undefined
        }}>
        {renderItem(item, { dragging: !!dragging, overlay: !!dragOverlay, dragHandleProps })}
      </div>
    </div>
  )
}
