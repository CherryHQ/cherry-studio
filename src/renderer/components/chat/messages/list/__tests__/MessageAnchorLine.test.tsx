// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, createContext, use } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import type { MessageListItem } from '../../types'
import MessageAnchorLine from '../MessageAnchorLine'

const partsMap: Record<string, CherryMessagePart[]> = {}

/** The real `useMessageParts` is a context read, so a chunk reaches the live
 * preview leaf without the memoized rail re-rendering. Mocking it as a plain
 * map read would lose exactly that, letting a parent re-render masquerade as
 * live-leaf isolation — so the stand-in is a real context too. */
const LivePartsContext = createContext<Record<string, CherryMessagePart[]>>({})

vi.mock('../../blocks/MessagePartsContext', () => ({
  useMessageParts: (messageId: string) => use(LivePartsContext)[messageId] ?? []
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'number' in options ? `${key} ${options.number}` : key
  })
}))

function makeMessage(overrides: Partial<MessageListItem> & Pick<MessageListItem, 'id' | 'role'>): MessageListItem {
  return {
    topicId: 'topic-1',
    parentId: null,
    createdAt: '2026-07-02T00:00:00.000Z',
    status: 'success',
    ...overrides
  }
}

const messages: MessageListItem[] = [
  makeMessage({ id: 'user-1', role: 'user' }),
  makeMessage({ id: 'assistant-1', role: 'assistant', parentId: 'user-1' }),
  makeMessage({ id: 'user-2', role: 'user' }),
  makeMessage({ id: 'assistant-2', role: 'assistant', parentId: 'user-2' }),
  makeMessage({ id: 'assistant-2b', role: 'assistant', parentId: 'user-2' }),
  makeMessage({ id: 'user-3', role: 'user' }),
  makeMessage({ id: 'assistant-3', role: 'assistant', parentId: 'user-3' }),
  makeMessage({ id: 'user-4', role: 'user' }),
  makeMessage({ id: 'assistant-4', role: 'assistant', parentId: 'user-4' }),
  makeMessage({ id: 'user-5', role: 'user' }),
  makeMessage({ id: 'assistant-5', role: 'assistant', parentId: 'user-5' })
]

function makeTurnMessages(count: number, startIndex = 0): MessageListItem[] {
  const result: MessageListItem[] = []
  for (let i = 0; i < count; i++) {
    const n = startIndex + i
    result.push(makeMessage({ id: `turn-user-${n}`, role: 'user' }))
    result.push(makeMessage({ id: `turn-assistant-${n}`, role: 'assistant', parentId: `turn-user-${n}` }))
  }
  return result
}

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text })

/** Wrapper height the geometry helpers report; comfortably above the rail's
 * minimum usable height. Rail viewport = 400 − 2 · 24 (edge margins) = 352. */
const RAIL_HEIGHT_PX = 400
const RAIL_VIEWPORT_PX = 352

interface StripMetrics {
  wrapperHeight?: number
  scrollHeight: number
  clientHeight: number
}

/** JSDOM has no layout; supply mutable dimensions and explicit resize delivery
 * so tests can exercise the rail's height gate and strip geometry. */
function installRailGeometry(metrics: StripMetrics) {
  const originalResizeObserver = globalThis.ResizeObserver
  const observers = new Map<ResizeObserverMock, ResizeObserverCallback>()

  class ResizeObserverMock {
    constructor(private readonly callback: ResizeObserverCallback) {}

    disconnect = vi.fn(() => observers.delete(this))
    observe = vi.fn(() => observers.set(this, this.callback))
    unobserve = vi.fn()
  }

  globalThis.ResizeObserver = ResizeObserverMock

  const isStrip = (element: HTMLElement) => element.classList.contains('overflow-y-auto')
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 32,
      bottom: metrics.wrapperHeight ?? RAIL_HEIGHT_PX,
      width: 32,
      height: metrics.wrapperHeight ?? RAIL_HEIGHT_PX,
      toJSON: () => ({})
    }
  }
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isStrip(this) ? metrics.scrollHeight : 0
    }
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isStrip(this) ? metrics.clientHeight : 0
    }
  })

  return {
    restore: () => {
      globalThis.ResizeObserver = originalResizeObserver
      // The overrides shadow Element.prototype's originals — deleting restores them.
      // (Reflect.deleteProperty: `delete` on the readonly-typed properties is a TS2704.)
      Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect')
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
    },
    notifyResize: () => observers.forEach((callback, observer) => callback([], observer))
  }
}

