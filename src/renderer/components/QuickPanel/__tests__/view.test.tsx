import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React, { Activity, useEffect, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getQuickPanelHeights, QUICK_PANEL_ITEM_HEIGHT, QUICK_PANEL_SAFE_MARGIN } from '../heights'
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
  inputAdapter,
  items,
  manageListExternally,
  multiple,
  readOnly,
  symbol = '/',
  title = 'Actions',
  triggerInfo,
  trackInputQuery,
  consumeQueryOnDismiss,
  initialSearchText,
  queryAnchor,
  onClose,
  fill = false
}: {
  captureDispatch: (dispatch: QuickPanelContextType['dispatchKeyDown']) => void
  inputAdapter?: QuickPanelInputAdapter
  items: QuickPanelListItem[]
  manageListExternally?: boolean
  multiple?: boolean
  readOnly?: boolean
  symbol?: string
  title?: string
  triggerInfo?: QuickPanelTriggerInfo
  trackInputQuery?: boolean
  consumeQueryOnDismiss?: boolean
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
      multiple,
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
      consumeQueryOnDismiss,
      initialSearchText,
      onClose
    })
  }, [
    consumeQueryOnDismiss,
    inputAdapter,
    initialSearchText,
    items,
    manageListExternally,
    multiple,
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

function createMutableTrackedInput(initialText = '', initialCursor = initialText.length) {
  let text = initialText
  let cursorOffset = initialCursor
  const listeners = new Set<Parameters<NonNullable<QuickPanelInputAdapter['subscribeInput']>>[0]>()
  const deleteTriggerRange = vi.fn(({ from, to }: { from: number; to: number }) => {
    text = `${text.slice(0, from)}${text.slice(to)}`
    cursorOffset = from
  })
  const inputAdapter: QuickPanelInputAdapter = {
    getText: () => text,
    getCursorOffset: () => cursorOffset,
    insertText: vi.fn(),
    deleteTriggerRange,
    focus: vi.fn(),
    subscribeInput: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }

  return {
    deleteTriggerRange,
    inputAdapter,
    getText: () => text,
    setText: (nextText: string, nextCursor = nextText.length) => {
      text = nextText
      cursorOffset = nextCursor
    },
    emitInput: () => {
      listeners.forEach((listener) => listener({ cause: 'user-input' }))
    }
  }
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

  it('consumes a button-tracked live filter when a multi-select panel is dismissed', async () => {
    // Bug: keepLiveFilter retains the typed query across picks, but Esc/outside-click never
    // consume it, so "card" stays in the composer draft and is sent with the message.
    const captureDispatch = vi.fn()
    const action = vi.fn()
    let text = 'card'
    let cursorOffset = text.length
    const deleteTriggerRange = vi.fn(({ from, to }: { from: number; to: number }) => {
      text = `${text.slice(0, from)}${text.slice(to)}`
      cursorOffset = from
    })
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => text,
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
          items={[
            { id: 'card', label: 'Card note', icon: 'card', action },
            { id: 'other', label: 'Other note', icon: 'other', action: vi.fn() }
          ]}
          multiple
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Card note')
    expect(screen.queryByText('Other note')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Card note'))
    expect(action).toHaveBeenCalledTimes(1)
    expect(deleteTriggerRange).not.toHaveBeenCalled()
    expect(text).toBe('card')
    expect(screen.getByTestId('quick-panel')).toHaveClass('visible')

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('Escape').event)
    })

    expect(deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 4 })
    expect(text).toBe('')
  })

  it('keeps leftover composer text when selecting from a slash-opened submenu', async () => {
    // Bug: a stale queryAnchor of 0 after slash-trigger deletion lets consumeInputQuery wipe
    // leftover draft such as `hello world` when a Quick Phrases/skills item is selected.
    const action = vi.fn()
    let text = 'hello world'
    let cursorOffset = text.length
    const deleteTriggerRange = vi.fn(({ from, to }: { from: number; to: number }) => {
      text = `${text.slice(0, from)}${text.slice(to)}`
      cursorOffset = from
    })
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => text,
      getCursorOffset: () => cursorOffset,
      insertText: vi.fn(),
      deleteTriggerRange,
      focus: vi.fn()
    }

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={vi.fn()}
          inputAdapter={inputAdapter}
          items={[{ id: 'prompt', label: 'Prompt 1', icon: 'zap', action }]}
          triggerInfo={{ type: 'button' }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    fireEvent.click(await screen.findByText('Prompt 1'))

    expect(action).toHaveBeenCalledTimes(1)
    expect(deleteTriggerRange).not.toHaveBeenCalled()
    expect(text).toBe('hello world')
  })

  it('consumes a button-tracked live filter only once when selecting a non-menu resource', async () => {
    // Bug: handleItemAction called consumeInputQuery(), then handleClose/consumeQueryOnDismiss
    // consumed again and deleted the same prefix from the inserted resource text.
    const inserted = 'card-note'
    let text = 'card'
    let cursorOffset = text.length
    const deleteTriggerRange = vi.fn(({ from, to }: { from: number; to: number }) => {
      text = `${text.slice(0, from)}${text.slice(to)}`
      cursorOffset = from
    })
    const insertText = vi.fn((value: string) => {
      text = `${text.slice(0, cursorOffset)}${value}${text.slice(cursorOffset)}`
      cursorOffset += value.length
    })
    const action = vi.fn(({ inputAdapter }: { inputAdapter?: QuickPanelInputAdapter }) => {
      inputAdapter?.insertText(inserted)
    })
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => text,
      getCursorOffset: () => cursorOffset,
      insertText,
      deleteTriggerRange,
      focus: vi.fn()
    }

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={vi.fn()}
          inputAdapter={inputAdapter}
          items={[{ id: 'card-note', label: 'Card note', icon: 'card', action }]}
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    fireEvent.click(await screen.findByText('Card note'))

    expect(action).toHaveBeenCalledTimes(1)
    expect(deleteTriggerRange).toHaveBeenCalledTimes(1)
    expect(deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 4 })
    expect(insertText).toHaveBeenCalledWith(inserted)
    expect(text).toBe(inserted)
  })

  it('consumes a newly typed filter after an earlier keepOpenOnAction selection', async () => {
    // Bug: editable MCP status panels stay open (keepOpenOnAction). consumeInputQueryOnce marks the
    // first pick as consumed, so a later typed filter remains in the composer draft.
    const firstAction = vi.fn()
    const secondAction = vi.fn()
    const tracked = createMutableTrackedInput('fs')
    const items: QuickPanelListItem[] = [
      {
        id: 'mcp-status:filesystem',
        label: 'filesystem',
        icon: 'mcp',
        action: firstAction,
        keepOpenOnAction: true
      },
      {
        id: 'mcp-status:browser',
        label: 'browser',
        icon: 'mcp',
        action: secondAction,
        keepOpenOnAction: true
      }
    ]

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={vi.fn()}
          inputAdapter={tracked.inputAdapter}
          items={items}
          queryAnchor={0}
          symbol="mcp-status"
          title="MCP"
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
        />
      </QuickPanelProvider>
    )

    fireEvent.click(await screen.findByText('filesystem'))

    expect(firstAction).toHaveBeenCalledTimes(1)
    expect(tracked.deleteTriggerRange).toHaveBeenCalledTimes(1)
    expect(tracked.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 2 })
    expect(tracked.getText()).toBe('')
    expect(screen.getByTestId('quick-panel')).toHaveClass('visible')

    act(() => {
      tracked.setText('br')
      tracked.emitInput()
    })

    fireEvent.click(await screen.findByText('browser'))

    expect(secondAction).toHaveBeenCalledTimes(1)
    expect(tracked.deleteTriggerRange).toHaveBeenCalledTimes(2)
    expect(tracked.deleteTriggerRange).toHaveBeenLastCalledWith({ from: 0, to: 2 })
    expect(tracked.getText()).toBe('')
    expect(screen.getByTestId('quick-panel')).toHaveClass('visible')
  })

  it('does not consume composer text when the root tool panel is dismissed', async () => {
    // Bug: keepLiveFilter = trackInputQuery && type:button also matches the "+" root panel,
    // so Esc deleted real message draft typed while the menu was open.
    const captureDispatch = vi.fn()
    let text = 'hello draft'
    let cursorOffset = text.length
    const deleteTriggerRange = vi.fn(({ from, to }: { from: number; to: number }) => {
      text = `${text.slice(0, from)}${text.slice(to)}`
      cursorOffset = from
    })
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => text,
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
          items={[
            { id: 'hello', label: 'hello draft', icon: 'paperclip', action: vi.fn() },
            { id: 'web-search', label: 'Web Search', icon: 'search', action: vi.fn() }
          ]}
          queryAnchor={0}
          symbol="+"
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
        />
      </QuickPanelProvider>
    )

    await screen.findByText('hello draft')
    expect(screen.queryByText('Web Search')).not.toBeInTheDocument()

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('Escape').event)
    })

    expect(deleteTriggerRange).not.toHaveBeenCalled()
    expect(text).toBe('hello draft')
  })

  it('consumes a live filter when the panel is toggled closed without going through Esc', async () => {
    // Bug: toolbar toggle and KB close-on-next-input call provider.close, skipping handleClose.
    const action = vi.fn()
    let text = 'card'
    let cursorOffset = text.length
    const deleteTriggerRange = vi.fn(({ from, to }: { from: number; to: number }) => {
      text = `${text.slice(0, from)}${text.slice(to)}`
      cursorOffset = from
    })
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => text,
      getCursorOffset: () => cursorOffset,
      insertText: vi.fn(),
      deleteTriggerRange,
      focus: vi.fn()
    }
    let closePanel: QuickPanelContextType['close'] | undefined

    render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (closePanel = context.close)} />
        <PanelHarness
          captureDispatch={vi.fn()}
          inputAdapter={inputAdapter}
          items={[
            { id: 'card', label: 'Card note', icon: 'card', action },
            { id: 'other', label: 'Other note', icon: 'other', action: vi.fn() }
          ]}
          multiple
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Card note')
    fireEvent.click(screen.getByText('Card note'))
    expect(deleteTriggerRange).not.toHaveBeenCalled()

    act(() => {
      closePanel?.('toggle')
    })

    expect(deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 4 })
    expect(text).toBe('')
  })

  it('consumes a button-tracked live filter when a visible panel is replaced', async () => {
    // Bug: ComposerSurfaceRuntime close('panel_replaced') + immediate open batches isVisible
    // false→true, so the isVisible=false dismiss effect never runs and the filter stays in draft.
    const action = vi.fn()
    let text = 'card'
    let cursorOffset = text.length
    const deleteTriggerRange = vi.fn(({ from, to }: { from: number; to: number }) => {
      text = `${text.slice(0, from)}${text.slice(to)}`
      cursorOffset = from
    })
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => text,
      getCursorOffset: () => cursorOffset,
      insertText: vi.fn(),
      deleteTriggerRange,
      focus: vi.fn()
    }
    let quickPanel: QuickPanelContextType | undefined

    render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (quickPanel = context)} />
        <PanelHarness
          captureDispatch={vi.fn()}
          inputAdapter={inputAdapter}
          items={[
            { id: 'card', label: 'Card note', icon: 'card', action },
            { id: 'other', label: 'Other note', icon: 'other', action: vi.fn() }
          ]}
          multiple
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Card note')
    fireEvent.click(screen.getByText('Card note'))
    expect(deleteTriggerRange).not.toHaveBeenCalled()

    act(() => {
      quickPanel?.close('panel_replaced')
      quickPanel?.open({
        list: [{ id: 'next', label: 'Next panel', icon: 'next', action: vi.fn() }],
        symbol: '@',
        title: 'Next',
        triggerInfo: { type: 'button', position: 0 },
        queryAnchor: 0,
        trackInputQuery: true,
        consumeQueryOnDismiss: true
      })
    })

    expect(deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 4 })
    expect(text).toBe('')
    expect(await screen.findByText('Next panel')).toBeTruthy()
  })

  it('keeps the new trigger when a live-filter panel is replaced by a direct input suggestion', async () => {
    // Bug: generation-change reclaim used the incoming input-tracked ctx, so direct open()
    // (no close('panel_replaced')) deleted the new trigger and closed the replacement panel.
    const action = vi.fn()
    let text = ''
    let cursorOffset = 0
    const deleteTriggerRange = vi.fn(({ from, to }: { from: number; to: number }) => {
      text = `${text.slice(0, from)}${text.slice(to)}`
      cursorOffset = from
    })
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => text,
      getCursorOffset: () => cursorOffset,
      insertText: vi.fn(),
      deleteTriggerRange,
      focus: vi.fn()
    }
    let quickPanel: QuickPanelContextType | undefined

    render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (quickPanel = context)} />
        <PanelHarness
          captureDispatch={vi.fn()}
          inputAdapter={inputAdapter}
          items={[
            { id: 'card', label: 'Card note', icon: 'card', action },
            { id: 'other', label: 'Other note', icon: 'other', action: vi.fn() }
          ]}
          multiple
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Card note')

    text = '@'
    cursorOffset = 1
    act(() => {
      quickPanel?.open({
        list: [{ id: 'mention', label: 'Mention user', icon: 'mention', action: vi.fn() }],
        symbol: '@',
        title: 'Mentions',
        triggerInfo: { type: 'input', position: 0, originalText: '@' },
        queryAnchor: 0,
        trackInputQuery: true,
        manageListExternally: true
      })
    })

    expect(deleteTriggerRange).not.toHaveBeenCalled()
    expect(text).toBe('@')
    expect(await screen.findByText('Mention user')).toBeTruthy()
    expect(screen.queryByText('Card note')).toBeNull()
  })

  it('consumes only the live-filter prefix when close happens after extra composer input', async () => {
    // Bug: consume used [anchor, cursor], so a keystroke after a KB pick deleted the new char too.
    const action = vi.fn()
    let text = 'card'
    let cursorOffset = text.length
    const deleteTriggerRange = vi.fn(({ from, to }: { from: number; to: number }) => {
      text = `${text.slice(0, from)}${text.slice(to)}`
      cursorOffset = from
    })
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => text,
      getCursorOffset: () => cursorOffset,
      insertText: vi.fn(),
      deleteTriggerRange,
      focus: vi.fn()
    }
    let closePanel: QuickPanelContextType['close'] | undefined

    render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (closePanel = context.close)} />
        <PanelHarness
          captureDispatch={vi.fn()}
          inputAdapter={inputAdapter}
          items={[
            { id: 'card', label: 'Card note', icon: 'card', action },
            { id: 'other', label: 'Other note', icon: 'other', action: vi.fn() }
          ]}
          multiple
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Card note')
    fireEvent.click(screen.getByText('Card note'))
    expect(text).toBe('card')

    text = 'cardX'
    cursorOffset = text.length
    act(() => {
      closePanel?.('knowledge_base_input_resumed')
    })

    expect(deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 4 })
    expect(text).toBe('X')
  })

  it('does not consume the first resume character typed in the same tick as dismiss', async () => {
    // Bug: updateSearchFromInput and KB close-on-next-input run in one input event, so
    // dismiss consume widens to include the resume character and deletes it.
    const action = vi.fn()
    const input = createMutableTrackedInput('card')
    let closePanel: QuickPanelContextType['close'] | undefined

    render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (closePanel = context.close)} />
        <PanelHarness
          captureDispatch={vi.fn()}
          inputAdapter={input.inputAdapter}
          items={[
            { id: 'card', label: 'Card note', icon: 'card', action },
            { id: 'other', label: 'Other note', icon: 'other', action: vi.fn() }
          ]}
          multiple
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Card note')
    fireEvent.click(screen.getByText('Card note'))
    expect(input.getText()).toBe('card')

    const unsubscribe = input.inputAdapter.subscribeInput?.(() => {
      closePanel?.('knowledge_base_input_resumed')
    })
    input.setText('cardX')
    act(() => {
      input.emitInput()
    })
    unsubscribe?.()

    expect(input.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 4 })
    expect(input.getText()).toBe('X')
  })

  it('does not consume slash leftover draft after a later content edit', async () => {
    // Bug: after slash-trigger deletion the view reconstructs queryAnchor at 0, so a later
    // leftover edit becomes slice(0, cursor) and dismiss deletes the leftover draft.
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const leftover = 'hello world'
    const input = createMutableTrackedInput(leftover, 0)

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={input.inputAdapter}
          items={[{ id: 'prompt', label: 'Prompt 1', icon: 'zap', action }]}
          triggerInfo={{ type: 'button' }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Prompt 1')

    input.setText(`${leftover}!`)
    act(() => {
      input.emitInput()
    })

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('Escape').event)
    })

    expect(input.deleteTriggerRange).not.toHaveBeenCalled()
    expect(input.getText()).toBe(`${leftover}!`)
  })

  it('closes a button-tracked panel when its opening suffix changes', async () => {
    const onClose = vi.fn()
    const input = createMutableTrackedInput('original suffix', 0)

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={vi.fn()}
          inputAdapter={input.inputAdapter}
          items={[{ id: 'prompt', label: 'Prompt 1', icon: 'zap' }]}
          triggerInfo={{ type: 'button' }}
          trackInputQuery
          consumeQueryOnDismiss
          onClose={onClose}
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Prompt 1')

    input.setText('edited suffix', 0)
    act(() => {
      input.emitInput()
    })

    await waitFor(() =>
      expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ action: 'input_session_invalid' }))
    )
    expect(input.deleteTriggerRange).not.toHaveBeenCalled()
    expect(input.getText()).toBe('edited suffix')
  })

  it('consumes only a caret-typed live filter when leftover draft stays after it', async () => {
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const leftover = 'hello world'
    const input = createMutableTrackedInput(leftover, 0)

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={input.inputAdapter}
          items={[
            { id: 'card', label: 'Card note', icon: 'card', action },
            { id: 'other', label: 'Other note', icon: 'other', action: vi.fn() }
          ]}
          triggerInfo={{ type: 'button' }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Card note')
    expect(screen.getByText('Other note')).toBeInTheDocument()

    input.setText(`card${leftover}`, 'card'.length)
    act(() => {
      input.emitInput()
    })

    await waitFor(() => expect(screen.queryByText('Other note')).not.toBeInTheDocument())
    expect(screen.getByText('Card note')).toBeInTheDocument()

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('Escape').event)
    })

    expect(input.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 4 })
    expect(input.getText()).toBe(leftover)
  })

  it('tracks replacement text from a selected composer range without consuming surrounding draft', async () => {
    const captureDispatch = vi.fn()
    const input = createMutableTrackedInput('prefix SELECTED suffix', 'prefix '.length)
    const inputAdapter = {
      ...input.inputAdapter,
      getSelectionEndOffset: () => 'prefix SELECTED'.length
    } satisfies QuickPanelInputAdapter

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={[
            { id: 'card', label: 'Card note', icon: 'card' },
            { id: 'other', label: 'Other note', icon: 'other' }
          ]}
          triggerInfo={{ type: 'button' }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Card note')
    expect(screen.getByText('Other note')).toBeInTheDocument()

    input.setText('prefix card suffix', 'prefix card'.length)
    act(() => input.emitInput())

    await waitFor(() => expect(screen.queryByText('Other note')).not.toBeInTheDocument())

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('Escape').event)
    })

    expect(input.deleteTriggerRange).toHaveBeenCalledWith({ from: 'prefix '.length, to: 'prefix card'.length })
    expect(input.getText()).toBe('prefix  suffix')
  })

  it('consumes a live filter on outside click without deleting leftover draft', async () => {
    const action = vi.fn()
    const leftover = 'hello world'
    const input = createMutableTrackedInput(`card${leftover}`, 'card'.length)

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={vi.fn()}
          inputAdapter={input.inputAdapter}
          items={[
            { id: 'card', label: 'Card note', icon: 'card', action },
            { id: 'other', label: 'Other note', icon: 'other', action: vi.fn() }
          ]}
          multiple
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Card note')
    fireEvent.click(screen.getByText('Card note'))
    expect(input.deleteTriggerRange).not.toHaveBeenCalled()

    act(() => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(input.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 4 })
    expect(input.getText()).toBe(leftover)
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

  it.each(['Tab', 'Enter'] as const)(
    'activates a bottom-fixed item with %s when search collapses the list',
    async (key) => {
      // Bug: collapsed panels still render fixedToBottom Manage/Add, but Tab/Enter return
      // early on isCollapsed, so keyboard cannot activate the only remaining action.
      const action = vi.fn()
      const captureDispatch = vi.fn()
      const inputAdapter: QuickPanelInputAdapter = {
        deleteTriggerRange: vi.fn(),
        focus: vi.fn(),
        getCursorOffset: () => 0,
        getText: () => '',
        insertText: vi.fn()
      }
      const items: QuickPanelListItem[] = [
        { id: 'regular', label: 'Regular action', icon: 'r', action: vi.fn() },
        { id: 'manage', label: 'Manage', icon: 'settings', fixedToBottom: true, action }
      ]

      render(
        <QuickPanelProvider>
          <PanelHarness
            captureDispatch={captureDispatch}
            inputAdapter={inputAdapter}
            items={items}
            queryAnchor={0}
            triggerInfo={{ type: 'button', position: 0 }}
            trackInputQuery
            initialSearchText="zzz"
          />
        </QuickPanelProvider>
      )

      await screen.findByText('No results')
      expect(within(screen.getByTestId('quick-panel-fixed-bottom')).getByText('Manage')).toBeInTheDocument()

      const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
      act(() => {
        dispatchKeyDown(createKeyDownEvent(key).event)
      })

      expect(action).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'enter',
          item: expect.objectContaining({ id: 'manage' })
        })
      )
    }
  )

  it('activates a bottom-fixed item with ArrowDown then Enter when search collapses the list', async () => {
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 0,
      getText: () => '',
      insertText: vi.fn()
    }
    const items: QuickPanelListItem[] = [
      { id: 'regular', label: 'Regular action', icon: 'r', action: vi.fn() },
      { id: 'manage', label: 'Manage', icon: 'settings', fixedToBottom: true, action }
    ]

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={items}
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          initialSearchText="zzz"
        />
      </QuickPanelProvider>
    )

    await screen.findByText('No results')

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('ArrowDown').event)
      dispatchKeyDown(createKeyDownEvent('Enter').event)
    })

    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'enter',
        item: expect.objectContaining({ id: 'manage' })
      })
    )
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
