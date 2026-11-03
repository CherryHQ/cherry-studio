import { act, fireEvent, render, screen } from '@testing-library/react'
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
    range: { startIndex: 0, endIndex: 2 },
    scrollElement: null as HTMLDivElement | null
  },
  useVirtualizer: vi.fn()
}))

// Set up the mock to return our mock virtualizer
mocks.useVirtualizer.mockImplementation((options) => {
  options.rangeExtractor?.(mocks.virtualizer.range)
  return mocks.virtualizer
})

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

  const TestComponentWithScrollElementRef: React.FC<{
    onScrollElementReady: (node: HTMLDivElement | null) => void
  }> = ({ onScrollElementReady }) => {
    const scrollElementRef = useRef<HTMLDivElement>(null)

    React.useEffect(() => {
      onScrollElementReady(scrollElementRef.current)
    }, [onScrollElementReady])

    return <DynamicVirtualList {...defaultProps} role="listbox" scrollElementRef={scrollElementRef} />
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    mocks.virtualizer.range = { startIndex: 0, endIndex: 2 }
    mocks.virtualizer.getVirtualItems.mockReturnValue([
      { index: 0, key: 'item-0', start: 0, size: 50 },
      { index: 1, key: 'item-1', start: 50, size: 50 },
      { index: 2, key: 'item-2', start: 100, size: 50 }
    ])
    mocks.virtualizer.getTotalSize.mockReturnValue(150)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  describe('basic rendering', () => {
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

    it('should skip item measurement when callers provide a fixed item height', () => {
      render(<DynamicVirtualList {...defaultProps} itemContainerStyle={{ height: 32 }} />)

      expect(mocks.virtualizer.measureElement).not.toHaveBeenCalled()
    })

    it('should expose the scroll element and allow overriding the container role', () => {
      const onScrollElementReady = vi.fn()

      render(<TestComponentWithScrollElementRef onScrollElementReady={onScrollElementReady} />)

      const scrollContainer = screen.getByRole('listbox')
      expect(onScrollElementReady).toHaveBeenCalledWith(scrollContainer)
    })
  })

  describe('props integration', () => {
    it('should remeasure when an initially empty list receives items', () => {
      mocks.virtualizer.getVirtualItems.mockReturnValueOnce([])
      const { rerender } = render(<DynamicVirtualList {...defaultProps} list={[]} size={0} />)

      expect(mocks.virtualizer.measure).not.toHaveBeenCalled()

      rerender(<DynamicVirtualList {...defaultProps} list={createTestItems(3)} size={150} />)

      expect(mocks.virtualizer.measure).toHaveBeenCalledOnce()
      expect(screen.getByTestId('item-0')).toBeInTheDocument()
    })
  })

  describe('sticky feature', () => {
    const row = (index: number) => document.querySelector(`[data-index="${index}"]`) as HTMLElement
    const content = () => row(0).parentElement as HTMLElement

    it('lets later same-depth headers cover active headers while keeping rows below both', () => {
      mocks.virtualizer.range.startIndex = 1
      render(<DynamicVirtualList {...defaultProps} isSticky={(index) => index !== 1} />)

      expect(screen.getByRole('region')).toHaveClass('isolate')
      expect(Number(row(0).style.zIndex)).toBeGreaterThan(Number(row(1).style.zIndex))
      expect(row(0).style.zIndex).toBe(row(2).style.zIndex)
      expect(row(0)).toHaveStyle('position: sticky; top: 0; left: 0')
      expect(row(1)).toHaveStyle('position: absolute; transform: translateY(50px)')
      expect(row(0).style.backgroundColor).toBe('var(--card)')
      expect(row(2).style.backgroundColor).toBe('var(--card)')
    })

    it('clamps an adjacent child before the range leaves its parent using measured ancestor height', () => {
      mocks.virtualizer.getVirtualItems.mockReturnValue([
        { index: 0, key: 'parent', start: 0, size: 28 },
        { index: 1, key: 'child', start: 28, size: 28 },
        { index: 2, key: 'file', start: 56, size: 36 }
      ])
      render(
        <DynamicVirtualList
          {...defaultProps}
          estimateSize={() => 36}
          isSticky={(index) => index < 2}
          getItemDepth={(index) => index}
        />
      )

      expect(row(1)).toHaveStyle('position: sticky; top: 28px; margin-top: 0')
      expect(Number(row(0).style.zIndex)).toBeGreaterThan(Number(row(1).style.zIndex))
      expect(Number(row(1).style.zIndex)).toBeGreaterThan(Number(row(2).style.zIndex))
    })

    it('uses estimated ancestor height only when that ancestor is not mounted', () => {
      mocks.virtualizer.getVirtualItems.mockReturnValue([{ index: 1, key: 'child', start: 36, size: 28 }])
      render(
        <DynamicVirtualList
          {...defaultProps}
          estimateSize={() => 36}
          isSticky={(index) => index < 2}
          getItemDepth={(index) => index}
        />
      )
      expect(row(1)).toHaveStyle('position: sticky; top: 36px; margin-top: 36px')
    })

    it.each([
      { startIndex: 2, depths: [0, 1, 1, 2], slot: 28 },
      { startIndex: 3, depths: [0, 1, 1, 0], slot: 0 }
    ])(
      'releases kept old headers without accumulating exited ancestors at range $startIndex',
      ({ startIndex, depths, slot }) => {
        mocks.virtualizer.getVirtualItems.mockReturnValue(
          depths.map((_, index) => ({ index, key: `item-${index}`, start: index * 28, size: 28 }))
        )
        mocks.virtualizer.range = { startIndex, endIndex: 3 }
        render(
          <DynamicVirtualList
            {...defaultProps}
            isSticky={() => true}
            getItemDepth={(index) => depths[index]}
            keepMountedIndexes={[0, 1, 2]}
          />
        )

        expect(row(1).style.transform).toBe('translateY(28px)')
        expect(row(1).style.backgroundColor).toBe('')
        expect(row(startIndex)).toHaveStyle(`position: sticky; top: ${slot}px`)
        if (startIndex === 3) expect(row(0).style.transform).toBe('translateY(0px)')
        else expect(row(3)).toHaveStyle('position: sticky; top: 56px')
      }
    )

    // Native sticky positioning must work without a scroll callback updating transforms.
    it('keeps horizontal headers in flow and preserves consumer scroll handling', () => {
      const offsets: number[] = []
      render(
        <DynamicVirtualList
          {...defaultProps}
          horizontal
          isSticky={() => true}
          onScroll={(event) => offsets.push(event.currentTarget.scrollLeft)}
        />
      )
      fireEvent.scroll(screen.getByRole('region'), { target: { scrollLeft: 17 } })
      expect(offsets).toEqual([17])
      expect(row(0)).toHaveStyle('position: sticky; left: 0; margin-left: 0')
      expect(row(0).style.transform).toBe('')
    })

    it('removes sticky scroll effects when disabled and leaves non-sticky rows at natural coordinates', () => {
      const { rerender, unmount } = render(<DynamicVirtualList {...defaultProps} isSticky={() => true} />)
      const scroller = screen.getByRole('region')
      const node = content()
      rerender(<DynamicVirtualList {...defaultProps} />)
      fireEvent.scroll(scroller, { target: { scrollTop: 25 } })
      expect(node.style.getPropertyValue('--dv-scroll-offset')).toBe('')
      for (const index of [0, 1, 2]) {
        expect(row(index)).toHaveStyle(`position: absolute; transform: translateY(${index * 50}px)`)
      }
      unmount()
      fireEvent.scroll(scroller, { target: { scrollTop: 30 } })
      expect(node.style.getPropertyValue('--dv-scroll-offset')).toBe('')
    })

    it('never subscribes to scroll for a list without sticky headers', () => {
      const addListener = vi.spyOn(HTMLElement.prototype, 'addEventListener')
      render(<DynamicVirtualList {...defaultProps} />)
      const scroller = screen.getByRole('region')
      const scrollSubscriptions = addListener.mock.calls.filter(
        ([type, , options], index) =>
          type === 'scroll' &&
          addListener.mock.contexts[index] === scroller &&
          typeof options === 'object' &&
          options?.passive === true
      )
      expect(scrollSubscriptions).toHaveLength(0)
      expect(content().style.getPropertyValue('--dv-scroll-offset')).toBe('')
      fireEvent.scroll(scroller, { target: { scrollTop: 50 } })
      expect(content().style.getPropertyValue('--dv-scroll-offset')).toBe('')
      expect(row(1).style.transform).toBe('translateY(50px)')
    })
  })

  describe('custom range extractor', () => {
    it('should work with custom rangeExtractor', () => {
      const customRangeExtractor = vi.fn(() => [0, 1, 2])

      render(<DynamicVirtualList {...defaultProps} rangeExtractor={customRangeExtractor} />)

      expect(mocks.useVirtualizer).toHaveBeenCalledWith(
        expect.objectContaining({ rangeExtractor: customRangeExtractor })
      )
    })

    it('should prefer a custom rangeExtractor when sticky props are also provided', () => {
      const customRangeExtractor = vi.fn(() => [0, 1, 2])
      const isSticky = vi.fn((index: number) => index === 0)

      render(<DynamicVirtualList {...defaultProps} rangeExtractor={customRangeExtractor} isSticky={isSticky} />)

      expect(mocks.useVirtualizer).toHaveBeenCalledWith(
        expect.objectContaining({ rangeExtractor: customRangeExtractor })
      )
    })

    it('keeps requested rows mounted alongside the visible and sticky ranges', () => {
      let extracted: number[] = []
      mocks.useVirtualizer.mockImplementationOnce((options: { rangeExtractor: (range: unknown) => number[] }) => {
        extracted = options.rangeExtractor({ startIndex: 1, endIndex: 2 })
        return mocks.virtualizer
      })

      render(<DynamicVirtualList {...defaultProps} isSticky={(index) => index === 0} keepMountedIndexes={[4]} />)

      expect(extracted).toEqual([0, 1, 2, 4])
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

    it('should expose and delegate the virtualizer ref API', () => {
      expect(refInstance).toBeTruthy()
      expect(refInstance).not.toBeNull()

      const ref = refInstance as unknown as DynamicVirtualListRef
      expect(typeof ref.measure).toBe('function')
      expect(typeof ref.scrollElement).toBe('function')
      expect(typeof ref.scrollToOffset).toBe('function')
      expect(typeof ref.scrollToIndex).toBe('function')
      expect(typeof ref.resizeItem).toBe('function')
      expect(typeof ref.getTotalSize).toBe('function')
      expect(typeof ref.getVirtualItems).toBe('function')
      expect(typeof ref.getVirtualIndexes).toBe('function')

      ref.measure()
      ref.scrollToOffset(100, { align: 'start' })
      ref.scrollToIndex(2, { align: 'center' })
      ref.resizeItem(1, 80)

      expect(mocks.virtualizer.measure).toHaveBeenCalledOnce()
      expect(mocks.virtualizer.scrollToOffset).toHaveBeenCalledWith(100, { align: 'start' })
      expect(mocks.virtualizer.scrollToIndex).toHaveBeenCalledWith(2, { align: 'center' })
      expect(mocks.virtualizer.resizeItem).toHaveBeenCalledWith(1, 80)
      expect(ref.getTotalSize()).toBe(150)
      expect(ref.getVirtualItems()).toEqual(mocks.virtualizer.getVirtualItems())
      expect(ref.getVirtualIndexes()).toEqual([0, 1, 2])
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

  describe('auto hide scrollbar', () => {
    it('should always show scrollbar when autoHideScrollbar is false', () => {
      render(<DynamicVirtualList {...defaultProps} autoHideScrollbar={false} />)

      const scrollContainer = document.querySelector('.dynamic-virtual-list') as HTMLElement
      expect(scrollContainer).toBeInTheDocument()

      // When autoHideScrollbar is false, scrollbar should always be visible
      expect(scrollContainer).not.toHaveAttribute('aria-hidden', 'true')
    })

    it('should hide only the scrollbar visuals when autoHideScrollbar is true', async () => {
      vi.useFakeTimers()

      render(<DynamicVirtualList {...defaultProps} autoHideScrollbar={true} />)

      const scrollContainer = document.querySelector('.dynamic-virtual-list') as HTMLElement
      expect(scrollContainer).toBeInTheDocument()

      // The content container remains exposed to assistive technology.
      expect(scrollContainer).not.toHaveAttribute('aria-hidden')
      expect(scrollContainer).toHaveStyle('scrollbar-color: transparent transparent')

      // We can't easily simulate real scroll events in JSDOM, so we'll test the internal logic directly
      // by calling the onChange handler which should update the state
      const onChangeCallback = mocks.useVirtualizer.mock.calls[0][0].onChange

      // Simulate scroll start
      act(() => {
        onChangeCallback({ isScrolling: true }, true)
      })

      // After scrolling starts, scrollbar should be visible
      expect(scrollContainer).not.toHaveAttribute('aria-hidden')
      expect(scrollContainer).toHaveStyle('scrollbar-color: var(--scrollbar-thumb) transparent')

      // Simulate scroll end
      act(() => {
        onChangeCallback({ isScrolling: false }, true)
      })

      // Advance timers to trigger the hide timeout
      act(() => {
        vi.advanceTimersByTime(10000)
      })

      // After timeout, scrollbar visuals should be hidden again
      expect(scrollContainer).not.toHaveAttribute('aria-hidden')
      expect(scrollContainer).toHaveStyle('scrollbar-color: transparent transparent')

      vi.useRealTimers()
    })
  })
})
