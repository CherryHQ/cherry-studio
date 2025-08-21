import { DraggableSyntheticListeners } from '@dnd-kit/core'
import { Transform } from '@dnd-kit/utilities'
import { classNames } from '@renderer/utils'
import React, { useEffect } from 'react'
import styled from 'styled-components'

interface ItemRendererProps<T> {
  ref?: React.Ref<HTMLDivElement>
  item: T
  renderItem: (item: T, props: { dragging: boolean }) => React.ReactNode
  dragging?: boolean
  dragOverlay?: boolean
  ghost?: boolean
  transform?: Transform | null
  transition?: string | null
  listeners?: DraggableSyntheticListeners
}

export function ItemRenderer<T>({
  ref,
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
    '--translate-x': transform ? `${Math.round(transform.x)}px` : undefined,
    '--translate-y': transform ? `${Math.round(transform.y)}px` : undefined,
    '--scale-x': transform?.scaleX ? `${transform.scaleX}` : undefined,
    '--scale-y': transform?.scaleY ? `${transform.scaleY}` : undefined
  } as React.CSSProperties

  return (
    <ItemWrapper ref={ref} className={classNames({ dragOverlay: dragOverlay })} style={{ ...wrapperStyle }}>
      <DraggableItem
        className={classNames({ dragging: dragging, dragOverlay: dragOverlay, ghost: ghost })}
        {...listeners}
        {...props}>
        {renderItem(item, { dragging: !!dragging })}
      </DraggableItem>
    </ItemWrapper>
  )
}

const ItemWrapper = styled.div`
  box-sizing: border-box;
  transform: translate3d(var(--translate-x, 0), var(--translate-y, 0), 0) scaleX(var(--scale-x, 1))
    scaleY(var(--scale-y, 1));
  transform-origin: 0 0;
  touch-action: manipulation;

  &.dragOverlay {
    --scale: 1.02;
    z-index: 999;
    position: relative;
  }
`

const DraggableItem = styled.div`
  position: relative;
  box-sizing: border-box;
  cursor: pointer; /* default cursor for items */
  touch-action: manipulation;
  transform-origin: 50% 50%;
  transform: scale(var(--scale, 1));

  &.dragging:not(.dragOverlay) {
    z-index: 0;
    opacity: 0.25;

    &:not(.ghost) {
      opacity: 0;
    }
  }

  &.dragOverlay {
    cursor: inherit;
    animation: pop 200ms cubic-bezier(0.18, 0.67, 0.6, 1.22);
    transform: scale(var(--scale));
    opacity: 1;
    pointer-events: none; /* prevent pointer events on drag overlay */
  }

  @keyframes pop {
    0% {
      transform: scale(1);
    }
    100% {
      transform: scale(var(--scale));
    }
  }
`
