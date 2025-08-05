/// <reference types="@vitest/browser/context" />

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import DraggableVirtualList from '../DraggableList/virtual-list'

// Mock 依赖项
vi.mock('@hello-pangea/dnd', () => ({
  __esModule: true,
  DragDropContext: ({ children, onDragEnd, onDragStart }) => {
    // 挂载到 window 以便测试用例直接调用
    window.triggerOnDragEnd = (result = { source: { index: 0 }, destination: { index: 1 } }, provided = {}) => {
      onDragEnd?.(result, provided)
    }
    window.triggerOnDragStart = (result = { source: { index: 0 } }, provided = {}) => {
      onDragStart?.(result, provided)
    }
    return <div data-testid="drag-drop-context">{children}</div>
  },
  Droppable: ({ children, renderClone }) => (
    <div data-testid="droppable">
      {/* 模拟 renderClone 的调用 */}
      {renderClone &&
        renderClone({ draggableProps: {}, dragHandleProps: {}, innerRef: vi.fn() }, {}, { source: { index: 0 } })}
      {children({ droppableProps: {}, innerRef: vi.fn() })}
    </div>
  ),
  Draggable: ({ children, draggableId, index }) => (
    <div data-testid={`draggable-${draggableId}-${index}`}>
      {children({ draggableProps: {}, dragHandleProps: {}, innerRef: vi.fn() }, {})}
    </div>
  )
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 50,
        size: 50
      })),
    getTotalSize: () => count * 50,
    measureElement: vi.fn()
  })
}))

vi.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="auto-sizer">{children({ height: 500, width: 300 })}</div>
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  __esModule: true,
  default: ({ ref, children, ...props }) => (
    <div ref={ref} {...props} data-testid="scrollbar">
      {children}
    </div>
  )
}))

declare global {
  interface Window {
    triggerOnDragEnd: (result?: any, provided?: any) => void
    triggerOnDragStart: (result?: any, provided?: any) => void
  }
}

describe('DraggableVirtualList', () => {
  const sampleList = [
    { id: 'a', name: 'Item A' },
    { id: 'b', name: 'Item B' },
    { id: 'c', name: 'Item C' }
  ]

  describe('rendering', () => {
    it('should render all list items provided', () => {
      render(
        <DraggableVirtualList list={sampleList} onUpdate={() => {}}>
          {(item) => <div data-testid="test-item">{item.name}</div>}
        </DraggableVirtualList>
      )
      const items = screen.getAllByTestId('test-item')
      // 我们的 mock 中，renderClone 会渲染一个额外的 item
      expect(items.length).toBe(sampleList.length + 1)
      expect(items[0]).toHaveTextContent('Item A')
      expect(items[1]).toHaveTextContent('Item A')
      expect(items[2]).toHaveTextContent('Item B')
      expect(items[3]).toHaveTextContent('Item C')
    })

    it('should render nothing when the list is empty', () => {
      render(
        <DraggableVirtualList list={[]} onUpdate={() => {}}>
          {/* @ts-ignore test*/}
          {(item) => <div data-testid="test-item">{item.name}</div>}
        </DraggableVirtualList>
      )
      const items = screen.queryAllByTestId('test-item')
      expect(items.length).toBe(0)
    })
  })

  describe('drag and drop', () => {
    it('should call onUpdate with the new order after a drag operation', () => {
      const onUpdate = vi.fn()
      render(
        <DraggableVirtualList list={sampleList} onUpdate={onUpdate}>
          {(item) => <div>{item.name}</div>}
        </DraggableVirtualList>
      )

      window.triggerOnDragEnd({ source: { index: 0 }, destination: { index: 2 } })
      const expectedOrder = [sampleList[1], sampleList[2], sampleList[0]] // B, C, A
      expect(onUpdate).toHaveBeenCalledWith(expectedOrder)
    })

    it('should call onDragStart and onDragEnd callbacks', () => {
      const onDragStart = vi.fn()
      const onDragEnd = vi.fn()
      render(
        <DraggableVirtualList list={sampleList} onUpdate={() => {}} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          {(item) => <div>{item.name}</div>}
        </DraggableVirtualList>
      )

      window.triggerOnDragStart()
      expect(onDragStart).toHaveBeenCalledTimes(1)

      window.triggerOnDragEnd()
      expect(onDragEnd).toHaveBeenCalledTimes(1)
    })

    it('should not call onUpdate if destination is not defined', () => {
      const onUpdate = vi.fn()
      render(
        <DraggableVirtualList list={sampleList} onUpdate={onUpdate}>
          {(item) => <div>{item.name}</div>}
        </DraggableVirtualList>
      )

      window.triggerOnDragEnd({ source: { index: 0 }, destination: null })
      expect(onUpdate).not.toHaveBeenCalled()
    })
  })

  describe('snapshot', () => {
    it('should match snapshot with custom styles', () => {
      const { container } = render(
        <DraggableVirtualList
          list={sampleList}
          onUpdate={() => {}}
          className="custom-class"
          style={{ border: '1px solid red' }}
          itemStyle={{ background: 'blue' }}>
          {(item) => <div>{item.name}</div>}
        </DraggableVirtualList>
      )
      expect(container).toMatchSnapshot()
    })
  })
})