/** Pointer state lands on the next frame, so every hover assertion has to flush
 * one first. A deterministic queue beats waiting on a real frame: it also
 * proves the coalescing (one request for many moves) the component relies on. */
function installDeferredAnimationFrame() {
  const callbacks: FrameRequestCallback[] = []
  const request = vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback)
    return callbacks.length
  })

  vi.stubGlobal('requestAnimationFrame', request)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())

  return {
    request,
    flushNext: () => {
      const callback = callbacks.shift()
      expect(callback).toBeDefined()
      act(() => callback?.(0))
    }
  }
}

type RailProps = ComponentProps<typeof MessageAnchorLine>

const NO_LIVE_MESSAGE_IDS: readonly string[] = []

/** MessageList always hands the rail an explicit history/live split. Tests that
 * don't exercise streaming treat the shared map as pure history; `liveParts`
 * stands in for the streaming PartsContext the live preview leaf reads. */
const rail = (
  props: Partial<RailProps> & Pick<RailProps, 'messages'>,
  liveParts: Record<string, CherryMessagePart[]> = partsMap
) => (
  <LivePartsContext value={liveParts}>
    <MessageAnchorLine historyPartsByMessageId={partsMap} liveMessageIds={NO_LIVE_MESSAGE_IDS} {...props} />
  </LivePartsContext>
)

const renderRail = (...args: Parameters<typeof rail>) => render(rail(...args))

let restoreGeometry: (() => void) | null = null

/** Center Y of tick `index` with 5 turns, full geometry, and no strip scroll:
 * 24 (edge margin) + 151 (centring pad) + index · 10 + 5. */
const tickCenterOf5 = (index: number) => 180 + index * 10

afterEach(() => {
  restoreGeometry?.()
  restoreGeometry = null
  for (const key of Object.keys(partsMap)) delete partsMap[key]
  vi.unstubAllGlobals()
})

