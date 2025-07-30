import { useVirtualizer } from '@tanstack/react-virtual'
import { CSSProperties, ReactNode, useRef } from 'react'
import styled from 'styled-components'

type Props<T> = {
  list: T[]
  itemRenderer: (item: T) => ReactNode
  estimateSize: (index: number) => number
  containerStyle?: CSSProperties
}

const VerticalVirtualList = <T,>({ list, itemRenderer, estimateSize, containerStyle }: Props<T>) => {
  const parentRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 5
  })

  return (
    <>
      <VirtualListContainer ref={parentRef} style={containerStyle}>
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
          }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => (
            <VirtualListItemContainer
              key={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: estimateSize(virtualRow.index),
                transform: `translateY(${virtualRow.start}px)`
              }}>
              {itemRenderer(list[virtualRow.index])}
            </VirtualListItemContainer>
          ))}
        </div>
      </VirtualListContainer>
    </>
  )
}

const VirtualListContainer = styled.div`
  display: flex;
  flex-direction: column;
`

const VirtualListItemContainer = styled.div``

export default VerticalVirtualList
