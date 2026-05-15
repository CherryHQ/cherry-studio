import { cn } from '@cherrystudio/ui/lib/utils'
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

  const wrapperStyle = {
    transition,
    transform: CSS.Transform.toString(transform ?? null)
  } as React.CSSProperties

  return (
    <div
      ref={ref}
      data-index={index}
      className={cn('box-border origin-top-left touch-manipulation', dragOverlay && 'dragOverlay relative z-[999]')}
      style={{
        ...wrapperStyle,
        ...(dragOverlay ? ({ '--scale': 1.02 } as React.CSSProperties) : {})
      }}>
      <div
        className={cn(
          'relative box-border origin-center cursor-pointer touch-manipulation',
          dragOverlay ? 'dragOverlay pointer-events-none cursor-inherit opacity-100' : 'scale-[var(--scale,1)]',
          dragOverlay && 'zoom-in-95 scale-[var(--scale)] animate-in duration-200',
          dragging && !dragOverlay && 'dragging z-0',
          dragging && !dragOverlay && (ghost ? 'opacity-25' : 'opacity-0'),
          ghost && 'ghost'
        )}
        {...listeners}
        {...props}>
        {renderItem(item, { dragging: !!dragging })}
      </div>
    </div>
  )
}
