import type { DraggableSyntheticListeners } from '@dnd-kit/core'
import type { Transform } from '@dnd-kit/utilities'
import { CSS } from '@dnd-kit/utilities'
import React, { useEffect } from 'react'

import type { RenderItemType } from './types'

interface ItemRendererProps<T> {
  ref?: React.Ref<HTMLDivElement>
  index?: number
  item: T
  renderItem: RenderItemType<T>
  dragging?: boolean
  dragOverlay?: boolean
  ghost?: boolean
  transform?: Transform | null
  transition?: string | null
  listeners?: DraggableSyntheticListeners
  itemStyle?: React.CSSProperties
}

export function ItemRenderer<T>({
  ref,
  index,
  item,
  renderItem,
  dragging,
  dragOverlay,
  ghost,
  transform,
  transition,
  listeners,
  itemStyle,
  ...props
}: ItemRendererProps<T>) {
  useEffect(() => {
    if (!dragOverlay) {
      return
    }

    document.body.style.cursor = 'grabbing'

    return () => {
      document.body.style.cursor = ''
    }
  }, [dragOverlay])

  const style = {
    transition,
    transform: CSS.Transform.toString(transform ?? null)
  } as React.CSSProperties

  return (
    <div
      ref={ref}
      data-index={index}
      className="box-border origin-top-left touch-manipulation"
      style={{
        ...style,
        ...itemStyle,
        ...(dragOverlay ? ({ '--scale': 1.02, zIndex: 999, position: 'relative' } as React.CSSProperties) : {})
      }}>
      <div
        style={
          {
            position: 'relative',
            boxSizing: 'border-box',
            touchAction: 'manipulation',
            transformOrigin: '50% 50%',
            transform: dragOverlay ? 'scale(var(--scale))' : 'scale(var(--scale, 1))',
            zIndex: dragging && !dragOverlay ? 0 : undefined,
            opacity: dragging && !dragOverlay ? (ghost ? 0.25 : 0) : 1,
            cursor: dragOverlay ? 'inherit' : 'pointer',
            pointerEvents: dragOverlay ? 'none' : undefined
          } as React.CSSProperties
        }
        {...listeners}
        {...props}>
        {renderItem(item, { dragging: !!dragging })}
      </div>
    </div>
  )
}
