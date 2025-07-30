import { CSSProperties, ReactNode } from 'react'

import VerticalVirtualList from './VerticalVirtualList'

type VirtualListProps<T> = {
  list: T[]
  itemRenderer: (item: T) => ReactNode
  estimateSize: (index: number) => number
  direction?: 'horizontal' | 'vertical' | 'grid'
  reversed?: boolean
  containerStyle?: CSSProperties
}

/**
 * 虚拟列表组件
 * @param props - 组件属性
 * @param props.list - 需要渲染的数据列表
 * @param props.direction - 列表方向
 * @param props.itemRenderer - 列表项渲染函数
 * @param props.estimateSize - 估算每个列表项尺寸的函数
 * @param props.reversed - 是否反转列表
 * @param props.containerStyle - 容器样式
 */
const VirtualList = <T,>({
  list,
  direction = 'vertical',
  itemRenderer,
  estimateSize,
  reversed,
  containerStyle
}: VirtualListProps<T>) => {
  if (direction !== 'vertical' || reversed !== undefined) {
    return <div>Not implemented</div>
  }
  return (
    <VerticalVirtualList
      list={list}
      itemRenderer={itemRenderer}
      estimateSize={estimateSize}
      containerStyle={containerStyle}
    />
  )
}

export default VirtualList
