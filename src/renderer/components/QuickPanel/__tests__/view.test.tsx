import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React, { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getQuickPanelHeights, QUICK_PANEL_BODY_CHROME_VERTICAL_SPACE, QUICK_PANEL_SAFE_MARGIN } from '../heights'
import { QuickPanelProvider } from '../QuickPanelProvider'
import { QuickPanelView } from '../QuickPanelView'
import type {
  QuickPanelContextType,
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
      ref
    }: {
      children: (item: QuickPanelListItem, index: number) => React.ReactNode
      list: QuickPanelListItem[]
      size?: number
      ref?: React.Ref<{ scrollToIndex: (index: number) => void; scrollToOffset: (offset: number) => void }>
    }) => {
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: virtualListMocks.scrollToIndex,
        scrollToOffset: virtualListMocks.scrollToOffset
      }))

      return (
        <div data-size={size} data-testid="quick-panel-virtual-list">
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

  it('keeps a button-triggered tracked panel open when the cursor is inside a word', async () => {
    const captureDispatch = vi.fn()
    const onClose = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => 'hello world',
      getCursorOffset: () => 3,
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
          queryAnchor={3}
          triggerInfo={{ type: 'button', position: 3 }}
          trackInputQuery
          onClose={onClose}
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Action')

    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps a button-triggered tracked panel open when the query contains whitespace', async () => {
    const captureDispatch = vi.fn()
    const onClose = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => 'new chat',
      getCursorOffset: () => 8,
      insertText: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={[{ id: 'new-chat', label: 'New chat', icon: 'message' }]}
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          onClose={onClose}
        />
      </QuickPanelProvider>
    )

    await screen.findByText('New chat')

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
    const chromeHeight = footerHeight + QUICK_PANEL_BODY_CHROME_VERTICAL_SPACE
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
    }
  })

  it('recomputes placement metrics when an open welcome panel docks', async () => {
    const panelBottom = 240
    const dockTop = 40
    const availableHeight = panelBottom - dockTop - QUICK_PANEL_SAFE_MARGIN
    const footerHeight = 30
    const chromeHeight = footerHeight + QUICK_PANEL_BODY_CHROME_VERTICAL_SPACE
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

  it('anchors bottom-fixed items outside the virtual list and keeps them last in keyboard navigation', async () => {
    const customizeAction = vi.fn()
    const captureDispatch = vi.fn()
    const items: QuickPanelListItem[] = [
      { id: 'first', label: 'First action', icon: '1', action: vi.fn() },
      { id: 'second', label: 'Second action', icon: '2', action: vi.fn() },
      {
        id: 'customize',
        label: 'Customize toolbar',
        icon: 'settings',
        fixedToBottom: true,
        action: customizeAction
      }
    ]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} items={items} />
      </QuickPanelProvider>
    )

    const fixedBottom = await screen.findByTestId('quick-panel-fixed-bottom')
    const virtualList = screen.getByTestId('quick-panel-virtual-list')
    expect(fixedBottom).toHaveClass('absolute', 'bottom-0')
    expect(within(fixedBottom).getByText('Customize toolbar')).toBeInTheDocument()
    expect(within(virtualList).queryByText('Customize toolbar')).not.toBeInTheDocument()

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    virtualListMocks.scrollToIndex.mockClear()
    act(() => {
      dispatchKeyDown(createKeyDownEvent('ArrowUp').event)
    })

    await waitFor(() => {
      expect(screen.getByText('Customize toolbar').closest('[data-id="customize"]')).toHaveAttribute(
        'data-active',
        'true'
      )
    })
    expect(virtualListMocks.scrollToIndex).not.toHaveBeenCalled()

    act(() => {
      dispatchKeyDown(createKeyDownEvent('Tab').event)
    })
    expect(customizeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'enter',
        item: expect.objectContaining({ id: 'customize' })
      })
    )
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

  it('blocks pointer events only while the panel is visible', async () => {
    const items: QuickPanelListItem[] = [{ id: 'first', label: 'First action', icon: '1', action: vi.fn() }]

    const { rerender } = render(
      <QuickPanelProvider>
        <QuickPanelView />
      </QuickPanelProvider>
    )

    const hiddenPanel = screen.getByTestId('quick-panel')
    expect(hiddenPanel.className).toContain('pointer-events-none')
    expect(hiddenPanel.className).not.toContain('pointer-events-auto')

    rerender(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={vi.fn()} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('First action')
    const visiblePanel = screen.getByTestId('quick-panel')
    expect(visiblePanel.className).toContain('pointer-events-auto')
    expect(visiblePanel.className).not.toContain('pointer-events-none')
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

  it('keeps a bottom-fixed action visible when filtering has no results', async () => {
    const action = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 8,
      getText: () => '/missing',
      insertText: vi.fn()
    }
    const items: QuickPanelListItem[] = [
      { id: 'regular', label: 'Regular action', icon: 'r' },
      { id: 'customize', label: 'Customize toolbar', icon: 'settings', fixedToBottom: true, action }
    ]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={vi.fn()} inputAdapter={inputAdapter} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('No results')
    expect(screen.queryByTestId('quick-panel-virtual-list')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('quick-panel-fixed-bottom')).getByText('Customize toolbar')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Customize toolbar'))
    expect(action).toHaveBeenCalledTimes(1)
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
    expect(screen.getByTestId('quick-panel-body')).toHaveClass('transition-[translate,scale,opacity,box-shadow]')
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

  it('tracks non-slash input queries and consumes the trigger range on selection', async () => {
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const deleteTriggerRange = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange,
      focus: vi.fn(),
      getCursorOffset: () => 6,
      getText: () => '@notes',
      insertText: vi.fn()
    }
    const items: QuickPanelListItem[] = [{ id: 'notes', label: 'notes.md', icon: 'file', action }]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} inputAdapter={inputAdapter} items={items} symbol="@" />
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
    expect(deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 6 })
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'enter',
        searchText: 'notes'
      })
    )
  })

  it('tracks ideographic comma input queries under the root symbol and consumes the trigger range on selection', async () => {
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const deleteTriggerRange = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange,
      focus: vi.fn(),
      getCursorOffset: () => 6,
      getText: () => '、notes',
      insertText: vi.fn()
    }
    const items: QuickPanelListItem[] = [{ id: 'notes', label: 'notes.md', icon: 'file', action }]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} inputAdapter={inputAdapter} items={items} symbol="/" />
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
    expect(deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 6 })
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

  it('closes a tracked non-slash input panel when whitespace terminates the query', async () => {
    const captureDispatch = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 7,
      getText: () => '@notes ',
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

  it('closes a tracked non-slash input panel when the cursor leaves the query end', async () => {
    const captureDispatch = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 3,
      getText: () => '@notes',
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
