import { act, render, screen } from '@testing-library/react'
import React, { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DynamicVirtualList, type DynamicVirtualListRef } from '..'

// Mock management
const mocks = vi.hoisted(() => ({
  virtualizer: {
    getVirtualItems: vi.fn(() => [
      { index: 0, key: 'item-0', start: 0, size: 50 },
      { index: 1, key: 'item-1', start: 50, size: 50 },
      { index: 2, key: 'item-2', start: 100, size: 50 }
    ]),
    getTotalSize: vi.fn(() => 150),
    getVirtualIndexes: vi.fn(() => [0, 1, 2]),
    measure: vi.fn(),
    scrollToOffset: vi.fn(),
    scrollToIndex: vi.fn(),
    resizeItem: vi.fn(),
    measureElement: vi.fn(),
    scrollElement: null as HTMLDivElement | null
  },
  useVirtualizer: vi.fn()
}))

// Set up the mock to return our mock virtualizer
mocks.useVirtualizer.mockImplementation(() => mocks.virtualizer)

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: mocks.useVirtualizer,
  defaultRangeExtractor: vi.fn((range) =>
    Array.from({ length: range.endIndex - range.startIndex + 1 }, (_, i) => range.startIndex + i)
  )
}))

// Test data factory
interface TestItem {
  id: string
  content: string
}

