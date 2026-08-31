import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React, { Activity, useEffect, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getQuickPanelHeights, QUICK_PANEL_ITEM_HEIGHT, QUICK_PANEL_SAFE_MARGIN } from '../heights'
import { QuickPanelProvider } from '../QuickPanelProvider'
import { QuickPanelView } from '../QuickPanelView'
import type {
  QuickPanelContextType,
  QuickPanelFooterAction,
  QuickPanelInputAdapter,
  QuickPanelListItem,
  QuickPanelOpenOptions,
  QuickPanelTriggerInfo
} from '../types'
import { useQuickPanel } from '../useQuickPanel'

const virtualListMocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  scrollToOffset: vi.fn()
}))

vi.mock('i18next', () => ({
  t: (key: string, fallback?: string) => fallback ?? key
}))

vi.mock('@renderer/utils/style', () => ({
  classNames: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/VirtualList', async () => {
  const React = await import('react')

  return {
    DynamicVirtualList: ({
      children,
      list,
      size,
      ref,
      scrollerStyle
    }: {
      children: (item: QuickPanelListItem, index: number) => React.ReactNode
      list: QuickPanelListItem[]
      size?: number
      ref?: React.Ref<{ scrollToIndex: (index: number) => void; scrollToOffset: (offset: number) => void }>
      scrollerStyle?: React.CSSProperties
    }) => {
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: virtualListMocks.scrollToIndex,
        scrollToOffset: virtualListMocks.scrollToOffset
      }))

      return (
        <div data-size={size} data-testid="quick-panel-virtual-list" style={scrollerStyle}>
          {list.map((item, index) => (
            <React.Fragment key={item.id ?? index}>{children(item, index)}</React.Fragment>
          ))}
        </div>
      )
    }
  }
})

function createKeyDownEvent(key: string) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })
  const preventDefault = vi.spyOn(event, 'preventDefault')
  const stopPropagation = vi.spyOn(event, 'stopPropagation')

  return { event, preventDefault, stopPropagation }
}

function createRect(top: number, bottom: number): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left: 0,
    right: 800,
    top,
    width: 800,
    x: 0,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

function PanelHarness({
  captureDispatch,
  footerActions,
  inputAdapter,
  items,
  manageListExternally,
  readOnly,
  symbol = '/',
  title = 'Actions',
  triggerInfo,
  trackInputQuery,
  initialSearchText,
  queryAnchor,
  onClose,
  fill = false
}: {
  captureDispatch: (dispatch: QuickPanelContextType['dispatchKeyDown']) => void
  footerActions?: QuickPanelFooterAction[]
  inputAdapter?: QuickPanelInputAdapter
  items: QuickPanelListItem[]
  manageListExternally?: boolean
  readOnly?: boolean
  symbol?: string
  title?: string
  triggerInfo?: QuickPanelTriggerInfo
  trackInputQuery?: boolean
  initialSearchText?: string
  queryAnchor?: number
  onClose?: QuickPanelOpenOptions['onClose']
  /** Drives the ambient fill flag the composer would push for home placement. */
  fill?: boolean
}) {
  const { dispatchKeyDown, open, setFillToAvailableHeight } = useQuickPanel()

  useEffect(() => {
    captureDispatch(dispatchKeyDown)
  }, [captureDispatch, dispatchKeyDown])

  useEffect(() => {
    setFillToAvailableHeight(fill)
    return () => setFillToAvailableHeight(false)
  }, [fill, setFillToAvailableHeight])

  useEffect(() => {
    open({
      footerActions,
      list: items,
      readOnly,
      symbol,
      title,
      triggerInfo:
        triggerInfo ??
        (inputAdapter
          ? ({ type: 'input', position: 0, originalText: inputAdapter.getText() } satisfies QuickPanelTriggerInfo)
          : { type: 'button' }),
      queryAnchor,
      manageListExternally,
      trackInputQuery: trackInputQuery ?? Boolean(inputAdapter),
      initialSearchText,
      onClose
    })
  }, [
    footerActions,
    inputAdapter,
    initialSearchText,
    items,
    manageListExternally,
    onClose,
    open,
    queryAnchor,
    readOnly,
    symbol,
    title,
    trackInputQuery,
    triggerInfo
  ])

  return <QuickPanelView inputAdapter={inputAdapter} />
}

function CaptureQuickPanel({ onCapture }: { onCapture: (context: QuickPanelContextType) => void }) {
  const context = useQuickPanel()

  useEffect(() => {
    onCapture(context)
  }, [context, onCapture])

  return null
}

function ImmediateOpenDispatchHarness({ onHandled }: { onHandled: (handled: boolean) => void }) {
  const { dispatchKeyDown, open, registerKeyDownHandler } = useQuickPanel()

  useEffect(() => {
    open({
      list: [],
      symbol: '/'
    })

    const unregister = registerKeyDownHandler((event) => {
      if (event.key !== 'Escape') return false

      event.preventDefault()
      event.stopPropagation()
      return true
    })

    onHandled(dispatchKeyDown(createKeyDownEvent('Escape').event))

    return unregister
  }, [dispatchKeyDown, onHandled, open, registerKeyDownHandler])

  return null
}

function ActivityTabSwitchHarness({ onNavigate }: { onNavigate: () => void }) {
  const [activeTab, setActiveTab] = useState<'source' | 'target'>('source')

  return (
    <>
      <button type="button" onClick={() => setActiveTab('source')}>
        Return to source tab
      </button>
      <output aria-label="Active tab">{activeTab}</output>
      <Activity mode={activeTab === 'source' ? 'visible' : 'hidden'}>
        <QuickPanelProvider>
          <SingleOpenTabSwitchPanel
            onNavigate={() => {
              onNavigate()
              setActiveTab('target')
            }}
          />
        </QuickPanelProvider>
      </Activity>
    </>
  )
}

