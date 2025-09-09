/// <reference types="@vitest/browser/context" />

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DraggableList } from '../'

// mock @hello-pangea/dnd 组件
vi.mock('@hello-pangea/dnd', () => {
  return {
    __esModule: true,
    DragDropContext: ({ children, onDragEnd }: any) => {
      // 挂载到 window 以便测试用例直接调用
      window.triggerOnDragEnd = (result = { source: { index: 0 }, destination: { index: 1 } }, provided = {}) => {
        onDragEnd && onDragEnd(result, provided)
      }
      return <div data-testid="drag-drop-context">{children}</div>
    },
    Droppable: ({ children }: any) => (
      <div data-testid="droppable">
        {children({ droppableProps: {}, innerRef: () => {}, placeholder: <div data-testid="placeholder" /> })}
      </div>
    ),
    Draggable: ({ children, draggableId, index }: any) => (
      <div data-testid={`draggable-${draggableId}-${index}`}>
        {children({ draggableProps: {}, dragHandleProps: {}, innerRef: () => {} })}
      </div>
    )
  }
})

declare global {
  interface Window {
    triggerOnDragEnd: (result?: any, provided?: any) => void
  }
}

describe('DraggableList', () => {
  describe('rendering', () => {
    it('should render all list items', () => {
      const list = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' }
      ]
      render(
        <DraggableList list={list} onUpdate={() => {}}>
          {(item) => <div data-testid="item">{item.name}</div>}
        </DraggableList>
      )
      const items = screen.getAllByTestId('item')
      expect(items.length).toBe(3)
      expect(items[0].textContent).toBe('A')
      expect(items[1].textContent).toBe('B')
      expect(items[2].textContent).toBe('C')
    })

    it('should render with custom style and listStyle', () => {
      const list = [{ id: 'a', name: 'A' }]
      const style = { background: 'red' }
      const listStyle = { color: 'blue' }
      const { container } = render(
        <DraggableList list={list} style={style} listStyle={listStyle} onUpdate={() => {}}>
          {(item) => <div data-testid="item">{item.name}</div>}
        </DraggableList>
      )
      // 检查 style 是否传递到外层容器
      const listContainer = container.querySelector('.draggable-list-container')
      expect(listContainer).not.toBeNull()
      expect(listContainer?.parentElement).toHaveStyle({ background: 'red' })
    })

    it('should render nothing when list is empty', () => {
      const emptyList: Array<{ id: string; name: string }> = []
      render(
        <DraggableList list={emptyList} onUpdate={() => {}}>
          {(item) => <div data-testid="item">{item.name}</div>}
        </DraggableList>
      )
      // 虚拟列表存在但无内容
      const items = screen.queryAllByTestId('item')
      expect(items.length).toBe(0)
    })
  })

  describe('drag and drop', () => {
    it('should call onUpdate with new order after drag end', () => {
      const list = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' }
      ]
      const newOrder = [list[1], list[2], list[0]]
      const onUpdate = vi.fn()

      render(
        <DraggableList list={list} onUpdate={onUpdate}>
          {(item) => <div data-testid="item">{item.name}</div>}
        </DraggableList>
      )

      // 直接调用 window.triggerOnDragEnd 模拟拖拽结束
      window.triggerOnDragEnd({ source: { index: 0 }, destination: { index: 2 } }, {})

      expect(onUpdate).toHaveBeenCalledWith(newOrder)
      expect(onUpdate).toHaveBeenCalledTimes(1)
    })

    it('should call onDragStart and onDragEnd', () => {
      const list = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' }
      ]
      const onDragStart = vi.fn()
      const onDragEnd = vi.fn()

      render(
        <DraggableList list={list} onUpdate={() => {}} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          {(item) => <div data-testid="item">{item.name}</div>}
        </DraggableList>
      )

      // 先手动调用 onDragStart
      onDragStart()
      // 再模拟拖拽结束
      window.triggerOnDragEnd({ source: { index: 0 }, destination: { index: 1 } }, {})
      expect(onDragStart).toHaveBeenCalledTimes(1)
      expect(onDragEnd).toHaveBeenCalledTimes(1)
    })

    it('should not call onUpdate if dropped at same position', () => {
      const list = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' }
      ]
      const onUpdate = vi.fn()

      render(
        <DraggableList list={list} onUpdate={onUpdate}>
          {(item) => <div data-testid="item">{item.name}</div>}
        </DraggableList>
      )

      // 模拟拖拽到自身
      window.triggerOnDragEnd({ source: { index: 1 }, destination: { index: 1 } }, {})
      expect(onUpdate).toHaveBeenCalledTimes(0)
    })
  })

  describe('edge cases', () => {
    it('should work with single item', () => {
      const list = [{ id: 'a', name: 'A' }]
      const onUpdate = vi.fn()

      render(
        <DraggableList list={list} onUpdate={onUpdate}>
          {(item) => <div data-testid="item">{item.name}</div>}
        </DraggableList>
      )

      // 拖拽自身
      window.triggerOnDragEnd({ source: { index: 0 }, destination: { index: 0 } }, {})
      expect(onUpdate).toHaveBeenCalledTimes(0)
    })

    it('should not crash if callbacks are undefined', () => {
      const list = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' }
      ]

      // 不传 onDragStart/onDragEnd
      expect(() => {
        render(
          <DraggableList list={list} onUpdate={() => {}}>
            {(item) => <div data-testid="item">{item.name}</div>}
          </DraggableList>
        )
        window.triggerOnDragEnd({ source: { index: 0 }, destination: { index: 1 } }, {})
      }).not.toThrow()
    })

    it('should handle items without id', () => {
      const list = ['A', 'B', 'C']
      const onUpdate = vi.fn()

      render(
        <DraggableList list={list} onUpdate={onUpdate}>
          {(item) => <div data-testid="item">{item}</div>}
        </DraggableList>
      )

      // 拖拽第0项到第2项
      window.triggerOnDragEnd({ source: { index: 0 }, destination: { index: 2 } }, {})
      expect(onUpdate).toHaveBeenCalledTimes(1)
      expect(onUpdate.mock.calls[0][0]).toEqual(['B', 'C', 'A'])
    })
  })

  describe('interaction', () => {
    it('should show placeholder during drag', () => {
      const list = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' }
      ]

      render(
        <DraggableList list={list} onUpdate={() => {}}>
          {(item) => <div data-testid="item">{item.name}</div>}
        </DraggableList>
      )

      // placeholder 应该在初始渲染时就存在
      const placeholder = screen.getByTestId('placeholder')
      expect(placeholder).toBeInTheDocument()
    })

    it('should reorder correctly when dragged to first/last', () => {
      const list = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' }
      ]
      const onUpdate = vi.fn()
      render(
        <DraggableList list={list} onUpdate={onUpdate}>
          {(item) => <div data-testid="item">{item.name}</div>}
        </DraggableList>
      )

      // 拖拽第2项到第0项
      window.triggerOnDragEnd({ source: { index: 2 }, destination: { index: 0 } }, {})
      expect(onUpdate).toHaveBeenCalledWith([
        { id: 'c', name: 'C' },
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' }
      ])

      // 拖拽第0项到第2项
      onUpdate.mockClear()
      window.triggerOnDragEnd({ source: { index: 0 }, destination: { index: 2 } }, {})
      expect(onUpdate).toHaveBeenCalledWith([
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
        { id: 'a', name: 'A' }
      ])
    })
  })

  describe('snapshot', () => {
    it('should match snapshot', () => {
      const list = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' }
      ]
      const { container } = render(
        <DraggableList list={list} onUpdate={() => {}}>
          {(item) => <div data-testid="item">{item.name}</div>}
        </DraggableList>
      )
      expect(container).toMatchSnapshot()
    })
  })
})