function createTestItems(count = 5): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${i + 1}`,
    content: `Item ${i + 1}`
  }))
}

describe('DynamicVirtualList', () => {
  const defaultItems = createTestItems()
  const defaultProps = {
    list: defaultItems,
    estimateSize: () => 50,
    children: (item: TestItem, index: number) => <div data-testid={`item-${index}`}>{item.content}</div>
  }

  // Test component for ref testing
  const TestComponentWithRef: React.FC<{
    onRefReady?: (ref: DynamicVirtualListRef | null) => void
    listProps?: any
  }> = ({ onRefReady, listProps = {} }) => {
    const ref = useRef<DynamicVirtualListRef>(null)

    React.useEffect(() => {
      onRefReady?.(ref.current)
    }, [onRefReady])

    return <DynamicVirtualList ref={ref} {...defaultProps} {...listProps} />
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('basic rendering', () => {
    it('snapshot test', () => {
      const { container } = render(<DynamicVirtualList {...defaultProps} />)
      expect(container).toMatchSnapshot()
    })

    it('should apply custom scroller styles', () => {
      const customStyle = { backgroundColor: 'red', height: '400px' }
      render(<DynamicVirtualList {...defaultProps} scrollerStyle={customStyle} />)

      const scrollContainer = document.querySelector('.dynamic-virtual-list')
      expect(scrollContainer).toBeInTheDocument()
      expect(scrollContainer).toHaveStyle('background-color: rgb(255, 0, 0)')
      expect(scrollContainer).toHaveStyle('height: 400px')
    })

    it('should apply custom item container styles', () => {
      const itemStyle = { padding: '10px', margin: '5px' }
      render(<DynamicVirtualList {...defaultProps} itemContainerStyle={itemStyle} />)

      const items = document.querySelectorAll('[data-index]')
      expect(items.length).toBeGreaterThan(0)

      // Check first item styles
      const firstItem = items[0] as HTMLElement
      expect(firstItem).toHaveStyle('padding: 10px')
      expect(firstItem).toHaveStyle('margin: 5px')
    })
  })

  describe('props integration', () => {
    it('should render correctly with different item counts', () => {
      const { rerender } = render(<DynamicVirtualList {...defaultProps} list={createTestItems(3)} />)

      // Should render without errors
      expect(screen.getByTestId('item-0')).toBeInTheDocument()

      // Should handle dynamic item count changes
      rerender(<DynamicVirtualList {...defaultProps} list={createTestItems(10)} />)
      expect(document.querySelector('.dynamic-virtual-list')).toBeInTheDocument()
    })

    it('should work with custom estimateSize function', () => {
      const customEstimateSize = vi.fn(() => 80)

      // Should render without errors when using custom estimateSize
      expect(() => {
        render(<DynamicVirtualList {...defaultProps} estimateSize={customEstimateSize} />)
      }).not.toThrow()

      expect(screen.getByTestId('item-0')).toBeInTheDocument()
    })
  })

  describe('sticky feature', () => {
    it('should apply sticky positioning to specified items', () => {
      const isSticky = vi.fn((index: number) => index === 0) // First item is sticky

      render(<DynamicVirtualList {...defaultProps} isSticky={isSticky} />)

      // Should call isSticky function during rendering
      expect(isSticky).toHaveBeenCalled()

      // Should apply sticky styles to sticky items
      const stickyItem = document.querySelector('[data-index="0"]') as HTMLElement
      expect(stickyItem).toBeInTheDocument()
      expect(stickyItem).toHaveStyle('position: sticky')
      expect(stickyItem).toHaveStyle('z-index: 1')
    })

    it('should apply absolute positioning to non-sticky items', () => {
      const isSticky = vi.fn((index: number) => index === 0)

      render(<DynamicVirtualList {...defaultProps} isSticky={isSticky} />)

      // Non-sticky items should have absolute positioning
      const regularItem = document.querySelector('[data-index="1"]') as HTMLElement
      expect(regularItem).toBeInTheDocument()
      expect(regularItem).toHaveStyle('position: absolute')
    })

    it('should apply absolute positioning to all items when no sticky function provided', () => {
      render(<DynamicVirtualList {...defaultProps} />)

      // All items should have absolute positioning
      const items = document.querySelectorAll('[data-index]')
      items.forEach((item) => {
        const htmlItem = item as HTMLElement
        expect(htmlItem).toHaveStyle('position: absolute')
      })
    })
  })

  describe('custom range extractor', () => {
    it('should work with custom rangeExtractor', () => {
      const customRangeExtractor = vi.fn(() => [0, 1, 2])

      // Should render without errors when using custom rangeExtractor
      expect(() => {
        render(<DynamicVirtualList {...defaultProps} rangeExtractor={customRangeExtractor} />)
      }).not.toThrow()

      expect(screen.getByTestId('item-0')).toBeInTheDocument()
    })

    it('should handle both rangeExtractor and sticky props gracefully', () => {
      const customRangeExtractor = vi.fn(() => [0, 1, 2])
      const isSticky = vi.fn((index: number) => index === 0)

      // Should render without conflicts when both props are provided
      expect(() => {
        render(<DynamicVirtualList {...defaultProps} rangeExtractor={customRangeExtractor} isSticky={isSticky} />)
      }).not.toThrow()

      expect(screen.getByTestId('item-0')).toBeInTheDocument()
    })
  })

  describe('ref api', () => {
    let refInstance: DynamicVirtualListRef | null = null

    beforeEach(async () => {
      render(
        <TestComponentWithRef
          onRefReady={(ref) => {
            refInstance = ref
          }}
        />
      )

      // Wait for ref to be ready
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    it('should expose all required ref methods', () => {
      expect(refInstance).toBeTruthy()
      expect(refInstance).not.toBeNull()

      // Type assertion to help TypeScript understand the type
      const ref = refInstance as unknown as DynamicVirtualListRef
      expect(typeof ref.measure).toBe('function')
      expect(typeof ref.scrollElement).toBe('function')
      expect(typeof ref.scrollToOffset).toBe('function')
      expect(typeof ref.scrollToIndex).toBe('function')
      expect(typeof ref.resizeItem).toBe('function')
      expect(typeof ref.getTotalSize).toBe('function')
      expect(typeof ref.getVirtualItems).toBe('function')
      expect(typeof ref.getVirtualIndexes).toBe('function')
    })

    it('should allow calling all ref methods without throwing', () => {
      const ref = refInstance as unknown as DynamicVirtualListRef

      // Test that all methods can be called without errors
      expect(() => ref.measure()).not.toThrow()
      expect(() => ref.scrollToOffset(100, { align: 'start' })).not.toThrow()
      expect(() => ref.scrollToIndex(2, { align: 'center' })).not.toThrow()
      expect(() => ref.resizeItem(1, 80)).not.toThrow()

      // Test that data methods return expected types
      expect(typeof ref.getTotalSize()).toBe('number')
      expect(Array.isArray(ref.getVirtualItems())).toBe(true)
      expect(Array.isArray(ref.getVirtualIndexes())).toBe(true)
    })
  })

  describe('orientation support', () => {
    beforeEach(() => {
      // Reset mocks for orientation tests
      mocks.virtualizer.getVirtualItems.mockReturnValue([
        { index: 0, key: 'item-0', start: 0, size: 100 },
        { index: 1, key: 'item-1', start: 100, size: 100 }
      ])
      mocks.virtualizer.getTotalSize.mockReturnValue(200)
    })

    it('should apply horizontal layout styles correctly', () => {
      render(<DynamicVirtualList {...defaultProps} horizontal={true} />)

      // Verify container styles for horizontal layout
      const container = document.querySelector('div[style*="position: relative"]') as HTMLElement
      expect(container).toHaveStyle('width: 200px') // totalSize
      expect(container).toHaveStyle('height: 100%')

      // Verify item transform for horizontal layout
      const items = document.querySelectorAll('[data-index]')
      const firstItem = items[0] as HTMLElement
      expect(firstItem.style.transform).toContain('translateX(0px)')
      expect(firstItem).toHaveStyle('height: 100%')
    })

    it('should apply vertical layout styles correctly', () => {
      // Reset to default vertical mock values
      mocks.virtualizer.getTotalSize.mockReturnValue(150)

      render(<DynamicVirtualList {...defaultProps} horizontal={false} />)

      // Verify container styles for vertical layout
      const container = document.querySelector('div[style*="position: relative"]') as HTMLElement
      expect(container).toHaveStyle('width: 100%')
      expect(container).toHaveStyle('height: 150px') // totalSize from mock

      // Verify item transform for vertical layout
      const items = document.querySelectorAll('[data-index]')
      const firstItem = items[0] as HTMLElement
      expect(firstItem.style.transform).toContain('translateY(0px)')
      expect(firstItem).toHaveStyle('width: 100%')
    })
  })

  describe('edge cases', () => {
    it('should handle edge cases gracefully', () => {
      // Empty items list
      mocks.virtualizer.getVirtualItems.mockReturnValueOnce([])
      expect(() => {
        render(<DynamicVirtualList {...defaultProps} list={[]} />)
      }).not.toThrow()

      // Null ref
      expect(() => {
        render(<DynamicVirtualList {...defaultProps} ref={null} />)
      }).not.toThrow()

      // Zero estimate size
      expect(() => {
        render(<DynamicVirtualList {...defaultProps} estimateSize={() => 0} />)
      }).not.toThrow()

      // Items without expected properties
      const itemsWithoutContent = [{ id: '1' }, { id: '2' }] as any[]
      expect(() => {
        render(
          <DynamicVirtualList
            {...defaultProps}
            list={itemsWithoutContent}
            children={(_item, index) => <div data-testid={`item-${index}`}>No content</div>}
          />
        )
      }).not.toThrow()
    })
  })

  describe('auto hide scrollbar', () => {
    it('should always show scrollbar when autoHideScrollbar is false', () => {
      render(<DynamicVirtualList {...defaultProps} autoHideScrollbar={false} />)

      const scrollContainer = document.querySelector('.dynamic-virtual-list') as HTMLElement
      expect(scrollContainer).toBeInTheDocument()

      // When autoHideScrollbar is false, scrollbar should always be visible
      expect(scrollContainer).not.toHaveAttribute('aria-hidden', 'true')
    })

    it('should hide scrollbar initially and show during scrolling when autoHideScrollbar is true', async () => {
      vi.useFakeTimers()

      render(<DynamicVirtualList {...defaultProps} autoHideScrollbar={true} />)

      const scrollContainer = document.querySelector('.dynamic-virtual-list') as HTMLElement
      expect(scrollContainer).toBeInTheDocument()

      // Initially hidden
      expect(scrollContainer).toHaveAttribute('aria-hidden', 'true')

      // We can't easily simulate real scroll events in JSDOM, so we'll test the internal logic directly
      // by calling the onChange handler which should update the state
      const onChangeCallback = mocks.useVirtualizer.mock.calls[0][0].onChange

      // Simulate scroll start
      act(() => {
        onChangeCallback({ isScrolling: true }, true)
      })

      // After scrolling starts, scrollbar should be visible
      expect(scrollContainer).toHaveAttribute('aria-hidden', 'false')

      // Simulate scroll end
      act(() => {
        onChangeCallback({ isScrolling: false }, true)
      })

      // Advance timers to trigger the hide timeout
      act(() => {
        vi.advanceTimersByTime(10000)
      })

      // After timeout, scrollbar should be hidden again
      expect(scrollContainer).toHaveAttribute('aria-hidden', 'true')

      vi.useRealTimers()
    })
  })
})
