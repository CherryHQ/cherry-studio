import {
  DragDropContext,
  Draggable,
  Droppable,
  DroppableProps,
  DropResult,
  OnDragEndResponder,
  OnDragStartResponder,
  ResponderProvided
} from '@hello-pangea/dnd'
import Scrollbar from '@renderer/components/Scrollbar'
import { droppableReorder } from '@renderer/utils'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type Key, memo, useCallback, useRef } from 'react'

/**
 * 泛型 Props，用于配置 DraggableVirtualList。
 *
 * @template T 列表元素的类型
 * @property {string} [className] 根节点附加 class
 * @property {React.CSSProperties} [style] 根节点附加样式
 * @property {React.CSSProperties} [itemStyle] 元素内容区域的附加样式
 * @property {React.CSSProperties} [itemContainerStyle] 元素拖拽容器的附加样式
 * @property {Partial<DroppableProps>} [droppableProps] 透传给 Droppable 的额外配置
 * @property {(list: T[]) => void} onUpdate 拖拽排序完成后的回调，返回新的列表顺序
 * @property {OnDragStartResponder} [onDragStart] 开始拖拽时的回调
 * @property {OnDragEndResponder}   [onDragEnd] 结束拖拽时的回调
 * @property {T[]} list 渲染的数据源
 * @property {(index: number) => Key} [itemKey] 提供给虚拟列表的行 key，若不提供默认使用 index
 * @property {number} [overscan=5] 前后额外渲染的行数，提升快速滚动时的体验
 * @property {React.ReactNode} [header] 列表头部内容
 * @property {(item: T, index: number) => React.ReactNode} children 列表项渲染函数
 */
interface DraggableVirtualListProps<T> {
  ref?: React.Ref<HTMLDivElement>
  className?: string
  style?: React.CSSProperties
  scrollerStyle?: React.CSSProperties
  itemStyle?: React.CSSProperties
  itemContainerStyle?: React.CSSProperties
  droppableProps?: Partial<DroppableProps>
  onUpdate: (list: T[]) => void
  onDragStart?: OnDragStartResponder
  onDragEnd?: OnDragEndResponder
  list: T[]
  itemKey?: (index: number) => Key
  estimateSize?: (index: number) => number
  overscan?: number
  header?: React.ReactNode
  children: (item: T, index: number) => React.ReactNode
}

/**
 * 带虚拟滚动与拖拽排序能力的（垂直）列表组件。
 * - 滚动容器由该组件内部管理。
 * @template T 列表元素的类型
 * @param {DraggableVirtualListProps<T>} props 组件参数
 * @returns {React.ReactElement}
 */
function DraggableVirtualList<T>({
  ref,
  className,
  style,
  scrollerStyle,
  itemStyle,
  itemContainerStyle,
  droppableProps,
  onDragStart,
  onUpdate,
  onDragEnd,
  list,
  itemKey,
  estimateSize: _estimateSize,
  overscan = 5,
  header,
  children
}: DraggableVirtualListProps<T>): React.ReactElement {
  const _onDragEnd = (result: DropResult, provided: ResponderProvided) => {
    onDragEnd?.(result, provided)
    if (result.destination) {
      const sourceIndex = result.source.index
      const destIndex = result.destination.index
      const reorderAgents = droppableReorder(list, sourceIndex, destIndex)
      onUpdate(reorderAgents)
    }
  }

  // 虚拟列表滚动容器的 ref
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: list?.length ?? 0,
    getScrollElement: useCallback(() => parentRef.current, []),
    getItemKey: itemKey,
    estimateSize: useCallback((index) => _estimateSize?.(index) ?? 50, [_estimateSize]),
    overscan
  })

  return (
    <div
      ref={ref}
      className={`${className} draggable-virtual-list`}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', ...style }}>
      <DragDropContext onDragStart={onDragStart} onDragEnd={_onDragEnd}>
        {header}
        <Droppable
          droppableId="droppable"
          mode="virtual"
          renderClone={(provided, _snapshot, rubric) => {
            const item = list[rubric.source.index]
            return (
              <div
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                ref={provided.innerRef}
                style={{
                  ...itemStyle,
                  ...provided.draggableProps.style
                }}>
                {item && children(item, rubric.source.index)}
              </div>
            )
          }}
          {...droppableProps}>
          {(provided) => {
            // 让 dnd 和虚拟列表共享同一个滚动容器
            const setRefs = (el: HTMLDivElement | null) => {
              provided.innerRef(el)
              parentRef.current = el
            }

            return (
              <Scrollbar
                ref={setRefs}
                {...provided.droppableProps}
                className="virtual-scroller"
                style={{
                  ...scrollerStyle,
                  height: '100%',
                  width: '100%',
                  overflowY: 'auto',
                  position: 'relative'
                }}>
                <div
                  className="virtual-list"
                  style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative'
                  }}>
                  {virtualizer.getVirtualItems().map((virtualItem) => (
                    <VirtualRow
                      key={virtualItem.key}
                      virtualItem={virtualItem}
                      list={list}
                      itemStyle={itemStyle}
                      itemContainerStyle={itemContainerStyle}
                      virtualizer={virtualizer}
                      children={children}
                    />
                  ))}
                </div>
              </Scrollbar>
            )
          }}
        </Droppable>
      </DragDropContext>
    </div>
  )
}

/**
 * 渲染单个可拖拽的虚拟列表项，高度为动态测量
 */
const VirtualRow = memo(({ virtualItem, list, children, itemStyle, itemContainerStyle, virtualizer }: any) => {
  const item = list[virtualItem.index]
  const draggableId = String(virtualItem.key)
  return (
    <Draggable
      key={`draggable_${draggableId}_${virtualItem.index}`}
      draggableId={draggableId}
      index={virtualItem.index}>
      {(provided) => {
        const setDragRefs = (el: HTMLElement | null) => {
          provided.innerRef(el)
          virtualizer.measureElement(el)
        }

        const dndStyle = provided.draggableProps.style
        const virtualizerTransform = `translateY(${virtualItem.start}px)`

        // dnd 的 transform 负责拖拽时的位移和让位动画，
        // virtualizer 的 translateY 负责将项定位到虚拟列表的正确位置，
        // 它们拼接起来可以同时实现拖拽视觉效果和虚拟化定位。
        const combinedTransform = dndStyle?.transform
          ? `${dndStyle.transform} ${virtualizerTransform}`
          : virtualizerTransform

        return (
          <div
            {...provided.draggableProps}
            ref={setDragRefs}
            className="draggable-item"
            data-index={virtualItem.index}
            style={{
              ...itemContainerStyle,
              ...dndStyle,
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: combinedTransform
            }}>
            <div {...provided.dragHandleProps} className="draggable-content" style={{ ...itemStyle }}>
              {item && children(item, virtualItem.index)}
            </div>
          </div>
        )
      }}
    </Draggable>
  )
})

export default DraggableVirtualList
