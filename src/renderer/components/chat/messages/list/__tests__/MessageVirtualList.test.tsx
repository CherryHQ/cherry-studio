import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageVirtualList } from '../MessageVirtualList'

const runtimeMockState = vi.hoisted(() => ({
  isScrollToBottomButtonVisible: false,
  releaseUserControlIfAtBottomAfterLayout: vi.fn(),
  takeUserControl: vi.fn(),
  scrollToBottom: vi.fn(),
  markUserInput: vi.fn(),
  onWheel: vi.fn(),
  shift: false
}))

vi.mock('@cherrystudio/ui', () => {
  return {
    Button: ({ children, size, variant, ...props }: any) => {
      void size
      void variant
      return (
        <button type={props.type ?? 'button'} {...props}>
          {children}
        </button>
      )
    },
    Scrollbar: ({ ref, children, ...props }: any) => (
      <div ref={ref} {...props}>
        {children}
      </div>
    ),
    Tooltip: ({ children }: any) => <>{children}</>
  }
})

vi.mock('lucide-react', () => {
  return {
    ArrowDown: () => <svg data-testid="scroll-arrow-icon" />
  }
})

vi.mock('react-i18next', () => {
  return {
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('virtua', () => {
  return {
    Virtualizer: ({ ref, children, data, shift, startMargin }: any) => (
      <div ref={ref} data-shift={String(shift)} data-start-margin={startMargin} data-testid="virtualizer">
        {data.map((item: unknown, index: number) => (
          <div key={index}>{children(item, index)}</div>
        ))}
      </div>
    )
  }
})

vi.mock('../chatVirtualizerRuntime', async () => {
  const { createElement } = await import('react')
  return {
    useChatVirtualizerRuntime: vi.fn(({ items, renderItem }) => ({
      contentRef: { current: null },
      freezeSpacerRef: { current: null },
      keepMounted: [],
      scrollerProps: {
        onScroll: vi.fn(),
        onScrollEnd: vi.fn(),
        onWheel: runtimeMockState.onWheel
      },
      scrollerRef: { current: null },
      vlistHandleRef: { current: null },
      isScrollToBottomButtonVisible: runtimeMockState.isScrollToBottomButtonVisible,
      releaseUserControlIfAtBottomAfterLayout: runtimeMockState.releaseUserControlIfAtBottomAfterLayout,
      takeUserControl: runtimeMockState.takeUserControl,
      scrollToBottom: runtimeMockState.scrollToBottom,
      markUserInput: runtimeMockState.markUserInput,
      shift: runtimeMockState.shift,
      wrappedItems: items,
      wrappedRenderItem: (item: unknown, index: number) =>
        createElement('div', { 'data-testid': `item-${index}` }, renderItem(item, index))
    }))
  }
})

describe('MessageVirtualList', () => {
  beforeEach(() => {
    runtimeMockState.isScrollToBottomButtonVisible = false
    runtimeMockState.releaseUserControlIfAtBottomAfterLayout.mockClear()
    runtimeMockState.takeUserControl.mockClear()
    runtimeMockState.scrollToBottom.mockClear()
    runtimeMockState.markUserInput.mockClear()
    runtimeMockState.onWheel.mockClear()
    runtimeMockState.shift = false
  })

  it('renders the top padding as real scroll content before the virtualizer', () => {
    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
        topPadding={44}
      />
    )

    const spacer = document.querySelector('[data-message-virtual-list-top-spacer]')
    expect(spacer).toHaveStyle({ height: '44px' })
    expect(spacer?.nextElementSibling).toBe(screen.getByTestId('virtualizer'))
    expect(screen.getByTestId('virtualizer')).toHaveAttribute('data-start-margin', '44')
  })

  it('passes prepend shift compensation to virtua', () => {
    runtimeMockState.shift = true

    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />
    )

    expect(screen.getByTestId('virtualizer')).toHaveAttribute('data-shift', 'true')
  })

  it('registers wheel handling as a native passive listener', async () => {
    const addEventListenerSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener')

    try {
      render(
        <MessageVirtualList
          items={['message-1']}
          getItemKey={(item) => item}
          renderItem={(item) => <span>{item}</span>}
        />
      )

      await waitFor(() => {
        expect(addEventListenerSpy).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: true })
      })
    } finally {
      addEventListenerSpy.mockRestore()
    }
  })

  it('leaves wheel input inside a scrollable message region there until it reaches the boundary', () => {
    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={() => (
          <div data-testid="nested-scroll-region" style={{ overflowY: 'auto' }}>
            <span data-testid="nested-scroll-content">content</span>
          </div>
        )}
      />
    )

    const region = screen.getByTestId('nested-scroll-region')
    const content = screen.getByTestId('nested-scroll-content')
    Object.defineProperty(region, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 300 })

    region.scrollTop = 50
    fireEvent.wheel(content, { deltaY: 40 })
    expect(runtimeMockState.onWheel).not.toHaveBeenCalled()
    expect(runtimeMockState.takeUserControl).toHaveBeenCalledWith(content)

    region.scrollTop = 200
    fireEvent.wheel(content, { deltaY: 40 })
    expect(runtimeMockState.onWheel).toHaveBeenCalledTimes(1)
  })

  it('ignores purely horizontal wheel input instead of taking scroll ownership', () => {
    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />
    )

    const scroller = document.querySelector('[data-message-virtual-list-scroller]') as HTMLElement
    fireEvent.wheel(scroller, { deltaY: 0, deltaX: 40 })
    expect(runtimeMockState.onWheel).not.toHaveBeenCalled()
    expect(runtimeMockState.takeUserControl).not.toHaveBeenCalled()
  })

  it('marks scroll intent only for pointer drags that pressed inside the scroller', () => {
    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />
    )

    const scroller = document.querySelector('[data-message-virtual-list-scroller]') as HTMLElement

    // A drag entering from outside (text selection started in the composer)
    // must not count as scroll intent.
    fireEvent.pointerMove(scroller, { buttons: 1 })
    expect(runtimeMockState.markUserInput).not.toHaveBeenCalled()

    fireEvent.pointerDown(screen.getByTestId('item-0'))
    fireEvent.pointerMove(scroller, { buttons: 1 })
    expect(runtimeMockState.markUserInput).toHaveBeenCalledTimes(1)

    // Releasing anywhere ends the gesture, even off-list.
    fireEvent.pointerUp(document)
    fireEvent.pointerMove(scroller, { buttons: 1 })
    expect(runtimeMockState.markUserInput).toHaveBeenCalledTimes(1)
  })

  it('separates direct takeover from actual scroll-intent signals and removes the listeners on unmount', () => {
    const { unmount } = render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />
    )

    const scroller = document.querySelector('[data-message-virtual-list-scroller]') as HTMLElement
    expect(scroller).toBeTruthy()
    const removeSpy = vi.spyOn(scroller, 'removeEventListener')

    const item = screen.getByTestId('item-0')
    fireEvent.pointerDown(item)
    fireEvent.keyDown(scroller, { key: 'PageDown' })
    fireEvent.pointerMove(scroller, { buttons: 1 })
    expect(runtimeMockState.markUserInput).toHaveBeenCalledTimes(2)
    // Every direct input inside the scroller hands the user the wheel —
    // deliberately unclassified (blocks, buttons and blank space all count).
    expect(runtimeMockState.takeUserControl).toHaveBeenCalledTimes(2)

    unmount()
    expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('renders a scroll-to-bottom button when the runtime is far from bottom', () => {
    runtimeMockState.isScrollToBottomButtonVisible = true

    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
        showScrollToBottomButton
        scrollToBottomButtonBottomOffset={88}
      />
    )

    const button = screen.getByTestId('message-scroll-to-bottom-button')
    expect(button).toHaveAttribute('aria-label', 'chat.navigation.bottom')
    expect(button).toHaveClass('h-9', 'w-9')
    expect(screen.getByTestId('scroll-arrow-icon')).toBeInTheDocument()
    expect(document.querySelector('[data-message-scroll-to-bottom-button-layer]')).toHaveClass('z-5')
    expect(document.querySelector('[data-message-scroll-to-bottom-button-layer]')).toHaveStyle({ bottom: '88px' })

    fireEvent.click(button)

    expect(runtimeMockState.scrollToBottom).toHaveBeenCalledWith('smooth')
  })
})
