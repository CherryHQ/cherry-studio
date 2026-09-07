import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Activity, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageVirtualList } from '../MessageVirtualList'
import { useScrollRuntimeBoundary } from '../ScrollOwnershipContext'

const runtimeMockState = vi.hoisted(() => ({
  isScrollToBottomButtonVisible: false,
  takeUserControl: vi.fn(),
  scrollToBottom: vi.fn(),
  notifyWheelIntent: vi.fn(),
  scrollByWheel: vi.fn(() => true),
  markUserInput: vi.fn(),
  beginScrollbarDrag: vi.fn(),
  endScrollbarDrag: vi.fn(),
  armAutoscrollCandidate: vi.fn(),
  confirmAutoscroll: vi.fn(),
  dismissAutoscroll: vi.fn(),
  onWheel: vi.fn(),
  shift: false,
  scrollerRef: { current: null as HTMLDivElement | null }
}))

const virtuaMockState = vi.hoisted(() => ({
  scrollRefReadyAtMount: [] as boolean[]
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    Button: ({ children, size, variant, ...props }: any) => {
      void size
      void variant
      return (
        <button type={props.type ?? 'button'} {...props}>
          {children}
        </button>
      )
    },
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
      t: (key: string) => (key === 'globalSearch.groups.message' ? 'Messages' : key)
    })
  }
})

vi.mock('virtua', () => {
  return {
    Virtualizer: ({ ref, scrollRef, children, data, shift, startMargin }: any) => {
      virtuaMockState.scrollRefReadyAtMount.push(Boolean(scrollRef.current))
      return (
        <div ref={ref} data-shift={String(shift)} data-start-margin={startMargin} data-testid="virtualizer">
          {data.map((item: unknown, index: number) => (
            <div key={index}>{children(item, index)}</div>
          ))}
        </div>
      )
    }
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
      scrollerRef: runtimeMockState.scrollerRef,
      vlistHandleRef: { current: null },
      isScrollToBottomButtonVisible: runtimeMockState.isScrollToBottomButtonVisible,
      takeUserControl: runtimeMockState.takeUserControl,
      scrollToBottom: runtimeMockState.scrollToBottom,
      notifyWheelIntent: runtimeMockState.notifyWheelIntent,
      scrollByWheel: runtimeMockState.scrollByWheel,
      markUserInput: runtimeMockState.markUserInput,
      beginScrollbarDrag: runtimeMockState.beginScrollbarDrag,
      endScrollbarDrag: runtimeMockState.endScrollbarDrag,
      armAutoscrollCandidate: runtimeMockState.armAutoscrollCandidate,
      confirmAutoscroll: runtimeMockState.confirmAutoscroll,
      dismissAutoscroll: runtimeMockState.dismissAutoscroll,
      shift: runtimeMockState.shift,
      wrappedItems: items,
      wrappedRenderItem: (item: unknown, index: number) =>
        createElement('div', { 'data-testid': `item-${index}` }, renderItem(item, index))
    }))
  }
})

function ScrollRuntimeBoundaryProbe() {
  const runtime = useScrollRuntimeBoundary()
  return (
    <>
      <button type="button" onClick={() => runtime.notifyWheelIntent(40)}>
        notify wheel
      </button>
      <button type="button" onClick={() => runtime.scrollByWheel(80)}>
        scroll by wheel
      </button>
    </>
  )
}

function renderMessageList(renderItem: () => ReactNode = () => <span>message-1</span>): HTMLElement {
  render(<MessageVirtualList items={['message-1']} getItemKey={(item) => item} renderItem={renderItem} />)
  return document.querySelector('[data-message-virtual-list-scroller]') as HTMLElement
}

