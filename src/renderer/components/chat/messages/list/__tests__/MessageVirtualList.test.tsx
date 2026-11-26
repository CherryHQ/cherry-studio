import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as LucideReact from 'lucide-react'
import { Activity, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import MessageFrame from '../../frame/MessageFrame'
import { MessageListProvider } from '../../MessageListProvider'
import { DEFAULT_MESSAGE_LIST_CONFIG, defaultMessageRenderConfig, type MessageListItem } from '../../types'
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
  scrollSettled: true,
  scrollerRef: { current: null as HTMLDivElement | null }
}))

const virtuaMockState = vi.hoisted(() => ({
  scrollRefReadyAtMount: [] as boolean[],
  mountedItems: undefined as string[] | undefined
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

vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<typeof LucideReact>()),
  ArrowDown: () => <svg data-testid="scroll-arrow-icon" />
}))

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
          {data.map((item: string, index: number) =>
            !virtuaMockState.mountedItems || virtuaMockState.mountedItems.includes(item) ? (
              <div key={item}>{children(item, index)}</div>
            ) : null
          )}
        </div>
      )
    }
  }
})

vi.mock('../chatVirtualizerRuntime', async () => {
  const { createElement, useEffect } = await import('react')
  return {
    useChatVirtualizerRuntime: vi.fn(({ items, renderItem, onInitialScrollSettled }) => {
      const scrollSettled = runtimeMockState.scrollSettled
      useEffect(() => {
        if (scrollSettled && items.length) onInitialScrollSettled()
      }, [items.length, onInitialScrollSettled, scrollSettled])
      return {
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
      }
    })
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

const historyMarkdown = Array.from({ length: 25 }, (_, index) => `History section ${index + 1}`).join('\n\n')

function historyList(ids: string[], { live = false, enabled = ids.length > 0 } = {}) {
  return (
    <MessageVirtualList
      animateEntrance={enabled}
      items={ids}
      getItemKey={(id) => id}
      renderItem={(id) => {
        const isLive = id === 'live' && live
        const message: MessageListItem = {
          id,
          role: id === 'prompt' ? 'user' : 'assistant',
          topicId: 'topic',
          createdAt: '2026-01-01T00:00:00Z',
          status: isLive ? 'pending' : 'success'
        }
        const parts: CherryMessagePart[] = [
          {
            type: 'text',
            text: id === 'history' ? historyMarkdown : id === 'prompt' ? '**Literal prompt**' : id,
            state: isLive ? 'streaming' : 'done'
          }
        ]
        if (id === 'prompt') {
          parts.push({ type: 'file', url: 'https://example.test/image.png', mediaType: 'image/png' })
        }
        if (id === 'tool' || id === 'mcp') {
          parts.unshift({
            type: 'dynamic-tool',
            toolName: 'Test tool',
            toolCallId: 'tool-call',
            state: 'output-available',
            input: {},
            output:
              id === 'mcp'
                ? {
                    metadata: {
                      type: 'mcp',
                      app: { serverId: 'server', serverKey: 'key', toolName: 'tool', resourceUri: 'ui://result' }
                    }
                  }
                : 'Tool output'
          })
        }
        return (
          <MessageListProvider
            value={{
              state: {
                ...DEFAULT_MESSAGE_LIST_CONFIG,
                topic: {
                  id: 'topic',
                  name: 'History',
                  assistantId: undefined,
                  createdAt: '',
                  updatedAt: '',
                  lastActivityAt: '',
                  messages: []
                },
                partsByMessageId: { [id]: parts },
                messages: [message],
                messageNavigation: 'none',
                renderConfig: defaultMessageRenderConfig,
                getMessageActivityState: () => ({
                  isProcessing: isLive,
                  isStreamTarget: isLive,
                  isApprovalAnchor: false,
                  isActiveTurnProcessing: isLive,
                  isStreamLive: isLive
                })
              },
              actions: id === 'mcp' ? { openMcpApp: () => new Promise(() => {}) } : {},
              meta: { selectionLayer: false }
            }}>
            <div data-message-id={id}>
              <MessageFrame message={message} hideMenuBar />
            </div>
          </MessageListProvider>
        )
      }}
    />
  )
}

function entranceList(blocks: string[], clipHeight?: number) {
  return (
    <MessageVirtualList
      animateEntrance
      items={['row']}
      getItemKey={(id) => id}
      renderItem={(id) => (
        <div data-message-id={id}>
          <div
            data-clip-height={clipHeight}
            style={clipHeight === undefined ? undefined : { overflowY: 'hidden', height: clipHeight }}
            ref={(element) => {
              if (element && clipHeight !== undefined) {
                Object.defineProperty(element, 'clientHeight', { configurable: true, value: clipHeight })
              }
            }}>
            {blocks.map((block) => (
              <div data-message-entrance-unit="" key={block}>
                {block}
              </div>
            ))}
            {blocks.length === 0 && <span>Timeline marker</span>}
          </div>
        </div>
      )}
    />
  )
}

describe('MessageVirtualList history entrance', () => {
  const animate = vi.fn<Element['animate']>()
  const motionPreference = Object.assign(new EventTarget(), { matches: false })
  const nativeAnimateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
  const nativeMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
  const nativeObserverDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver')

  const animatedText = () => (animate.mock.contexts as Element[]).map((element) => element.textContent)
  const flushMount = async () => {
    await act(async () => {
      await Promise.resolve()
      vi.advanceTimersToNextFrame()
    })
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
    vi.spyOn(performance, 'now').mockReturnValue(0)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.hasAttribute('data-message-virtual-list-scroller')) return new DOMRect(0, 0, 200, 130)
      if (this.hasAttribute('data-clip-height'))
        return new DOMRect(0, 0, 100, Number(this.getAttribute('data-clip-height')))
      if (this.matches('[data-clip-height] > [data-message-entrance-unit]') && this.textContent === 'Clipped') {
        return new DOMRect(0, 70, 100, 10)
      }
      if (this.closest('[data-message-id="offscreen"]')) return new DOMRect(0, 140, 100, 10)
      const section = this.matches('p') && this.textContent?.match(/^History section (\d+)$/)?.[1]
      if (section) {
        const offset = this.closest('[data-message-virtual-list-scroller]')?.scrollTop ?? 0
        return new DOMRect(0, (Number(section) - 11) * 10 - 5 - offset, 100, 10)
      }
      return new DOMRect(0, 10, 100, 20)
    })
    animate.mockClear()
    motionPreference.matches = false
    runtimeMockState.scrollSettled = true
    virtuaMockState.mountedItems = undefined
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => motionPreference })
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate })
  })

  afterEach(() => {
    if (nativeAnimateDescriptor) Object.defineProperty(Element.prototype, 'animate', nativeAnimateDescriptor)
    else Reflect.deleteProperty(Element.prototype, 'animate')
    if (nativeMatchMediaDescriptor) Object.defineProperty(window, 'matchMedia', nativeMatchMediaDescriptor)
    else Reflect.deleteProperty(window, 'matchMedia')
    vi.mocked(performance.now).mockRestore()
    vi.mocked(Element.prototype.getBoundingClientRect).mockRestore()
    if (nativeObserverDescriptor) Object.defineProperty(globalThis, 'IntersectionObserver', nativeObserverDescriptor)
    else Reflect.deleteProperty(globalThis, 'IntersectionObserver')
    vi.useRealTimers()
    runtimeMockState.scrollSettled = true
    virtuaMockState.mountedItems = undefined
  })

  it('staggers every visible block of a long reply even when its first ten blocks are above the viewport', async () => {
    render(historyList(['history', 'offscreen']), { reactStrictMode: true })

    expect(screen.getByText('History section 1').tagName).toBe('P')
    expect(screen.getByText('History section 25').tagName).toBe('P')
    expect(animatedText()).toEqual([
      'History section 11',
      'History section 12',
      'History section 13',
      'History section 14',
      'History section 15',
      'History section 16',
      'History section 17',
      'History section 18',
      'History section 19',
      'History section 20',
      'History section 21',
      'History section 22',
      'History section 23',
      'History section 24'
    ])
    const delays = animate.mock.calls.map(([, timing]) => (timing as KeyframeAnimationOptions).delay ?? 0)
    expect(delays[0]).toBe(0)
    expect(delays.every((delay, i) => i === 0 || delay > delays[i - 1])).toBe(true)
    expect(delays.at(-1)).toBeLessThanOrEqual(270)

    animate.mockClear()
    const scroller = screen.getByRole('region', { name: 'Messages' })
    scroller.scrollTop = 10
    fireEvent.scroll(scroller)
    await flushMount()
    expect(animatedText()).toEqual(['History section 25'])
  })

  it('animates a plain-text prompt, its hoisted image, and the reply and tool units in the viewport', () => {
    render(historyList(['prompt', 'tool', 'offscreen']))

    const prompt = screen.getByText('**Literal prompt**')
    const reply = screen.getByText('tool', { selector: 'p' })
    const targets = animate.mock.contexts as Element[]
    expect(prompt.tagName).toBe('P')
    expect(targets.map((element) => element.closest('[data-message-id]')?.getAttribute('data-message-id'))).toEqual([
      'prompt',
      'prompt',
      'tool',
      'tool'
    ])
    expect(targets[0].querySelector('img')?.src).toBe('https://example.test/image.png')
    expect(targets[1]).toContainElement(prompt)
    expect(targets[2]).toBe(screen.getByTestId('completed-process-trigger'))
    expect(targets[3]).toBe(reply)
  })

  it('staggers the MCP app result card with the tool summary and reply', async () => {
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: class {
        constructor(private readonly callback: IntersectionObserverCallback) {}
        observe(target: Element) {
          this.callback(
            [{ target, isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          )
        }
        disconnect() {}
      }
    })
    render(historyList(['mcp']))
    await flushMount()

    const targets = animate.mock.contexts as Element[]
    expect(targets).toHaveLength(3)
    expect(targets[0]).toBe(screen.getByTestId('completed-process-trigger'))
    expect(targets[1]).toBe(screen.getByText('mcp', { selector: 'p' }))
    expect(targets[2]).toContainElement(screen.getByRole('status'))
    const delays = animate.mock.calls.map(([, timing]) => (timing as KeyframeAnimationOptions).delay)
    expect(delays).toEqual([0, 30, 60])
  })

  it('opens the entrance after an empty list is enabled and the target viewport has settled', async () => {
    runtimeMockState.scrollSettled = false
    const view = render(historyList([]))
    vi.mocked(performance.now).mockReturnValue(1_000)
    view.rerender(historyList(['before-scroll']))
    await flushMount()
    expect(screen.getByText('before-scroll')).toBeVisible()
    expect(animatedText()).toEqual([])

    runtimeMockState.scrollSettled = true
    view.rerender(historyList(['offscreen']))
    expect(animatedText()).toEqual([])

    vi.mocked(performance.now).mockReturnValue(2_000)
    view.rerender(historyList(['offscreen', 'arrived']))
    await flushMount()
    expect(animatedText()).toEqual(['arrived'])
  })

  it('does not replay a history row remounted by the virtualizer inside the entrance window', async () => {
    const ids = ['initial', 'later']
    virtuaMockState.mountedItems = ['initial']
    const view = render(historyList(ids))
    const original = screen.getByText('initial')
    expect(animatedText()).toEqual(['initial'])

    virtuaMockState.mountedItems = ['later']
    view.rerender(historyList(ids))
    await flushMount()
    expect(original).not.toBeInTheDocument()
    expect(animatedText()).toEqual(['initial', 'later'])

    virtuaMockState.mountedItems = ids
    view.rerender(historyList(ids))
    await flushMount()
    expect(screen.getByText('initial')).not.toBe(original)
    expect(animatedText()).toEqual(['initial', 'later'])
  })

  it('animates only the newly inserted block between two already played blocks', async () => {
    const view = render(entranceList(['X', 'Y']))
    expect(animatedText()).toEqual(['X', 'Y'])
    expect(animate.mock.calls.map(([, timing]) => (timing as KeyframeAnimationOptions).delay)).toEqual([0, 30])

    view.rerender(entranceList(['X', 'Z', 'Y']))
    await flushMount()
    expect(animatedText()).toEqual(['X', 'Y', 'Z'])
  })

  it('animates a block clipped by an inner card only once the card reveals it', async () => {
    const view = render(entranceList(['Visible', 'Clipped'], 40))
    expect(animatedText()).toEqual(['Visible'])

    view.rerender(entranceList(['Visible', 'Clipped'], 90))
    await flushMount()
    expect(animatedText()).toEqual(['Visible', 'Clipped'])
  })

  it('keeps messages static when they arrive after the initial viewport stayed marker-only', async () => {
    const view = render(entranceList([]))
    expect(screen.getByText('Timeline marker')).toBeVisible()
    expect(animatedText()).toEqual([])

    vi.mocked(performance.now).mockReturnValue(5 * 60_000)
    view.rerender(entranceList(['Late reply']))
    await flushMount()
    expect(screen.getByText('Late reply')).toBeVisible()
    expect(animatedText()).toEqual([])
  })

  it('keeps the visible history static with reduced motion enabled', () => {
    motionPreference.matches = true
    render(historyList(['visible', 'offscreen']))

    expect(screen.getByText('visible')).toBeVisible()
    expect(animatedText()).toEqual([])
  })

  it('keeps newly visible rows static after the 650 ms window expires', async () => {
    const view = render(historyList(['initial']))
    expect(animatedText()).toEqual(['initial'])

    vi.mocked(performance.now).mockReturnValue(649)
    view.rerender(historyList(['initial', 'in-window']))
    await flushMount()
    expect(animatedText()).toEqual(['initial', 'in-window'])

    vi.mocked(performance.now).mockReturnValue(650)
    view.rerender(historyList(['initial', 'in-window', 'late']))
    await flushMount()
    expect(screen.getByText('late')).toBeVisible()
    expect(animatedText()).toEqual(['initial', 'in-window'])
  })

  it('keeps a live reply out of the entrance after it finishes and remounts as static Markdown', async () => {
    const view = render(historyList(['initial', 'live'], { live: true }))
    expect(animatedText()).toEqual(['initial'])

    view.rerender(historyList(['initial']))
    await flushMount()
    view.rerender(historyList(['initial', 'live']))
    await flushMount()
    expect(screen.getByText('live', { selector: 'p' })).toBeVisible()
    expect(animatedText()).toEqual(['initial'])
  })
})

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

    fireEvent.click(button)

    expect(runtimeMockState.scrollToBottom).toHaveBeenCalledWith()
  })
})