function SingleOpenTabSwitchPanel({ onNavigate }: { onNavigate: () => void }) {
  const { open } = useQuickPanel()
  const hasOpenedRef = useRef(false)

  useEffect(() => {
    if (hasOpenedRef.current) return
    hasOpenedRef.current = true
    open({
      list: [{ id: 'navigate', label: 'Open target tab', icon: null, action: onNavigate }],
      symbol: '/'
    })
  }, [onNavigate, open])

  return <QuickPanelView />
}

describe('QuickPanelView', () => {
  beforeEach(() => {
    virtualListMocks.scrollToIndex.mockClear()
    virtualListMocks.scrollToOffset.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores stale close callbacks after the provider unmounts', () => {
    vi.useFakeTimers()

    let closePanel: QuickPanelContextType['close'] | undefined
    const { unmount } = render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (closePanel = context.close)} />
      </QuickPanelProvider>
    )

    expect(closePanel).toBeDefined()

    unmount()

    act(() => {
      closePanel?.('esc')
    })

    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes the current context to onClose callbacks', async () => {
    const onClose = vi.fn()
    let quickPanel: QuickPanelContextType | undefined

    render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (quickPanel = context)} />
      </QuickPanelProvider>
    )

    await waitFor(() => {
      expect(quickPanel).toBeDefined()
    })

    act(() => {
      quickPanel?.open({ list: [], symbol: '/', onClose })
    })

    await waitFor(() => {
      expect(quickPanel?.symbol).toBe('/')
    })

    const openContext = quickPanel
    act(() => {
      openContext?.close('esc')
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose.mock.calls[0][0].context).toBe(openContext)
  })

  it('advances the panel generation when closing without reopening', async () => {
    let quickPanel: QuickPanelContextType | undefined

    render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (quickPanel = context)} />
      </QuickPanelProvider>
    )

    await waitFor(() => {
      expect(quickPanel).toBeDefined()
    })

    act(() => {
      quickPanel?.open({ list: [], symbol: '/' })
    })
    expect(quickPanel?.getPanelGeneration()).toBe(1)

    act(() => {
      quickPanel?.close('input_prefix_invalid')
    })
    expect(quickPanel?.getPanelGeneration()).toBe(2)
  })

  it('dispatches keydown immediately after opening in the same effect tick', async () => {
    const onHandled = vi.fn()

    render(
      <QuickPanelProvider>
        <ImmediateOpenDispatchHarness onHandled={onHandled} />
      </QuickPanelProvider>
    )

    await waitFor(() => {
      expect(onHandled).toHaveBeenCalledWith(true)
    })
  })

  it('does not dispatch to the previous visible panel handler while opening the next panel', async () => {
    let quickPanel: QuickPanelContextType | undefined
    const panelAAction = vi.fn()
    const panelBAction = vi.fn()

    render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (quickPanel = context)} />
        <QuickPanelView />
      </QuickPanelProvider>
    )

    await waitFor(() => {
      expect(quickPanel).toBeDefined()
    })

    act(() => {
      quickPanel?.open({
        list: [{ id: 'panel-a-action', label: 'Panel A action', icon: 'a', action: panelAAction }],
        symbol: '/'
      })
    })

    await screen.findByText('Panel A action')
    await waitFor(() => {
      expect(quickPanel?.getPanelGeneration()).toBe(1)
    })

    const { event, preventDefault, stopPropagation } = createKeyDownEvent('Enter')
    let handled = true
    act(() => {
      quickPanel?.open({
        list: [{ id: 'panel-b-action', label: 'Panel B action', icon: 'b', action: panelBAction }],
        symbol: '@'
      })
      handled = quickPanel?.dispatchKeyDown(event) ?? false
    })

    expect(handled).toBe(false)
    expect(panelAAction).not.toHaveBeenCalled()
    expect(panelBAction).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
  })

  it('resets the virtual list scroll offset when a panel opens', async () => {
    const captureDispatch = vi.fn()
    const items: QuickPanelListItem[] = [
      { id: 'first', label: 'First action', icon: '1', action: vi.fn() },
      { id: 'second', label: 'Second action', icon: '2', action: vi.fn() }
    ]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('First action')

    expect(virtualListMocks.scrollToOffset).toHaveBeenCalledWith(0, { align: 'start' })
  })

  it.each([
    {
      name: 'the cursor is inside a word',
      text: 'hello world',
      cursorOffset: 3,
      queryAnchor: 3,
      item: { id: 'action', label: 'Action', icon: 'a' }
    },
    {
      name: 'the query contains whitespace',
      text: 'new chat',
      cursorOffset: 8,
      queryAnchor: 0,
      item: { id: 'new-chat', label: 'New chat', icon: 'message' }
    }
  ])('keeps a button-triggered tracked panel open when $name', async ({ text, cursorOffset, queryAnchor, item }) => {
    const captureDispatch = vi.fn()
    const onClose = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => text,
      getCursorOffset: () => cursorOffset,
      insertText: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={[item]}
          queryAnchor={queryAnchor}
          triggerInfo={{ type: 'button', position: queryAnchor }}
          trackInputQuery
          onClose={onClose}
        />
      </QuickPanelProvider>
    )

    await screen.findByText(item.label)

    expect(screen.getByTestId('quick-panel')).toHaveClass('visible')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('filters a button-triggered tracked panel with initial search text', async () => {
    const captureDispatch = vi.fn()
    const listeners = new Set<Parameters<NonNullable<QuickPanelInputAdapter['subscribeInput']>>[0]>()
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => '',
      getCursorOffset: () => 0,
      insertText: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      subscribeInput: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={[
            { id: 'agent-skill', label: 'Agent skill', icon: 'sparkles' },
            { id: 'attachment', label: 'Attachment', icon: 'paperclip' }
          ]}
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          initialSearchText="skill"
        />
      </QuickPanelProvider>
    )

    expect(await screen.findByText('Agent skill')).toBeInTheDocument()
    expect(screen.queryByText('Attachment')).not.toBeInTheDocument()

    act(() => {
      listeners.forEach((listener) => listener())
    })

    expect(screen.getByText('Agent skill')).toBeInTheDocument()
    expect(screen.queryByText('Attachment')).not.toBeInTheDocument()
  })

  it('closes with Escape even when the key event does not come from the input adapter', async () => {
    const captureDispatch = vi.fn()
    const onClose = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => '',
      getCursorOffset: () => 0,
      insertText: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={[{ id: 'action', label: 'Action', icon: 'a' }]}
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          onClose={onClose}
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Action')

    const event = createKeyDownEvent('Escape')
    act(() => {
      window.dispatchEvent(event.event)
    })

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'esc',
        searchText: ''
      })
    )
  })

  it('does not delete existing composer text after a button-triggered cursor move', async () => {
    const captureDispatch = vi.fn()
    const action = vi.fn()
    const deleteTriggerRange = vi.fn()
    let cursorOffset = 5
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => 'keep existing text',
      getCursorOffset: () => cursorOffset,
      insertText: vi.fn(),
      deleteTriggerRange,
      focus: vi.fn()
    }

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={[{ id: 'action', label: 'Action', icon: 'a', action }]}
          queryAnchor={5}
          triggerInfo={{ type: 'button', position: 5 }}
          trackInputQuery
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Action')

    cursorOffset = 14
    fireEvent.click(screen.getByText('Action'))

    expect(action).toHaveBeenCalledTimes(1)
    expect(deleteTriggerRange).not.toHaveBeenCalled()
  })

  it('clears a button-triggered search before opening a child menu panel', async () => {
    const captureDispatch = vi.fn()
    const childAction = vi.fn()
    const insertText = vi.fn()
    let text = 'knowledge'
    let cursorOffset = text.length
    const deleteTriggerRange = vi.fn(({ from, to }: { from: number; to: number }) => {
      text = text.slice(0, from) + text.slice(to)
      cursorOffset = from
    })
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => text,
      getCursorOffset: () => cursorOffset,
      insertText,
      deleteTriggerRange,
      focus: vi.fn()
    }
    const menuAction: QuickPanelListItem['action'] = ({ context, parentPanel, queryAnchor }) => {
      context.open({
        list: [{ id: 'knowledge-file', label: 'Knowledge file', icon: 'file', action: childAction }],
        symbol: 'knowledge-base',
        parentPanel,
        queryAnchor,
        triggerInfo: context.triggerInfo
      })
    }

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={[{ id: 'knowledge-base', label: 'Knowledge Base', icon: 'kb', isMenu: true, action: menuAction }]}
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
        />
      </QuickPanelProvider>
    )

    fireEvent.click(await screen.findByText('Knowledge Base'))

    expect(deleteTriggerRange).toHaveBeenCalledOnce()
    expect(deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 'knowledge'.length })
    expect(text).toBe('')

    fireEvent.click(await screen.findByText('Knowledge file'))

    expect(childAction).toHaveBeenCalledTimes(1)
    expect(deleteTriggerRange).toHaveBeenCalledOnce()
  })

  // 集成测试验证 context 的 fill 标志 + DOM 几何测量把高度喂给了 getQuickPanelHeights；
  // 具体数值由 heights.test.ts 的纯单测覆盖，这里不写死像素。
  const measuredItems: QuickPanelListItem[] = Array.from({ length: 10 }, (_, index) => ({
    id: `item-${index}`,
    label: `Item ${index}`,
    icon: `${index}`,
    action: vi.fn()
  }))
  const compactItems = measuredItems.slice(0, 2)

  it('keeps the fixed height in a docked composer (no placement, no fill)', async () => {
    const getRectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rectFor(
      this: HTMLElement
    ) {
      // 即便上方空间很小，docked 也应忽略它、保持固定高度。
      if (this.dataset.testid === 'quick-panel') return createRect(180, 180)
      return createRect(40, 900)
    })

    try {
      render(
        <div style={{ overflow: 'hidden' }}>
          <QuickPanelProvider>
            <PanelHarness captureDispatch={vi.fn()} items={measuredItems} />
          </QuickPanelProvider>
        </div>
      )

      const expected = getQuickPanelHeights({
        isVisible: true,
        collapsed: false,
        readOnly: false,
        pageSize: 7,
        itemCount: measuredItems.length,
        availableHeight: null,
        fill: false
      })

      const panel = await screen.findByTestId('quick-panel')
      await waitFor(() => {
        expect(panel).toHaveStyle({ maxHeight: `${expected.panelMaxHeight}px` })
      })
      expect(screen.getByTestId('quick-panel-virtual-list')).toHaveAttribute('data-size', String(expected.listHeight))
      // docked 不撑高 body。
      const body = screen.getByTestId('quick-panel-body')
      expect(body).not.toHaveStyle({ height: `${expected.panelMaxHeight}px` })
      expect(body).toHaveClass('shadow-none')
    } finally {
      getRectSpy.mockRestore()
    }
  })

  it('lets the whole welcome (home) panel shrink naturally when content fits above the input', async () => {
    const panelBottom = 500
    const dockTop = 40
    const getRectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rectFor(
      this: HTMLElement
    ) {
      if (this.dataset.testid === 'quick-panel') return createRect(panelBottom, panelBottom)
      if (this.dataset.testid === 'quick-panel-dock') return createRect(dockTop, 900)
      return createRect(0, 900)
    })

    try {
      render(
        <div data-composer-dock-layer="" data-testid="quick-panel-dock" style={{ overflow: 'hidden' }}>
          <QuickPanelProvider>
            <PanelHarness captureDispatch={vi.fn()} items={compactItems} fill />
          </QuickPanelProvider>
        </div>
      )

      const expected = getQuickPanelHeights({
        isVisible: true,
        collapsed: false,
        readOnly: false,
        pageSize: 7,
        itemCount: compactItems.length,
        availableHeight: panelBottom - dockTop - QUICK_PANEL_SAFE_MARGIN,
        fill: true
      })

      const panel = await screen.findByTestId('quick-panel')
      await waitFor(() => {
        expect(panel).toHaveStyle({ maxHeight: `${expected.panelMaxHeight}px` })
      })
      // 列表贴合内容（≤pageSize 行），整个 panel 由 DOM 自然高度收缩，不写死 body 高度。
      expect(screen.getByTestId('quick-panel-virtual-list')).toHaveAttribute('data-size', String(expected.listHeight))
      const body = screen.getByTestId('quick-panel-body')
      expect(body).not.toHaveStyle({ height: `${expected.panelMaxHeight}px` })
      expect(body).not.toHaveStyle({ height: `${panelBottom - dockTop - QUICK_PANEL_SAFE_MARGIN}px` })
      expect(body).not.toHaveClass('justify-end')
      expect(body).toHaveClass('shadow-none')
    } finally {
      getRectSpy.mockRestore()
    }
  })

  it('caps the welcome (home) panel at the available height when content overflows', async () => {
    const panelBottom = 240
    const dockTop = 40
    const availableHeight = panelBottom - dockTop - QUICK_PANEL_SAFE_MARGIN
    const footerHeight = 30
    const bodyVerticalSpace = 11
    const chromeHeight = footerHeight + bodyVerticalSpace
    const getRectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rectFor(
      this: HTMLElement
    ) {
      if (this.dataset.testid === 'quick-panel') return createRect(panelBottom, panelBottom)
      if (this.dataset.testid === 'quick-panel-dock') return createRect(dockTop, 900)
      return createRect(0, 900)
    })
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function heightFor(this: HTMLElement) {
        if (this.dataset.testid === 'quick-panel-footer') return footerHeight
        return 0
      })
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
      const style = originalGetComputedStyle(element, pseudoElement)
      if ((element as HTMLElement).dataset.testid === 'quick-panel-body') {
        style.paddingTop = '5px'
        style.paddingBottom = '5px'
        style.borderTopWidth = '0.5px'
        style.borderBottomWidth = '0.5px'
      }
      return style
    })

    try {
      render(
        <div data-composer-dock-layer="" data-testid="quick-panel-dock" style={{ overflow: 'hidden' }}>
          <QuickPanelProvider>
            <PanelHarness captureDispatch={vi.fn()} items={measuredItems} fill />
          </QuickPanelProvider>
        </div>
      )

      const expected = getQuickPanelHeights({
        isVisible: true,
        collapsed: false,
        readOnly: false,
        pageSize: 7,
        itemCount: measuredItems.length,
        availableHeight,
        fill: true,
        chromeHeight
      })

      const panel = await screen.findByTestId('quick-panel')
      await waitFor(() => {
        expect(panel).toHaveStyle({ maxHeight: `${expected.panelMaxHeight}px` })
      })
      expect(expected.panelMaxHeight).toBe(availableHeight)
      expect(screen.getByTestId('quick-panel-virtual-list')).toHaveAttribute('data-size', String(expected.listHeight))
      expect(expected.listHeight).toBe(availableHeight - chromeHeight)
      expect(screen.getByTestId('quick-panel-body')).toHaveStyle({ height: `${availableHeight}px` })
    } finally {
      getRectSpy.mockRestore()
      clientHeightSpy.mockRestore()
      getComputedStyleSpy.mockRestore()
    }
  })

  it('recomputes placement metrics when an open welcome panel docks', async () => {
    const panelBottom = 240
    const dockTop = 40
    const availableHeight = panelBottom - dockTop - QUICK_PANEL_SAFE_MARGIN
    const footerHeight = 30
    const bodyVerticalSpace = 11
    const chromeHeight = footerHeight + bodyVerticalSpace
    const captureDispatch = vi.fn()
    const getRectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rectFor(
      this: HTMLElement
    ) {
      if (this.dataset.testid === 'quick-panel') return createRect(panelBottom, panelBottom)
      if (this.dataset.testid === 'quick-panel-dock') return createRect(dockTop, 900)
      return createRect(0, 900)
    })
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function heightFor(this: HTMLElement) {
        if (this.dataset.testid === 'quick-panel-footer') return footerHeight
        return 0
      })
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
      const style = originalGetComputedStyle(element, pseudoElement)
      if ((element as HTMLElement).dataset.testid === 'quick-panel-body') {
        style.paddingTop = '5px'
        style.paddingBottom = '5px'
        style.borderTopWidth = '0.5px'
        style.borderBottomWidth = '0.5px'
      }
      return style
    })

    const renderPanel = (fill: boolean) => (
      <div data-composer-dock-layer="" data-testid="quick-panel-dock" style={{ overflow: 'hidden' }}>
        <QuickPanelProvider>
          <PanelHarness captureDispatch={captureDispatch} items={measuredItems} fill={fill} />
        </QuickPanelProvider>
      </div>
    )

    try {
      const { rerender } = render(renderPanel(true))

      const homeExpected = getQuickPanelHeights({
        isVisible: true,
        collapsed: false,
        readOnly: false,
        pageSize: 7,
        itemCount: measuredItems.length,
        availableHeight,
        fill: true,
        chromeHeight
      })
      const dockedExpected = getQuickPanelHeights({
        isVisible: true,
        collapsed: false,
        readOnly: false,
        pageSize: 7,
        itemCount: measuredItems.length,
        availableHeight: null,
        fill: false
      })

      const panel = await screen.findByTestId('quick-panel')
      await waitFor(() => {
        expect(panel).toHaveStyle({ maxHeight: `${homeExpected.panelMaxHeight}px` })
      })
      expect(screen.getByTestId('quick-panel-body')).toHaveStyle({ height: `${homeExpected.panelMaxHeight}px` })
      expect(screen.getByTestId('quick-panel-body')).toHaveClass('shadow-none')

      rerender(renderPanel(false))

      await waitFor(() => {
        expect(panel).toHaveStyle({ maxHeight: `${dockedExpected.panelMaxHeight}px` })
      })
      const body = screen.getByTestId('quick-panel-body')
      expect(body).not.toHaveStyle({ height: `${homeExpected.panelMaxHeight}px` })
      expect(body).toHaveClass('shadow-none')
    } finally {
      getRectSpy.mockRestore()
      clientHeightSpy.mockRestore()
      getComputedStyleSpy.mockRestore()
    }
  })

  it('keeps the standard shadow and fixed height for a read-only panel even with fill enabled', async () => {
    const getRectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rectFor(
      this: HTMLElement
    ) {
      if (this.dataset.testid === 'quick-panel') return createRect(240, 240)
      if (this.dataset.testid === 'quick-panel-dock') return createRect(40, 900)
      return createRect(0, 900)
    })

    try {
      render(
        <div data-composer-dock-layer="" data-testid="quick-panel-dock" style={{ overflow: 'hidden' }}>
          <QuickPanelProvider>
            <PanelHarness captureDispatch={vi.fn()} items={measuredItems} readOnly fill />
          </QuickPanelProvider>
        </div>
      )

      // readOnly 屏蔽 fill（fillEffective=false）：保持固定高度、忽略 availableHeight、用标准阴影。
      const expected = getQuickPanelHeights({
        isVisible: true,
        collapsed: false,
        readOnly: true,
        pageSize: 7,
        itemCount: measuredItems.length,
        availableHeight: null,
        fill: false
      })

      const panel = await screen.findByTestId('quick-panel')
      await waitFor(() => {
        expect(panel).toHaveStyle({ maxHeight: `${expected.panelMaxHeight}px` })
      })
      expect(screen.getByTestId('quick-panel-virtual-list')).toHaveAttribute('data-size', String(expected.listHeight))
      const body = screen.getByTestId('quick-panel-body')
      expect(body).not.toHaveStyle({ height: `${expected.panelMaxHeight}px` })
      expect(body).toHaveClass('shadow-none')
    } finally {
      getRectSpy.mockRestore()
    }
  })

  it('clears measured footer chrome when switching to a read-only panel without footer actions', async () => {
    const footerHeight = 30
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function heightFor(this: HTMLElement) {
        if (this.dataset.testid === 'quick-panel-footer') return footerHeight
        return 0
      })
    const renderPanel = (readOnly: boolean) => (
      <QuickPanelProvider>
        <PanelHarness captureDispatch={vi.fn()} items={measuredItems} readOnly={readOnly} />
      </QuickPanelProvider>
    )

    try {
      const { rerender } = render(renderPanel(false))
      await screen.findByTestId('quick-panel-footer')

      rerender(renderPanel(true))

      const expected = getQuickPanelHeights({
        isVisible: true,
        collapsed: false,
        readOnly: true,
        pageSize: 7,
        itemCount: measuredItems.length,
        availableHeight: null,
        fill: false
      })
      await waitFor(() => {
        expect(screen.queryByTestId('quick-panel-footer')).not.toBeInTheDocument()
        expect(screen.getByTestId('quick-panel')).toHaveStyle({ maxHeight: `${expected.panelMaxHeight}px` })
      })
    } finally {
      clientHeightSpy.mockRestore()
    }
  })

  it('renders read-only panels without row selection or confirm footer actions', async () => {
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const items: QuickPanelListItem[] = [
      { id: 'server', label: 'filesystem', description: 'Connected', icon: 'mcp', isSelected: true, action }
    ]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} items={items} readOnly title="MCP" />
      </QuickPanelProvider>
    )

    await screen.findByText('filesystem')
    const row = screen.getByText('filesystem').closest('[data-id="server"]')
    expect(row?.getAttribute('data-active')).toBe('false')
    expect(row).not.toHaveAttribute('data-selected')
    expect(row).toHaveAttribute('role', 'button')
    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(row).not.toHaveAttribute('aria-pressed')
    expect(row).toHaveAttribute('tabindex', '-1')

    fireEvent.click(row!)
    expect(action).not.toHaveBeenCalled()
    expect(screen.getByTestId('quick-panel')).toHaveClass('visible')

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']

    for (const key of ['Enter', 'Tab']) {
      const { event, preventDefault, stopPropagation } = createKeyDownEvent(key)
      let handled = false
      act(() => {
        handled = dispatchKeyDown(event)
      })
      expect(handled).toBe(true)
      expect(preventDefault).toHaveBeenCalled()
      expect(stopPropagation).toHaveBeenCalled()
      expect(action).not.toHaveBeenCalled()
      expect(screen.getByTestId('quick-panel')).toHaveClass('visible')
    }

    expect(screen.getByText('MCP')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.quickPanel.close' })).toBeInTheDocument()
    expect(screen.queryByText((content) => content.includes('Tab/↩︎'))).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'settings.quickPanel.close' }))
    await waitFor(() => {
      expect(screen.getByTestId('quick-panel')).not.toHaveClass('visible')
    })
  })

  it('exposes selectable rows as accessible toggle buttons', async () => {
    const selectedAction = vi.fn()
    const unselectedAction = vi.fn()
    const disabledAction = vi.fn()
    const items: QuickPanelListItem[] = [
      { id: 'selected', label: 'Selected server', icon: 'mcp', isSelected: true, action: selectedAction },
      { id: 'unselected', label: 'Unselected server', icon: 'mcp', isSelected: false, action: unselectedAction },
      {
        id: 'disabled',
        label: 'Disabled server',
        icon: 'mcp',
        isSelected: false,
        disabled: true,
        action: disabledAction
      }
    ]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={vi.fn()} items={items} />
      </QuickPanelProvider>
    )

    const selectedRow = await screen.findByRole('button', { name: /Selected server/ })
    const unselectedRow = screen.getByRole('button', { name: /Unselected server/ })
    const disabledRow = screen.getByRole('button', { name: /Disabled server/ })

    expect(selectedRow).toHaveAttribute('aria-current', 'true')
    expect(selectedRow).toHaveAttribute('aria-pressed', 'true')
    expect(selectedRow).not.toHaveAttribute('aria-disabled')
    expect(selectedRow).toHaveAttribute('tabindex', '0')
    expect(unselectedRow).toHaveAttribute('aria-pressed', 'false')
    expect(disabledRow).toHaveAttribute('aria-disabled', 'true')
    expect(disabledRow).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(unselectedRow, { key: 'Enter' })
    fireEvent.keyDown(selectedRow, { key: ' ' })
    fireEvent.click(disabledRow)

    expect(unselectedAction).toHaveBeenCalledTimes(1)
    expect(selectedAction).toHaveBeenCalledTimes(1)
    expect(disabledAction).not.toHaveBeenCalled()
  })

  it('keeps rendered row height aligned with the virtual-list item contract', async () => {
    const items: QuickPanelListItem[] = [{ id: 'one', label: 'One action', icon: '1' }]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={vi.fn()} items={items} />
      </QuickPanelProvider>
    )

    const row = (await screen.findByText('One action')).closest('[data-id="one"]')
    expect(row).toHaveStyle({ height: '34px' })
    expect(screen.getByTestId('quick-panel-virtual-list')).toHaveAttribute('data-size', String(QUICK_PANEL_ITEM_HEIGHT))
  })

  it('selects the active item with Tab', async () => {
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const items: QuickPanelListItem[] = [
      { id: 'first', label: 'First action', icon: '1', action },
      { id: 'second', label: 'Second action', icon: '2', action: vi.fn() }
    ]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('First action')
    await waitFor(() => {
      expect(screen.getByText('First action').closest('[data-id="first"]')?.getAttribute('data-active')).toBe('true')
    })

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    const { event, preventDefault, stopPropagation } = createKeyDownEvent('Tab')

    let handled = false
    act(() => {
      handled = dispatchKeyDown(event)
    })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'enter',
        item: expect.objectContaining({ id: 'first' })
      })
    )
  })

  it('keeps the panel open when an item action requests it', async () => {
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const items: QuickPanelListItem[] = [
      { id: 'toggle', label: 'Toggle binding', icon: 'mcp', keepOpenOnAction: true, action }
    ]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('Toggle binding')
    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']

    act(() => {
      dispatchKeyDown(createKeyDownEvent('Enter').event)
    })

    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('quick-panel')).toHaveClass('visible')
  })

  it('keeps footer actions outside the searchable list and visible for empty results', async () => {
    const manageAction = vi.fn()
    const captureDispatch = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 8,
      getText: () => '/missing',
      insertText: vi.fn()
    }
    const footerActions: QuickPanelFooterAction[] = [
      {
        id: 'manage-global',
        label: 'Global',
        ariaLabel: 'Manage global prompts',
        tooltip: 'Manage global prompts',
        icon: 'settings',
        action: manageAction
      }
    ]

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          footerActions={footerActions}
          inputAdapter={inputAdapter}
          items={[{ id: 'prompt', label: 'Daily summary', icon: 'prompt' }]}
        />
      </QuickPanelProvider>
    )

    await screen.findByText('No results')
    const footer = screen.getByTestId('quick-panel-footer')
    const action = within(footer).getByRole('button', { name: 'Manage global prompts' })

    expect(action).toHaveTextContent('Global')
    expect(screen.queryByTestId('quick-panel-virtual-list')).not.toBeInTheDocument()

    fireEvent.click(action)

    expect(manageAction).toHaveBeenCalledTimes(1)
  })

  it('keeps every footer action accessible when the panel uses its compact layout', async () => {
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function widthFor(
      this: HTMLElement
    ) {
      return this.dataset.testid === 'quick-panel-footer' ? 420 : 0
    })
    const footerActions: QuickPanelFooterAction[] = [
      {
        id: 'add',
        label: 'Add',
        ariaLabel: 'Add prompt',
        tooltip: 'Add prompt',
        icon: '+',
        action: vi.fn()
      },
      {
        id: 'current',
        label: 'Current Assistant',
        ariaLabel: 'Manage current Assistant prompts',
        tooltip: 'Manage current Assistant prompts',
        icon: 'settings',
        action: vi.fn()
      },
      {
        id: 'global',
        label: 'Global',
        ariaLabel: 'Manage global prompts',
        tooltip: 'Manage global prompts',
        icon: 'globe',
        action: vi.fn()
      }
    ]

    try {
      render(
        <QuickPanelProvider>
          <PanelHarness captureDispatch={vi.fn()} footerActions={footerActions} items={[]} title="Prompts" />
        </QuickPanelProvider>
      )

      const footer = await screen.findByTestId('quick-panel-footer')
      const actionGroup = within(footer).getByTestId('quick-panel-footer-actions')
      expect(within(actionGroup).getAllByRole('button')).toHaveLength(3)
      expect(within(actionGroup).getByRole('button', { name: 'Add prompt' })).toBeEnabled()
      expect(within(actionGroup).getByRole('button', { name: 'Manage current Assistant prompts' })).toBeEnabled()
      expect(within(actionGroup).getByRole('button', { name: 'Manage global prompts' })).toBeEnabled()
      await waitFor(() => expect(within(actionGroup).getByText('Current Assistant')).toHaveClass('sr-only'))
      expect(within(footer).getAllByText('▲▼')).toHaveLength(2)
      expect(within(footer).queryByText('settings.quickPanel.select')).not.toBeInTheDocument()
      expect(within(footer).getByText(/^(⌘|Ctrl)$/)).toBeInTheDocument()
      expect(within(footer).getByText('Tab/↩︎')).toBeInTheDocument()
      for (const [testId, label] of [
        ['quick-panel-hint-close', 'settings.quickPanel.close'],
        ['quick-panel-hint-select', 'settings.quickPanel.select'],
        ['quick-panel-hint-page', 'settings.quickPanel.page'],
        ['quick-panel-hint-confirm', 'settings.quickPanel.confirm']
      ] as const) {
        expect(within(footer).getByTestId(testId)).toHaveAttribute('aria-label', label)
      }
    } finally {
      clientWidthSpy.mockRestore()
    }
  })

  it('keeps the active footer action selected when results load', async () => {
    const footerAction = vi.fn()
    const rowAction = vi.fn()
    const captureDispatch = vi.fn()
    let quickPanel: QuickPanelContextType | undefined

    render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (quickPanel = context)} />
        <PanelHarness
          captureDispatch={captureDispatch}
          footerActions={[
            {
              id: 'configure',
              label: 'Configure',
              ariaLabel: 'Configure MCP servers',
              tooltip: 'Configure MCP servers',
              icon: 'settings',
              action: footerAction
            }
          ]}
          items={[]}
        />
      </QuickPanelProvider>
    )

    const actionButton = await screen.findByRole('button', { name: 'Configure MCP servers' })
    expect(actionButton).toHaveAttribute('aria-current', 'true')

    act(() => {
      quickPanel?.updateList([{ id: 'server', label: 'Loaded MCP server', icon: 'mcp', action: rowAction }])
    })

    await screen.findByText('Loaded MCP server')
    expect(actionButton).toHaveAttribute('aria-current', 'true')

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('Enter').event)
    })

    expect(footerAction).toHaveBeenCalledTimes(1)
    expect(rowAction).not.toHaveBeenCalled()
  })

  it('preserves a read-only footer selection when status rows refresh', async () => {
    const footerAction = vi.fn()
    const captureDispatch = vi.fn()
    let quickPanel: QuickPanelContextType | undefined

    render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (quickPanel = context)} />
        <PanelHarness
          captureDispatch={captureDispatch}
          footerActions={[
            {
              id: 'configure',
              label: 'Configure',
              ariaLabel: 'Configure MCP servers',
              tooltip: 'Configure MCP servers',
              icon: 'settings',
              action: footerAction
            }
          ]}
          items={[{ id: 'server', label: 'MCP server', icon: 'mcp' }]}
          readOnly
        />
      </QuickPanelProvider>
    )

    const actionButton = await screen.findByRole('button', { name: 'Configure MCP servers' })
    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('ArrowDown').event)
    })
    expect(actionButton).toHaveAttribute('aria-current', 'true')

    act(() => {
      quickPanel?.updateList([{ id: 'server', label: 'MCP server', description: 'Connected', icon: 'mcp' }])
    })

    await screen.findByText('Connected')
    expect(actionButton).toHaveAttribute('aria-current', 'true')

    act(() => {
      dispatchKeyDown(createKeyDownEvent('Enter').event)
    })
    expect(footerAction).toHaveBeenCalledTimes(1)
  })

  it('uses either mouse hover or keyboard active state, not both', async () => {
    const captureDispatch = vi.fn()
    const items: QuickPanelListItem[] = [
      { id: 'first', label: 'First action', icon: '1', action: vi.fn() },
      { id: 'second', label: 'Second action', icon: '2', action: vi.fn() }
    ]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('First action')
    const firstRow = screen.getByText('First action').closest('[data-id="first"]')
    expect(firstRow).toHaveAttribute('data-active', 'true')
    expect(firstRow?.className).not.toContain('hover:bg-accent')

    fireEvent.mouseMove(screen.getByTestId('quick-panel-body'))

    await waitFor(() => {
      expect(firstRow).toHaveAttribute('data-active', 'false')
    })
    expect(firstRow?.className).toContain('hover:bg-accent')

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('ArrowDown').event)
    })

    await waitFor(() => {
      expect(firstRow).toHaveAttribute('data-active', 'true')
    })
    expect(firstRow?.className).not.toContain('hover:bg-accent')
  })

  it('makes the hidden panel subtree inert and disables virtual-list pointer events', async () => {
    const items: QuickPanelListItem[] = [{ id: 'first', label: 'First action', icon: '1', action: vi.fn() }]
    let quickPanel: QuickPanelContextType | undefined

    const { rerender } = render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (quickPanel = context)} />
        <QuickPanelView />
      </QuickPanelProvider>
    )

    const hiddenPanel = screen.getByTestId('quick-panel')
    expect(hiddenPanel).toHaveAttribute('inert')
    expect(hiddenPanel.className).toContain('pointer-events-none')
    expect(hiddenPanel.className).not.toContain('pointer-events-auto')

    rerender(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (quickPanel = context)} />
        <PanelHarness captureDispatch={vi.fn()} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('First action')
    const visiblePanel = screen.getByTestId('quick-panel')
    expect(visiblePanel).not.toHaveAttribute('inert')
    expect(visiblePanel.className).toContain('pointer-events-auto')
    expect(visiblePanel.className).not.toContain('pointer-events-none')

    fireEvent.mouseMove(screen.getByTestId('quick-panel-body'))
    expect(screen.getByTestId('quick-panel-virtual-list')).toHaveStyle({ pointerEvents: 'auto' })

    act(() => {
      quickPanel?.close('esc')
    })

    expect(visiblePanel).toHaveAttribute('inert')
    expect(screen.getByTestId('quick-panel-virtual-list')).toHaveStyle({ pointerEvents: 'none' })
  })

  it('clears a closed action when its selection hides and restores the tab Activity', async () => {
    const onNavigate = vi.fn()

    render(<ActivityTabSwitchHarness onNavigate={onNavigate} />)

    const staleAction = await screen.findByRole('button', { name: 'Open target tab' })
    fireEvent.mouseMove(screen.getByTestId('quick-panel-body'))
    vi.useFakeTimers()

    fireEvent.click(staleAction)
    expect(screen.getByRole('status', { name: 'Active tab' })).toHaveTextContent('target')
    expect(onNavigate).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Return to source tab' }))

    expect(screen.getByRole('status', { name: 'Active tab' })).toHaveTextContent('source')
    expect(screen.queryByRole('button', { name: 'Open target tab' })).not.toBeInTheDocument()
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('does not select always-visible items with Tab when the panel is collapsed', async () => {
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 8,
      getText: () => '/missing',
      insertText: vi.fn()
    }
    const items: QuickPanelListItem[] = [{ id: 'clear', label: 'Clear query', icon: 'x', alwaysVisible: true, action }]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} inputAdapter={inputAdapter} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('No results')

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    const { event } = createKeyDownEvent('Tab')

    let handled = false
    act(() => {
      handled = dispatchKeyDown(event)
    })

    expect(handled).toBe(true)
    expect(action).not.toHaveBeenCalled()
  })

  it('keeps the exit layout stable when closing', async () => {
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 8,
      getText: () => '/missing',
      insertText: vi.fn()
    }
    const items: QuickPanelListItem[] = [{ id: 'clear', label: 'Clear query', icon: 'x', alwaysVisible: true }]
    let closePanel: QuickPanelContextType['close'] | undefined

    render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (closePanel = context.close)} />
        <PanelHarness captureDispatch={vi.fn()} inputAdapter={inputAdapter} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('No results')

    const panel = screen.getByTestId('quick-panel')
    const expected = getQuickPanelHeights({
      isVisible: true,
      collapsed: true,
      readOnly: false,
      pageSize: 7,
      itemCount: items.length,
      availableHeight: null,
      fill: false
    })

    expect(panel).toHaveStyle({ maxHeight: `${expected.panelMaxHeight}px` })

    vi.useFakeTimers()
    act(() => {
      closePanel?.('esc')
    })

    expect(panel).not.toHaveClass('visible')
    expect(panel).toHaveStyle({ maxHeight: `${expected.panelMaxHeight}px` })
    expect(panel).toHaveClass('transition-none')
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.queryByText('Clear query')).not.toBeInTheDocument()
  })

  it('closes a tracked slash panel before rendering a repeated trigger as a query', async () => {
    const listeners = new Set<Parameters<NonNullable<QuickPanelInputAdapter['subscribeInput']>>[0]>()
    let inputText = '/'
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => inputText.length,
      getText: () => inputText,
      insertText: vi.fn(),
      subscribeInput: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
    const items: QuickPanelListItem[] = [{ id: 'root', label: 'Root action', icon: 'tool', action: vi.fn() }]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={vi.fn()} inputAdapter={inputAdapter} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('Root action')

    inputText = '//'
    act(() => {
      listeners.forEach((listener) => listener())
    })

    await waitFor(() => {
      expect(screen.getByTestId('quick-panel')).not.toHaveClass('visible')
    })
    expect(screen.queryByText('No results')).not.toBeInTheDocument()
    expect(screen.getByText('Root action')).toBeInTheDocument()
  })

  it.each([
    { name: 'a non-slash symbol', symbol: '@', inputText: '@notes' },
    { name: 'the ideographic comma root alias', symbol: '/', inputText: '、notes' }
  ])('tracks $name and consumes the trigger range on selection', async ({ symbol, inputText }) => {
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const deleteTriggerRange = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange,
      focus: vi.fn(),
      getCursorOffset: () => inputText.length,
      getText: () => inputText,
      insertText: vi.fn()
    }
    const items: QuickPanelListItem[] = [{ id: 'notes', label: 'notes.md', icon: 'file', action }]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} inputAdapter={inputAdapter} items={items} symbol={symbol} />
      </QuickPanelProvider>
    )

    await screen.findByText('notes.md')

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    const { event } = createKeyDownEvent('Enter')

    let handled = false
    act(() => {
      handled = dispatchKeyDown(event)
    })

    expect(handled).toBe(true)
    expect(deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: inputText.length })
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'enter',
        searchText: 'notes'
      })
    )
  })

  it('resets the active item when a tracked externally managed list is reopened', async () => {
    const captureDispatch = vi.fn()
    let inputText = '@a'
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => inputText.length,
      getText: () => inputText,
      insertText: vi.fn()
    }
    const initialItems: QuickPanelListItem[] = [
      { id: 'alpha', label: 'alpha.md', icon: 'file', action: vi.fn() },
      { id: 'beta', label: 'beta.md', icon: 'file', action: vi.fn() }
    ]
    const nextItems: QuickPanelListItem[] = [
      { id: 'alpine', label: 'alpine.md', icon: 'file', action: vi.fn() },
      { id: 'archived', label: 'archived.md', icon: 'file', disabled: true, action: vi.fn() }
    ]

    const { rerender } = render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={initialItems}
          manageListExternally
          symbol="@"
        />
      </QuickPanelProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('alpha.md').closest('[data-id="alpha"]')?.getAttribute('data-active')).toBe('true')
    })

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('ArrowDown').event)
    })

    await waitFor(() => {
      expect(screen.getByText('beta.md').closest('[data-id="beta"]')?.getAttribute('data-active')).toBe('true')
    })

    inputText = '@al'
    rerender(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={nextItems}
          manageListExternally
          symbol="@"
        />
      </QuickPanelProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('alpine.md').closest('[data-id="alpine"]')?.getAttribute('data-active')).toBe('true')
    })
    expect(screen.getByText('archived.md').closest('[data-id="archived"]')?.getAttribute('data-active')).not.toBe(
      'true'
    )
  })

  it.each([
    { name: 'whitespace terminates the query', inputText: '@notes ', cursorOffset: 7 },
    { name: 'the cursor leaves the query end', inputText: '@notes', cursorOffset: 3 }
  ])('closes a tracked non-slash input panel when $name', async ({ inputText, cursorOffset }) => {
    const captureDispatch = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => cursorOffset,
      getText: () => inputText,
      insertText: vi.fn()
    }

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={[{ id: 'notes', label: 'notes.md', icon: 'file', action: vi.fn() }]}
          symbol="@"
        />
      </QuickPanelProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('quick-panel')).not.toHaveClass('visible')
    })
  })
})
