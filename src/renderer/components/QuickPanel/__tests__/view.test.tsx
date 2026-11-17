import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React, { Activity, type ReactNode, useEffect, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getQuickPanelHeights } from '../heights'
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

// The renderer setup stubs the whole UI kit with content-dropped tooltips; restore a minimal
// NormalTooltip that exposes the controlled `open` flag so row tooltip gating stays observable.
vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    size,
    variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) => (
    <button type="button" data-size={size} data-variant={variant} {...props}>
      {children}
    </button>
  ),
  Kbd: ({ children }: { children?: ReactNode }) => <kbd>{children}</kbd>,
  NormalTooltip: ({ open = false, children }: { open?: boolean; children?: ReactNode }) => (
    <div data-open={String(open)}>{children}</div>
  )
}))

const virtualListMocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  scrollToOffset: vi.fn()
}))

// 单选子菜单夹具：当前值行带警告 tooltip，模拟权限模式弹层。
const singleSelectSubmenuItems: QuickPanelListItem[] = [
  { id: 'default', label: 'Ask every time', icon: '1', action: vi.fn() },
  {
    id: 'plan',
    label: 'Plan only',
    icon: '2',
    tooltip: 'Plan tip',
    tooltipAnchor: <span aria-label="plan-warning" />,
    action: vi.fn()
  },
  {
    id: 'smart',
    label: 'Smart approval',
    icon: '3',
    isSelected: true,
    tooltip: 'Smart tip',
    tooltipAnchor: <span aria-label="smart-warning" />,
    action: vi.fn()
  }
]

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