describe('MessageVirtualList', () => {
  beforeEach(() => {
    runtimeMockState.isScrollToBottomButtonVisible = false
    runtimeMockState.takeUserControl.mockClear()
    runtimeMockState.scrollToBottom.mockClear()
    runtimeMockState.notifyWheelIntent.mockClear()
    runtimeMockState.scrollByWheel.mockClear()
    runtimeMockState.markUserInput.mockClear()
    runtimeMockState.beginScrollbarDrag.mockClear()
    runtimeMockState.endScrollbarDrag.mockClear()
    runtimeMockState.armAutoscrollCandidate.mockClear()
    runtimeMockState.confirmAutoscroll.mockClear()
    runtimeMockState.dismissAutoscroll.mockClear()
    runtimeMockState.onWheel.mockClear()
    runtimeMockState.shift = false
    runtimeMockState.scrollerRef.current = null
    virtuaMockState.scrollRefReadyAtMount.length = 0
  })

  it('mounts virtua only after the external scroller ref is ready', () => {
    renderMessageList()

    expect(screen.getByTestId('virtualizer')).toBeInTheDocument()
    expect(virtuaMockState.scrollRefReadyAtMount).not.toContain(false)
    expect(virtuaMockState.scrollRefReadyAtMount.length).toBeGreaterThan(0)
  })

  it('exposes the message viewport as a keyboard-focusable named region', () => {
    const scroller = renderMessageList()
    expect(scroller).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('region', { name: 'Messages' })).toBe(scroller)
    scroller.focus()
    expect(scroller).toHaveFocus()
  })

  it('takes keyboard scroll ownership after direct interaction with plain message content', () => {
    const scroller = renderMessageList(() => <span data-testid="plain-message-content">content</span>)
    const content = screen.getByTestId('plain-message-content')

    fireEvent.pointerDown(content)
    expect(scroller).toHaveFocus()

    scroller.blur()
    fireEvent.wheel(content, { deltaY: 40 })
    expect(scroller).toHaveFocus()
  })

  it('does not take keyboard ownership from editable message content', () => {
    renderMessageList(() => <textarea aria-label="Editable message content" />)

    const editor = screen.getByRole('textbox', { name: 'Editable message content' })
    editor.focus()
    fireEvent.pointerDown(editor)
    fireEvent.wheel(editor, { deltaY: 40 })

    expect(editor).toHaveFocus()
  })

  it('does not take keyboard ownership from an editor outside the message viewport on wheel', () => {
    render(
      <>
        <textarea aria-label="Composer" />
        <MessageVirtualList
          items={['message-1']}
          getItemKey={(item) => item}
          renderItem={() => <span data-testid="plain-message-content">content</span>}
        />
      </>
    )

    const composer = screen.getByRole('textbox', { name: 'Composer' })
    composer.focus()
    fireEvent.wheel(screen.getByTestId('plain-message-content'), { deltaY: 40 })

    expect(composer).toHaveFocus()
  })

  it('restores keyboard ownership when a focused virtualized descendant is removed', async () => {
    const scroller = renderMessageList(() => <div data-testid="virtualized-focus-owner" tabIndex={0} />)
    const focusOwner = screen.getByTestId('virtualized-focus-owner')
    focusOwner.focus()
    expect(focusOwner).toHaveFocus()

    focusOwner.remove()

    await waitFor(() => expect(scroller).toHaveFocus())
  })

  it('does not restore keyboard ownership when a mounted descendant deliberately blurs', async () => {
    const hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const scroller = renderMessageList(() => <div data-testid="virtualized-focus-owner" tabIndex={0} />)
    const focusOwner = screen.getByTestId('virtualized-focus-owner')
    try {
      focusOwner.focus()

      focusOwner.blur()
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(document.body).toHaveFocus()
      expect(scroller).not.toHaveFocus()
    } finally {
      hasFocusSpy.mockRestore()
    }
  })

  it('preserves an explicit focus move from a virtualized descendant to the composer', async () => {
    render(
      <>
        <textarea aria-label="Composer" />
        <MessageVirtualList
          items={['message-1']}
          getItemKey={(item) => item}
          renderItem={() => <div data-testid="virtualized-focus-owner" tabIndex={0} />}
        />
      </>
    )

    const composer = screen.getByRole('textbox', { name: 'Composer' })
    const focusOwner = screen.getByTestId('virtualized-focus-owner')
    focusOwner.focus()

    composer.focus()
    focusOwner.remove()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(composer).toHaveFocus()
  })

  it('keeps virtua mounted when a hidden tab detaches the scroller ref', () => {
    const TabbedList = ({ visible }: { visible: boolean }) => (
      <Activity mode={visible ? 'visible' : 'hidden'}>
        <MessageVirtualList
          items={['message-1']}
          getItemKey={(item) => item}
          renderItem={(item) => <span>{item}</span>}
        />
      </Activity>
    )

    const { rerender } = render(<TabbedList visible />)
    const virtualizerAtMount = screen.getByTestId('virtualizer')

    rerender(<TabbedList visible={false} />)
    rerender(<TabbedList visible />)

    // A remount would rebuild virtua from estimated sizes and drop every
    // message's own state, so the node identity must survive the round trip.
    expect(screen.getByTestId('virtualizer')).toBe(virtualizerAtMount)
    expect(runtimeMockState.scrollerRef.current).not.toBeNull()
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

  it('provides the runtime-owned wheel boundary to message content', () => {
    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={() => <ScrollRuntimeBoundaryProbe />}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'notify wheel' }))
    fireEvent.click(screen.getByRole('button', { name: 'scroll by wheel' }))

    expect(runtimeMockState.notifyWheelIntent).toHaveBeenCalledWith(40)
    expect(runtimeMockState.scrollByWheel).toHaveBeenCalledWith(80)
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
    expect(runtimeMockState.takeUserControl).not.toHaveBeenCalled()

    region.scrollTop = 200
    fireEvent.wheel(content, { deltaY: 40 })
    expect(runtimeMockState.onWheel).toHaveBeenCalledTimes(1)
  })

  it('keeps boundary wheel input in a contained nested scroller only while it has overflow', () => {
    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={() => (
          <div data-testid="nested-scroll-region" style={{ overflowY: 'auto', overscrollBehaviorY: 'contain' }}>
            <span data-testid="nested-scroll-content">content</span>
          </div>
        )}
      />
    )

    const region = screen.getByTestId('nested-scroll-region')
    const content = screen.getByTestId('nested-scroll-content')
    let scrollHeight = 300
    Object.defineProperty(region, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(region, 'scrollHeight', { configurable: true, get: () => scrollHeight })

    region.scrollTop = 200
    fireEvent.wheel(content, { deltaY: 40 })
    expect(runtimeMockState.onWheel).not.toHaveBeenCalled()
    expect(runtimeMockState.takeUserControl).not.toHaveBeenCalled()

    scrollHeight = 100
    region.scrollTop = 0
    fireEvent.wheel(content, { deltaY: 40 })
    expect(runtimeMockState.onWheel).toHaveBeenCalledTimes(1)
  })

  it('keeps nested scrollbar and keyboard scrolling independent from the outer runtime', () => {
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

    const scroller = document.querySelector('[data-message-virtual-list-scroller]') as HTMLElement
    const region = screen.getByTestId('nested-scroll-region')
    Object.defineProperty(region, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 300 })

    // A nested scroll with no preceding input (layout / streaming content)
    // must not flip the outer list out of following.
    fireEvent.scroll(region)
    expect(runtimeMockState.takeUserControl).not.toHaveBeenCalled()

    // Pointer drags and keyboard input owned by the nested scroller must not
    // seed the outer runtime either.
    fireEvent.pointerDown(region)
    fireEvent.pointerMove(region, { buttons: 1 })
    fireEvent.scroll(region)
    fireEvent.keyDown(region, { key: 'PageDown' })
    expect(runtimeMockState.takeUserControl).not.toHaveBeenCalled()
    expect(runtimeMockState.markUserInput).not.toHaveBeenCalled()
    fireEvent.pointerUp(document)

    // The outer scroller's own scroll events stay with the runtime's handlers.
    runtimeMockState.takeUserControl.mockClear()
    fireEvent.scroll(scroller)
    expect(runtimeMockState.takeUserControl).not.toHaveBeenCalled()
  })

  it('leaves vertical navigation keys with editable message content', () => {
    renderMessageList(() => <textarea aria-label="Editable message content" />)

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Editable message content' }), { key: 'ArrowDown' })

    expect(runtimeMockState.markUserInput).not.toHaveBeenCalled()
  })

  it.each([
    ['contenteditable', <div key="contenteditable" data-testid="editable-message-content" contentEditable />],
    ['textbox role', <div key="textbox" data-testid="editable-message-content" role="textbox" tabIndex={0} />]
  ])('leaves Space with editable message content exposed through %s', (_, editor) => {
    renderMessageList(() => editor)

    fireEvent.keyDown(screen.getByTestId('editable-message-content'), { key: ' ' })

    expect(runtimeMockState.markUserInput).not.toHaveBeenCalled()
  })

  it('hands keyboard and touch scrolling to the outer runtime at a nested boundary', () => {
    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={() => (
          <div data-testid="nested-scroll-region" style={{ overflowY: 'auto' }}>
            content
          </div>
        )}
      />
    )

    const region = screen.getByTestId('nested-scroll-region')
    Object.defineProperty(region, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 300 })
    region.scrollTop = 200

    fireEvent.keyDown(region, { key: 'PageDown' })
    expect(runtimeMockState.markUserInput).toHaveBeenCalledWith('down')

    runtimeMockState.markUserInput.mockClear()
    region.scrollTop = 0
    fireEvent.keyDown(region, { key: 'ArrowUp' })
    expect(runtimeMockState.markUserInput).toHaveBeenCalledWith('up')

    runtimeMockState.markUserInput.mockClear()
    region.scrollTop = 200
    const fireTouchPointerEvent = (type: 'pointerdown' | 'pointermove', clientY: number, buttons: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, {
        buttons: { value: buttons },
        clientY: { value: clientY },
        pointerType: { value: 'touch' }
      })
      fireEvent(region, event)
    }
    // jsdom has no PointerEvent constructor, so Testing Library otherwise
    // falls back to Event and silently drops pointer-specific init fields.
    fireTouchPointerEvent('pointerdown', 100, 1)
    fireTouchPointerEvent('pointermove', 80, 1)
    expect(runtimeMockState.markUserInput).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(document)

    runtimeMockState.markUserInput.mockClear()
    region.style.overscrollBehaviorY = 'contain'
    fireEvent.keyDown(region, { key: 'PageDown' })
    expect(runtimeMockState.markUserInput).not.toHaveBeenCalled()
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

  it('keeps native scrollbar drag ownership until the pointer is released', () => {
    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />
    )

    const scroller = document.querySelector('[data-message-virtual-list-scroller]') as HTMLElement
    fireEvent.pointerDown(scroller)
    expect(runtimeMockState.beginScrollbarDrag).toHaveBeenCalledTimes(1)
    expect(runtimeMockState.endScrollbarDrag).not.toHaveBeenCalled()

    fireEvent.pointerUp(document)
    expect(runtimeMockState.endScrollbarDrag).toHaveBeenCalledTimes(1)
  })

  it('arms candidate on middle press and confirms only after outer scroller moves', () => {
    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />
    )

    const scroller = document.querySelector('[data-message-virtual-list-scroller]') as HTMLElement
    fireEvent.mouseDown(scroller, { button: 1 })
    expect(runtimeMockState.armAutoscrollCandidate).toHaveBeenCalledTimes(1)
    expect(runtimeMockState.confirmAutoscroll).not.toHaveBeenCalled()

    scroller.scrollTop = 100
    fireEvent.scroll(scroller)
    expect(runtimeMockState.confirmAutoscroll).toHaveBeenCalledTimes(1)
  })

  it('forwards dismiss on other clicks, Escape, blur and unmount', () => {
    const { unmount } = render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />
    )

    const scroller = document.querySelector('[data-message-virtual-list-scroller]') as HTMLElement
    fireEvent.mouseDown(scroller, { button: 1 })
    expect(runtimeMockState.armAutoscrollCandidate).toHaveBeenCalledTimes(1)

    runtimeMockState.armAutoscrollCandidate.mockClear()
    fireEvent.mouseDown(scroller, { button: 1 })
    expect(runtimeMockState.armAutoscrollCandidate).toHaveBeenCalledTimes(1)

    runtimeMockState.dismissAutoscroll.mockClear()
    fireEvent.mouseDown(document.body, { button: 0 })
    expect(runtimeMockState.dismissAutoscroll).toHaveBeenCalledTimes(1)

    runtimeMockState.dismissAutoscroll.mockClear()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(runtimeMockState.dismissAutoscroll).toHaveBeenCalledTimes(1)

    runtimeMockState.dismissAutoscroll.mockClear()
    fireEvent.blur(window)
    expect(runtimeMockState.dismissAutoscroll).toHaveBeenCalledTimes(1)

    runtimeMockState.dismissAutoscroll.mockClear()
    unmount()
    expect(runtimeMockState.dismissAutoscroll).toHaveBeenCalledTimes(1)
  })

  it('confirms autoscroll only from the outer scroller, not nested regions', () => {
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
    Object.defineProperty(region, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 300 })

    fireEvent.mouseDown(screen.getByTestId('nested-scroll-content'), { button: 1 })
    region.scrollTop = 50
    fireEvent.scroll(region)
    expect(runtimeMockState.confirmAutoscroll).not.toHaveBeenCalled()

    const scroller = document.querySelector('[data-message-virtual-list-scroller]') as HTMLElement
    scroller.scrollTop = 20
    fireEvent.scroll(scroller)
    expect(runtimeMockState.confirmAutoscroll).toHaveBeenCalledTimes(1)
  })

  it('records only scroll intent from ordinary input and removes the listeners on unmount', () => {
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
    expect(runtimeMockState.takeUserControl).not.toHaveBeenCalled()

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

    expect(runtimeMockState.scrollToBottom).toHaveBeenCalledWith()
  })
})