describe('MessageAnchorLine', () => {
  it('renders one tick per conversation turn', () => {
    const { container } = renderRail({ messages })

    expect(container.querySelectorAll('[data-message-anchor-tick]')).toHaveLength(5)
  })

  it('does not create a tick for a clear-context boundary', () => {
    const boundary = makeMessage({ id: 'clear-context', role: 'user', isContextBoundary: true })
    const messagesWithBoundary = [...messages.slice(0, 5), boundary, ...messages.slice(5)]
    const { container } = renderRail({ messages: messagesWithBoundary })

    expect(container.querySelectorAll('[data-message-anchor-tick]')).toHaveLength(5)
  })

  it('shows an anchor from the first conversation turn', () => {
    const { getAllByRole } = renderRail({ messages: messages.slice(0, 2) })

    expect(getAllByRole('button')).toHaveLength(1)
  })

  it('marks the turn containing the active message', () => {
    const { container } = renderRail({ messages, activeMessageId: 'assistant-1' })

    const ticks = container.querySelectorAll('[data-message-anchor-tick]')
    expect(ticks[0]).toHaveAttribute('data-active', 'true')
    expect(ticks[1]).toHaveAttribute('data-active', 'false')
  })

  it('scrolls to the turn start message on tick click', () => {
    const scrollToMessageId = vi.fn()
    const { container } = renderRail({ messages, scrollToMessageId })

    const ticks = container.querySelectorAll('[data-message-anchor-tick]')
    fireEvent.click(ticks[1])

    expect(scrollToMessageId).toHaveBeenCalledWith('user-2')
  })

  it('stops the rail above the composer overlay when a bottom inset is provided', () => {
    const { container } = renderRail({ messages, bottomInset: 120 })

    // DOM serialization may reorder calc() terms, so assert the sum, not the order.
    expect((container.firstElementChild as HTMLElement).style.bottom).toMatch(
      /^calc\((?:2rem \+ 120px|120px \+ 2rem)\)$/
    )
  })

  it('renders nothing without messages', () => {
    const { container } = renderRail({ messages: [] })

    expect(container.firstElementChild).toBeNull()
  })

  describe('interactivity gating', () => {
    it.each([0.01, 0])('stays visible and navigable at zero gutter (railOpacity: %s)', (railOpacity) => {
      restoreGeometry = installRailGeometry({ scrollHeight: RAIL_VIEWPORT_PX, clientHeight: RAIL_VIEWPORT_PX }).restore
      const scrollToMessageId = vi.fn()
      const { container, getByRole } = renderRail({ messages, railOpacity, scrollToMessageId })

      const wrapper = container.firstElementChild as HTMLElement
      const strip = wrapper.querySelector<HTMLElement>('.overflow-y-auto') as HTMLElement
      expect(wrapper).not.toHaveAttribute('inert')
      expect(wrapper).not.toHaveClass('pointer-events-none')
      expect(wrapper.style.width).toBe('8px')
      expect(strip.style.opacity).toBe('0.7')

      fireEvent.click(getByRole('button', { name: 'chat.navigation.anchor.jump_to_turn 2' }))
      expect(scrollToMessageId).toHaveBeenCalledWith('user-2')
    })

    it('hides the rail when the composer inset collapses it to zero height and restores it on collapse', () => {
      // A composer taller than the message area zeroes the wrapper; the rail
      // must not stay interactive with invisible, tabbable ticks.
      const metrics: StripMetrics = { wrapperHeight: 0, scrollHeight: 0, clientHeight: 0 }
      const { restore, notifyResize } = installRailGeometry(metrics)
      restoreGeometry = restore
      const { container } = renderRail({ messages, bottomInset: 1200 })

      const wrapper = container.firstElementChild as HTMLElement
      const strip = wrapper.querySelector<HTMLElement>('.overflow-y-auto') as HTMLElement
      expect(wrapper).toBeInTheDocument()
      expect(wrapper).toHaveAttribute('inert')
      expect(wrapper).toHaveClass('pointer-events-none')
      expect(strip.style.opacity).toBe('0')

      // Collapsing the composer restores the rail and its keyboard navigation.
      act(() => {
        metrics.wrapperHeight = RAIL_HEIGHT_PX
        metrics.scrollHeight = RAIL_VIEWPORT_PX
        metrics.clientHeight = RAIL_VIEWPORT_PX
        notifyResize()
      })
      expect(wrapper).not.toHaveAttribute('inert')
      expect(wrapper).not.toHaveClass('pointer-events-none')
      expect(strip.style.opacity).toBe('0.7')
    })

    it('hides a short rail and restores it at the minimum height', () => {
      const metrics: StripMetrics = { wrapperHeight: 219, scrollHeight: 171, clientHeight: 171 }
      const { restore, notifyResize } = installRailGeometry(metrics)
      restoreGeometry = restore
      const { container } = renderRail({ messages })

      const wrapper = container.firstElementChild as HTMLElement
      const strip = wrapper.querySelector<HTMLElement>('.overflow-y-auto') as HTMLElement
      expect(wrapper).toBeInTheDocument()
      expect(wrapper).toHaveAttribute('inert')
      expect(wrapper).toHaveClass('pointer-events-none')
      expect(strip.style.opacity).toBe('0')

      act(() => {
        metrics.wrapperHeight = 220
        metrics.scrollHeight = 172
        metrics.clientHeight = 172
        notifyResize()
      })
      expect(wrapper).not.toHaveAttribute('inert')
      expect(wrapper).not.toHaveClass('pointer-events-none')
      expect(strip.style.opacity).toBe('0.7')
    })

    it('preserves the hover preview at zero gutter and clears it when the rail becomes too short', () => {
      const metrics: StripMetrics = {
        wrapperHeight: RAIL_HEIGHT_PX,
        scrollHeight: RAIL_VIEWPORT_PX,
        clientHeight: RAIL_VIEWPORT_PX
      }
      const { restore, notifyResize } = installRailGeometry(metrics)
      restoreGeometry = restore
      const animationFrame = installDeferredAnimationFrame()
      partsMap['user-2'] = [textPart('Question two')]
      const { container, rerender, queryByText } = renderRail({ messages, railOpacity: 1 })
      const wrapper = container.firstElementChild as HTMLElement
      const strip = wrapper.querySelector<HTMLElement>('.overflow-y-auto') as HTMLElement

      fireEvent.mouseMove(wrapper, { clientY: tickCenterOf5(1) })
      animationFrame.flushNext()
      expect(queryByText('Question two')).toBeInTheDocument()

      rerender(rail({ messages, railOpacity: 0 }))
      expect(queryByText('Question two')).toBeInTheDocument()
      expect(wrapper).not.toHaveAttribute('inert')
      expect(strip.style.opacity).toBe('1')

      act(() => {
        metrics.wrapperHeight = 219
        metrics.scrollHeight = 171
        metrics.clientHeight = 171
        notifyResize()
      })
      expect(queryByText('Question two')).not.toBeInTheDocument()
      expect(wrapper).toHaveAttribute('inert')
      expect(wrapper).toHaveClass('pointer-events-none')
      expect(strip.style.opacity).toBe('0')

      act(() => {
        metrics.wrapperHeight = 220
        metrics.scrollHeight = 172
        metrics.clientHeight = 172
        notifyResize()
      })
      expect(queryByText('Question two')).not.toBeInTheDocument()
      expect(wrapper).not.toHaveAttribute('inert')
      expect(wrapper).not.toHaveClass('pointer-events-none')
      expect(strip.style.opacity).toBe('0.7')
    })
  })

  describe('update isolation', () => {
    it('coalesces pointer updates and focuses the tick nearest the latest position', () => {
      restoreGeometry = installRailGeometry({ scrollHeight: RAIL_VIEWPORT_PX, clientHeight: RAIL_VIEWPORT_PX }).restore
      const animationFrame = installDeferredAnimationFrame()
      partsMap['user-1'] = [textPart('Question one')]
      partsMap['user-2'] = [textPart('Question two')]
      const { container, getByText, queryByText } = renderRail({ messages })
      const strip = container.firstElementChild as HTMLElement

      fireEvent.mouseMove(strip, { clientY: tickCenterOf5(0) })
      fireEvent.mouseMove(strip, { clientY: tickCenterOf5(1) })

      expect(queryByText('Question two')).not.toBeInTheDocument()

      animationFrame.flushNext()
      expect(getByText('Question two')).toBeInTheDocument()
      expect(queryByText('Question one')).not.toBeInTheDocument()
    })

    it('updates a live preview without reading sealed history again', () => {
      restoreGeometry = installRailGeometry({ scrollHeight: RAIL_VIEWPORT_PX, clientHeight: RAIL_VIEWPORT_PX }).restore
      const animationFrame = installDeferredAnimationFrame()
      let historySealed = false
      const historyParts = [
        {
          type: 'text',
          get text() {
            if (historySealed) throw new Error('historical preview was read again')
            return 'Stable question'
          }
        }
      ] as unknown as CherryMessagePart[]
      const historyPartsByMessageId = { 'user-2': historyParts }
      const liveMessageIds = ['assistant-2']
      const railProps = { messages, historyPartsByMessageId, liveMessageIds }
      const view = renderRail(railProps, { 'assistant-2': [textPart('Live answer one')] })

      fireEvent.mouseMove(view.container.firstElementChild as HTMLElement, { clientY: tickCenterOf5(1) })
      animationFrame.flushNext()
      expect(view.getByText('Stable question')).toBeInTheDocument()
      expect(view.getByText('Live answer one')).toBeInTheDocument()

      // Only the streaming context changes — every rail prop stays referentially
      // identical, so the chunk must reach the live leaf without re-rendering
      // the rail (which would throw on the sealed history getter).
      historySealed = true
      view.rerender(rail(railProps, { 'assistant-2': [textPart('Live answer two')] }))

      expect(view.getByText('Live answer two')).toBeInTheDocument()
    })
  })

  describe('hover preview branch selection', () => {
    it('previews the active-branch assistant rather than an off-path sibling', () => {
      restoreGeometry = installRailGeometry({ scrollHeight: RAIL_VIEWPORT_PX, clientHeight: RAIL_VIEWPORT_PX }).restore
      const animationFrame = installDeferredAnimationFrame()
      partsMap['user-2'] = [textPart('Question two')]
      partsMap['assistant-2'] = [textPart('Off-path sibling reply')]
      partsMap['assistant-2b'] = [textPart('Active branch reply')]
      const branched = messages.map((message) =>
        message.id === 'assistant-2'
          ? { ...message, isActiveBranch: false }
          : message.id === 'assistant-2b'
            ? { ...message, isActiveBranch: true }
            : message
      )
      const { container, getByText, queryByText } = renderRail({ messages: branched })

      fireEvent.mouseMove(container.firstElementChild as HTMLElement, { clientY: tickCenterOf5(1) })
      animationFrame.flushNext()

      expect(getByText('Active branch reply')).toBeInTheDocument()
      expect(queryByText('Off-path sibling reply')).not.toBeInTheDocument()
    })

    it('falls back to the first assistant when no member carries the branch flag', () => {
      restoreGeometry = installRailGeometry({ scrollHeight: RAIL_VIEWPORT_PX, clientHeight: RAIL_VIEWPORT_PX }).restore
      const animationFrame = installDeferredAnimationFrame()
      partsMap['assistant-2'] = [textPart('First reply')]
      partsMap['assistant-2b'] = [textPart('Second reply')]
      const { container, getByText } = renderRail({ messages })

      fireEvent.mouseMove(container.firstElementChild as HTMLElement, { clientY: tickCenterOf5(1) })
      animationFrame.flushNext()

      expect(getByText('First reply')).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('renders ticks as labelled buttons with the active turn marked as current', () => {
      const { container } = renderRail({ messages, activeMessageId: 'assistant-1' })

      const ticks = Array.from(container.querySelectorAll<HTMLElement>('[data-message-anchor-tick]'))
      ticks.forEach((tick, index) => {
        expect(tick.tagName).toBe('BUTTON')
        expect(tick).toHaveAttribute('type', 'button')
        expect(tick).toHaveAttribute('aria-label', `chat.navigation.anchor.jump_to_turn ${index + 1}`)
      })
      expect(ticks[0]).toHaveAttribute('aria-current', 'true')
      expect(ticks[1]).not.toHaveAttribute('aria-current')
      // Inactive ticks use main's maintained strong-structure token.
    })

    it('reaches a tick with Tab and activates it with Enter', async () => {
      const user = userEvent.setup()
      const scrollToMessageId = vi.fn()
      const { container } = renderRail({ messages, scrollToMessageId })

      await user.tab()
      const ticks = container.querySelectorAll('[data-message-anchor-tick]')
      expect(ticks[0]).toHaveFocus()

      await user.keyboard('{Enter}')
      expect(scrollToMessageId).toHaveBeenCalledWith('user-1')
    })

    it('exposes the rail as a labelled navigation landmark', () => {
      const { getByRole } = renderRail({ messages })

      expect(getByRole('navigation')).toHaveAttribute('aria-label', 'chat.navigation.anchor.label')
    })

    it('moves between ticks with arrow, Home and End keys and previews the focused turn', async () => {
      const user = userEvent.setup()
      partsMap['user-1'] = [textPart('Question one')]
      partsMap['user-2'] = [textPart('Question two')]
      const { container, getByText } = renderRail({ messages })
      const ticks = container.querySelectorAll('[data-message-anchor-tick]')

      await user.tab()
      expect(ticks[0]).toHaveFocus()
      await user.keyboard('{ArrowDown}')
      expect(ticks[1]).toHaveFocus()
      expect(getByText('Question two')).toBeInTheDocument()
      await user.keyboard('{ArrowUp}')
      expect(ticks[0]).toHaveFocus()
      await user.keyboard('{End}')
      expect(ticks[ticks.length - 1]).toHaveFocus()
      await user.keyboard('{Home}')
      expect(ticks[0]).toHaveFocus()
      expect(getByText('Question one')).toBeInTheDocument()
    })
  })

  it('tracks the focused turn across a prepended history page and clears the preview on blur', async () => {
    const user = userEvent.setup()
    partsMap['user-1'] = [textPart('Question one')]
    partsMap['user-2'] = [textPart('Question two')]
    const olderPage = [
      makeMessage({ id: 'user-0', role: 'user' }),
      makeMessage({ id: 'assistant-0', role: 'assistant', parentId: 'user-0' })
    ]
    const { container, getByText, queryByText, rerender } = renderRail({ messages, hasOlder: true })
    const ticks = () => container.querySelectorAll('[data-message-anchor-tick]')

    await user.tab()
    await user.keyboard('{ArrowDown}')
    expect(ticks()[1]).toHaveFocus()
    expect(getByText('Question two')).toBeInTheDocument()

    // Older history prepends: React keeps the focused button by key, but
    // every array index shifts. The preview must follow the focused turn.
    rerender(rail({ messages: [...olderPage, ...messages], hasOlder: true }))
    expect(ticks()[2]).toHaveFocus()
    expect(getByText('Question two')).toBeInTheDocument()
    expect(queryByText('Question one')).not.toBeInTheDocument()

    // Blur must clear the preview even though the focused turn moved indices.
    fireEvent.blur(ticks()[2])
    expect(queryByText('Question two')).not.toBeInTheDocument()
    expect(queryByText('Question one')).not.toBeInTheDocument()
  })

  describe('strip geometry', () => {
    it('compensates the scroll when older turns prepend so visible ticks stay put', () => {
      const metrics = { scrollHeight: 400, clientHeight: RAIL_VIEWPORT_PX }
      restoreGeometry = installRailGeometry(metrics).restore
      const initial = makeTurnMessages(40, 100)
      const { container, rerender } = renderRail({ messages: initial, hasOlder: true })

      const strip = container.querySelector<HTMLElement>('.overflow-y-auto') as HTMLElement
      const entryScrollTop = 400 - RAIL_VIEWPORT_PX
      expect(strip.scrollTop).toBe(entryScrollTop)

      metrics.scrollHeight = 460
      rerender(rail({ messages: [...makeTurnMessages(6), ...initial], hasOlder: true }))

      // 6 prepended turns × 10px pitch.
      expect(strip.scrollTop).toBe(entryScrollTop + 60)
    })
    it('re-pins a bottom-pinned strip when the composer inset shrinks the rail', () => {
      // 40 turns × 10px = 400px of ticks; entry pins the strip to the bottom.
      const metrics: StripMetrics = { wrapperHeight: RAIL_HEIGHT_PX, scrollHeight: 400, clientHeight: RAIL_VIEWPORT_PX }
      const { restore, notifyResize } = installRailGeometry(metrics)
      restoreGeometry = restore
      const { container } = renderRail({ messages: makeTurnMessages(40), hasOlder: true })
      const strip = container.querySelector<HTMLElement>('.overflow-y-auto') as HTMLElement
      expect(strip.scrollTop).toBe(400 - RAIL_VIEWPORT_PX)

      // The composer overlay grows: the wrapper and strip viewport shrink while
      // the tick content keeps its height, so the old offset now clips the
      // newest ticks.
      act(() => {
        metrics.wrapperHeight = 300
        metrics.clientHeight = 252
        notifyResize()
      })

      expect(strip.scrollTop).toBe(400 - 252)
    })

    it('retains a deliberate scroll position when the rail shrinks', () => {
      const metrics: StripMetrics = { wrapperHeight: RAIL_HEIGHT_PX, scrollHeight: 400, clientHeight: RAIL_VIEWPORT_PX }
      const { restore, notifyResize } = installRailGeometry(metrics)
      restoreGeometry = restore
      const { container } = renderRail({ messages: makeTurnMessages(40), hasOlder: true })
      const strip = container.querySelector<HTMLElement>('.overflow-y-auto') as HTMLElement

      strip.scrollTop = 10
      fireEvent.scroll(strip)

      act(() => {
        metrics.wrapperHeight = 300
        metrics.clientHeight = 252
        notifyResize()
      })

      expect(strip.scrollTop).toBe(10)
    })

    it('keeps the bottom pin when an inset commit lands before the pin scroll event is delivered', () => {
      // The pin's programmatic scroll event is delivered asynchronously; if the
      // composer inset grows first, that stale event fires against the shrunken
      // viewport and must not read as a user scroll away from the bottom.
      const turns40 = makeTurnMessages(40)
      const metrics: StripMetrics = { wrapperHeight: RAIL_HEIGHT_PX, scrollHeight: 400, clientHeight: RAIL_VIEWPORT_PX }
      const { restore, notifyResize } = installRailGeometry(metrics)
      restoreGeometry = restore
      const { container, rerender } = renderRail({ messages: turns40, hasOlder: true, bottomInset: 0 })
      const strip = container.querySelector<HTMLElement>('.overflow-y-auto') as HTMLElement
      expect(strip.scrollTop).toBe(400 - RAIL_VIEWPORT_PX)

      // The composer grows while the entry pin's scroll event is still queued:
      // the geometry already reflects the smaller viewport when it fires.
      metrics.wrapperHeight = 300
      metrics.clientHeight = 252
      rerender(rail({ messages: turns40, hasOlder: true, bottomInset: 120 }))

      // The inset commit itself re-pins the strip synchronously...
      expect(strip.scrollTop).toBe(400 - 252)

      // ...so the stale scroll event delivered afterwards still finds the strip
      // at the bottom and keeps the pin through the ResizeObserver catch-up.
      fireEvent.scroll(strip)
      act(() => notifyResize())
      expect(strip.scrollTop).toBe(400 - 252)
    })

    it('re-arms the bottom pin when the user scrolls back to the newest ticks', () => {
      const metrics: StripMetrics = { wrapperHeight: RAIL_HEIGHT_PX, scrollHeight: 400, clientHeight: RAIL_VIEWPORT_PX }
      const { restore, notifyResize } = installRailGeometry(metrics)
      restoreGeometry = restore
      const { container } = renderRail({ messages: makeTurnMessages(40), hasOlder: true })
      const strip = container.querySelector<HTMLElement>('.overflow-y-auto') as HTMLElement

      strip.scrollTop = 10
      fireEvent.scroll(strip)
      strip.scrollTop = 400 - RAIL_VIEWPORT_PX
      fireEvent.scroll(strip)

      act(() => {
        metrics.wrapperHeight = 300
        metrics.clientHeight = 252
        notifyResize()
      })

      expect(strip.scrollTop).toBe(400 - 252)
    })
  })
})