function PanelHarness({
  captureDispatch,
  footerActions,
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
  defaultIndex,
  openNonce = 0,
  onClose,
  fill = false
}: {
  captureDispatch: (dispatch: QuickPanelContextType['dispatchKeyDown']) => void
  footerActions?: QuickPanelFooterAction[]
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
  defaultIndex?: number
  /** Bumping re-calls open() with the same symbol, like a reopen inside the cleanup window. */
  openNonce?: number
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
      multiple,
      readOnly,
      symbol,
      title,
      defaultIndex,
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
    footerActions,
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
    triggerInfo,
    defaultIndex,
    openNonce
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

  it('keeps pinyin matches for every row when descriptions repeat across items', async () => {
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
          captureDispatch={vi.fn()}
          inputAdapter={inputAdapter}
          items={[
            { id: 'pdf', label: 'PDF skill', description: '知识库中的技术资料', icon: 'file' },
            { id: 'research', label: 'Research skill', description: '知识库', icon: 'search' }
          ]}
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          initialSearchText="zsk"
        />
      </QuickPanelProvider>
    )

    expect(await screen.findByText('PDF skill')).toBeInTheDocument()
    expect(screen.getByText('Research skill')).toBeInTheDocument()
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

  it.each([
    { name: 'the full draft', initialText: 'abc', afterInput: 'abcX' },
    { name: 'a range before a suffix', initialText: 'abc tail', afterInput: 'abcX tail' }
  ])('preserves $name after the selection collapses and input resumes', async ({ initialText, afterInput }) => {
    const listeners = new Set<Parameters<NonNullable<QuickPanelInputAdapter['subscribeInput']>>[0]>()
    let text = initialText
    let cursorOffset = 0
    let selectionEndOffset = 3
    const deleteTriggerRange = vi.fn(({ from, to }: { from: number; to: number }) => {
      text = `${text.slice(0, from)}${text.slice(to)}`
      cursorOffset = from
      selectionEndOffset = from
    })
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => text,
      getCursorOffset: () => cursorOffset,
      getSelectionEndOffset: () => selectionEndOffset,
      insertText: vi.fn(),
      deleteTriggerRange,
      focus: vi.fn(),
      subscribeInput: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
    const captureDispatch = vi.fn()

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={[{ id: 'action', label: 'Action', icon: 'a' }]}
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Action')

    const right = createKeyDownEvent('ArrowRight')
    act(() => {
      window.dispatchEvent(right.event)
    })
    expect(right.preventDefault).not.toHaveBeenCalled()
    expect(right.stopPropagation).not.toHaveBeenCalled()

    // Apply the editor's default ArrowRight behavior: collapse the selection at its end.
    cursorOffset = 3
    selectionEndOffset = 3
    text = afterInput
    cursorOffset = 4
    selectionEndOffset = 4
    act(() => {
      listeners.forEach((listener) => listener({ cause: 'user-input' }))
    })

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('Escape').event)
    })

    expect(deleteTriggerRange).not.toHaveBeenCalled()
    expect(text).toBe(afterInput)
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

  it('opens Permission Mode from /permission without inheriting the parent query', async () => {
    const user = userEvent.setup()
    let text = '/permission'
    let cursorOffset = text.length
    let selectedMode: string | undefined
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => text,
      getCursorOffset: () => cursorOffset,
      insertText: vi.fn(),
      deleteTriggerRange: ({ from, to }) => {
        text = text.slice(0, from) + text.slice(to)
        cursorOffset = from
      },
      focus: vi.fn()
    }
    const menuAction: QuickPanelListItem['action'] = ({ context, parentPanel }) => {
      context.open({
        title: 'Permission Mode',
        symbol: 'permission-mode',
        parentPanel,
        triggerInfo: { type: 'button' },
        trackInputQuery: true,
        list: [
          { id: 'plan', label: 'Plan Only', icon: 'plan', action: () => (selectedMode = 'plan') },
          { id: 'auto', label: 'Approve for Me', icon: 'auto', action: () => (selectedMode = 'auto') }
        ]
      })
    }

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={vi.fn()}
          inputAdapter={inputAdapter}
          items={[
            { id: 'permission-mode', label: 'Permission Mode', icon: 'shield', isMenu: true, action: menuAction }
          ]}
          queryAnchor={0}
        />
      </QuickPanelProvider>
    )

    const permissionMode = await screen.findByRole('button', { name: /Permission Mode/ })
    await user.hover(screen.getByTestId('quick-panel-body'))
    await user.click(permissionMode)

    expect(text).toBe('')
    expect(await screen.findByRole('button', { name: /Plan Only/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Approve for Me/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Plan Only/ }))
    expect(selectedMode).toBe('plan')
  })

  it('keeps a multi-select filter through picks and consumes it when dismissed', async () => {
    let text = 'card'
    let cursorOffset = text.length
    const action = vi.fn()
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
    const captureDispatch = vi.fn()

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

    fireEvent.click(await screen.findByText('Card note'))
    expect(action).toHaveBeenCalledOnce()
    expect(deleteTriggerRange).not.toHaveBeenCalled()
    expect(screen.queryByText('Other note')).not.toBeInTheDocument()

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('Escape').event)
    })

    expect(deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 4 })
    expect(text).toBe('')
  })

  it('consumes the outgoing live filter when replacing a visible resource panel', async () => {
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
          items={[{ id: 'card', label: 'Card note', icon: 'card' }]}
          queryAnchor={0}
          triggerInfo={{ type: 'button', position: 0 }}
          trackInputQuery
          consumeQueryOnDismiss
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Card note')
    act(() => {
      quickPanel?.close('panel_replaced')
      quickPanel?.open({
        list: [{ id: 'next', label: 'Next panel', icon: 'next' }],
        symbol: '@',
        triggerInfo: { type: 'button', position: 0 },
        queryAnchor: 0,
        trackInputQuery: true,
        consumeQueryOnDismiss: true
      })
    })

    expect(deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 4 })
    expect(text).toBe('')
    expect(await screen.findByText('Next panel')).toBeInTheDocument()
  })

  // 集成测试验证 context 的 fill 标志 + DOM 几何测量把高度喂给了 getQuickPanelHeights；
  // 具体数值由 heights.test.ts 的纯单测覆盖，这里不写死像素。
  const measuredItems: QuickPanelListItem[] = Array.from({ length: 10 }, (_, index) => ({
    id: `item-${index}`,
    label: `Item ${index}`,
    icon: `${index}`,
    action: vi.fn()
  }))

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

  it('preserves native keyboard traversal between read-only panel controls', async () => {
    const user = userEvent.setup()
    const footerAction = vi.fn()

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={vi.fn()}
          footerActions={[
            {
              id: 'configure',
              label: 'Configure',
              ariaLabel: 'Configure MCP servers',
              icon: 'settings',
              action: footerAction,
              keepOpenOnAction: true
            }
          ]}
          items={[{ id: 'server', label: 'filesystem', icon: 'mcp' }]}
          readOnly
          title="MCP"
        />
      </QuickPanelProvider>
    )

    const closeButton = await screen.findByRole('button', { name: 'settings.quickPanel.close' })
    const actionButton = screen.getByRole('button', { name: 'Configure MCP servers' })
    closeButton.focus()

    await user.tab()

    expect(actionButton).toHaveFocus()
    expect(footerAction).not.toHaveBeenCalled()

    await user.tab({ shift: true })

    expect(closeButton).toHaveFocus()
    expect(footerAction).not.toHaveBeenCalled()

    closeButton.focus()
    await user.keyboard('{Enter}')

    expect(footerAction).not.toHaveBeenCalled()
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

  // 双高亮回归防护：单选子菜单打开时键盘焦点应落在当前值上，选中行不再铺与焦点同色的灰底，
  // 且打开即聚焦不触发行 tooltip（tooltip 只跟随悬停或键盘导航）。
  it('opens on the opener-requested row without a second highlight or an auto tooltip', async () => {
    const captureDispatch = vi.fn()

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} items={singleSelectSubmenuItems} defaultIndex={2} />
      </QuickPanelProvider>
    )

    const smartRow = (await screen.findByText('Smart approval')).closest('[data-id="smart"]')
    const defaultRow = screen.getByText('Ask every time').closest('[data-id="default"]')

    expect(smartRow).toHaveAttribute('data-active', 'true')
    expect(smartRow).toHaveAttribute('aria-pressed', 'true')
    expect(defaultRow).toHaveAttribute('data-active', 'false')
    expect(smartRow?.className).not.toContain('bg-muted')
    expect(smartRow?.className).toContain('bg-accent')
    // 打开即聚焦（defaultIndex）不触发行 tooltip。
    expect(screen.getByLabelText('smart-warning').closest('[data-open]')).toHaveAttribute('data-open', 'false')

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('ArrowUp').event)
    })

    // 键盘导航到达的行恢复 tooltip 供查看，离开的行收回。
    expect(screen.getByLabelText('plan-warning').closest('[data-open]')).toHaveAttribute('data-open', 'true')
    expect(screen.getByLabelText('smart-warning').closest('[data-open]')).toHaveAttribute('data-open', 'false')
  })

  it('treats a same-symbol reopen as a fresh panel for focus and tooltip state', async () => {
    const captureDispatch = vi.fn()
    let quickPanel: QuickPanelContextType | undefined

    const harness = (nonce: number) => (
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (quickPanel = context)} />
        <PanelHarness
          captureDispatch={captureDispatch}
          items={singleSelectSubmenuItems}
          defaultIndex={2}
          openNonce={nonce}
        />
      </QuickPanelProvider>
    )
    const { rerender } = render(harness(0))

    await screen.findByText('Smart approval')
    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('ArrowUp').event)
    })
    expect(screen.getByLabelText('plan-warning').closest('[data-open]')).toHaveAttribute('data-open', 'true')

    // 关闭后在清理窗口内以同一 symbol 重开：不得恢复旧光标与其 tooltip。
    act(() => {
      quickPanel?.close('esc')
    })
    // 面板隐藏瞬间 tooltip 就应收回，不等清理窗口结束。
    expect(screen.getByLabelText('plan-warning').closest('[data-open]')).toHaveAttribute('data-open', 'false')
    rerender(harness(1))

    const smartRow = (await screen.findByText('Smart approval')).closest('[data-id="smart"]')
    const planRow = screen.getByText('Plan only').closest('[data-id="plan"]')
    expect(smartRow).toHaveAttribute('data-active', 'true')
    expect(planRow).toHaveAttribute('data-active', 'false')
    expect(screen.getByLabelText('plan-warning').closest('[data-open]')).toHaveAttribute('data-open', 'false')
    expect(screen.getByLabelText('smart-warning').closest('[data-open]')).toHaveAttribute('data-open', 'false')
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

  it('closes a multi-select panel after a footer action', async () => {
    const manageAction = vi.fn()
    const onClose = vi.fn()

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={vi.fn()}
          footerActions={[
            {
              id: 'knowledge-base:manage',
              label: 'Manage',
              ariaLabel: 'Manage knowledge bases',
              icon: 'settings',
              action: manageAction
            }
          ]}
          items={[{ id: 'knowledge-base:one', label: 'Knowledge One', icon: 'knowledge' }]}
          multiple
          onClose={onClose}
          symbol="#"
        />
      </QuickPanelProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Manage knowledge bases' }))

    expect(manageAction).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ action: 'click' }))
  })

  it('hides only footer actions registered as unavailable during search', async () => {
    const listeners = new Set<Parameters<NonNullable<QuickPanelInputAdapter['subscribeInput']>>[0]>()
    let text = ''
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => text.length,
      getText: () => text,
      insertText: vi.fn(),
      subscribeInput: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
    const searchOnlyAction = {
      id: 'customize-toolbar',
      label: 'Customize',
      ariaLabel: 'Customize toolbar',
      icon: 'settings',
      hideWhenSearching: true,
      action: vi.fn()
    } as QuickPanelFooterAction

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={vi.fn()}
          footerActions={[
            searchOnlyAction,
            {
              id: 'manage-global',
              label: 'Global',
              ariaLabel: 'Manage global prompts',
              icon: 'settings',
              action: vi.fn()
            }
          ]}
          inputAdapter={inputAdapter}
          items={[{ id: 'prompt', label: 'Daily summary', icon: 'prompt' }]}
          queryAnchor={0}
          trackInputQuery
          triggerInfo={{ type: 'button', position: 0 }}
        />
      </QuickPanelProvider>
    )

    expect(await screen.findByRole('button', { name: 'Customize toolbar' })).toBeInTheDocument()

    text = 'daily'
    act(() => listeners.forEach((listener) => listener({ cause: 'user-input' })))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Customize toolbar' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Manage global prompts' })).toBeInTheDocument()
  })

  it('keeps the measured empty state inside a collapsed read-only panel', async () => {
    const footerHeight = 30
    const emptyStateHeight = 48
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function heightFor(this: HTMLElement) {
        if (this.dataset.testid === 'quick-panel-footer') return footerHeight
        if (this.textContent === 'No results') return emptyStateHeight
        return 0
      })
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 8,
      getText: () => '/missing',
      insertText: vi.fn()
    }

    try {
      render(
        <QuickPanelProvider>
          <PanelHarness
            captureDispatch={vi.fn()}
            footerActions={[
              {
                id: 'manage-global',
                label: 'Global',
                ariaLabel: 'Manage global prompts',
                icon: 'settings',
                action: vi.fn()
              }
            ]}
            inputAdapter={inputAdapter}
            items={[{ id: 'prompt', label: 'Daily summary', icon: 'prompt' }]}
            readOnly
          />
        </QuickPanelProvider>
      )

      await screen.findByText('No results')
      await waitFor(() => {
        expect(screen.getByTestId('quick-panel')).toHaveStyle({
          maxHeight: `${footerHeight + emptyStateHeight}px`
        })
      })
    } finally {
      clientHeightSpy.mockRestore()
    }
  })

  it('uses the compact footer layout at its 620px boundary', async () => {
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function widthFor(this: HTMLElement) {
        return this.dataset.testid === 'quick-panel-footer' ? 620 : 0
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

  it('activates a focused footer action instead of the stale list selection', async () => {
    const footerAction = vi.fn()
    const rowAction = vi.fn()
    const captureDispatch = vi.fn()

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          footerActions={[
            {
              id: 'configure',
              label: 'Configure',
              ariaLabel: 'Configure tools',
              icon: 'settings',
              action: footerAction
            }
          ]}
          items={[{ id: 'result', label: 'Search result', icon: 'result', action: rowAction }]}
        />
      </QuickPanelProvider>
    )

    await screen.findByText('Search result')
    const actionButton = screen.getByRole('button', { name: 'Configure tools' })
    fireEvent.focus(actionButton)
    await waitFor(() => expect(actionButton).toHaveAttribute('aria-current', 'true'))

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
    let quickPanel: QuickPanelContextType | undefined
    const items: QuickPanelListItem[] = [
      { id: 'first', label: 'First action', icon: '1', action: vi.fn() },
      { id: 'second', label: 'Second action', icon: '2', action: vi.fn() }
    ]

    render(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (quickPanel = context)} />
        <PanelHarness captureDispatch={captureDispatch} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('First action')
    const firstRow = screen.getByText('First action').closest('[data-id="first"]')
    expect(firstRow).toHaveAttribute('data-active', 'true')

    fireEvent.mouseMove(screen.getByTestId('quick-panel-body'))

    await waitFor(() => {
      expect(firstRow).toHaveAttribute('data-active', 'false')
    })

    act(() => {
      quickPanel?.updateList([...items, { id: 'third', label: 'Third action', icon: '3', action: vi.fn() }])
    })

    await screen.findByText('Third action')
    expect(firstRow).toHaveAttribute('data-active', 'false')

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('ArrowDown').event)
    })

    await waitFor(() => {
      expect(firstRow).toHaveAttribute('data-active', 'true')
    })
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

    rerender(
      <QuickPanelProvider>
        <CaptureQuickPanel onCapture={(context) => (quickPanel = context)} />
        <PanelHarness captureDispatch={vi.fn()} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('First action')
    const visiblePanel = screen.getByTestId('quick-panel')
    expect(visiblePanel).not.toHaveAttribute('inert')

    fireEvent.mouseMove(screen.getByTestId('quick-panel-body'))

    act(() => {
      quickPanel?.close('esc')
    })

    expect(visiblePanel).toHaveAttribute('inert')
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
