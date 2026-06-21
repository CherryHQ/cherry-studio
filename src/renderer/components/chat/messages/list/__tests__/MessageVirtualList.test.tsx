import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageVirtualList } from '../MessageVirtualList'

const runtimeMockState = vi.hoisted(() => ({
  isScrollToBottomButtonVisible: false,
  scrollToBottom: vi.fn(),
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
      keepMounted: [],
      scrollerProps: {
        onScroll: vi.fn(),
        onScrollEnd: vi.fn(),
        onWheel: vi.fn()
      },
      scrollerRef: { current: null },
      vlistHandleRef: { current: null },
      isScrollToBottomButtonVisible: runtimeMockState.isScrollToBottomButtonVisible,
      scrollToBottom: runtimeMockState.scrollToBottom,
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
    runtimeMockState.scrollToBottom.mockClear()
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
