import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Activity, type ReactNode, useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommandContextKeyProvider, CommandFocusScope, CommandProvider } from '@renderer/components/command'
import { TabIdProvider } from '@renderer/components/layout/TabIdProvider'
import { TabsContext, type TabsContextValue } from '@renderer/hooks/tab'
import { isMac } from '@renderer/utils/platform'

import { ResourceList } from '../base'
import { useConversationListShortcuts } from '../useConversationListShortcuts'

const items = [
  { id: 'pinned', name: 'Pinned conversation', group: 'pinned' },
  { id: 'recent', name: 'Recent conversation', group: 'recent' },
  { id: 'older', name: 'Older conversation', group: 'recent' }
]
const tabs: TabsContextValue = {
  tabs: [],
  activeTabId: 'chat',
  activeTab: undefined,
  isLoading: false,
  addTab: vi.fn(),
  closeTab: vi.fn(),
  closeTabs: vi.fn(),
  setActiveTab: vi.fn(),
  updateTab: vi.fn(),
  openTab: () => 'tab',
  pinTab: vi.fn(),
  unpinTab: vi.fn(),
  reorderTabs: vi.fn(),
  detachTab: vi.fn(),
  attachTab: vi.fn()
}
const modifier = isMac ? { metaKey: true } : { ctrlKey: true }
const modifierKey = isMac ? 'Meta' : 'Control'

function List({ name }: { name: string }) {
  const [selected, setSelected] = useState('none')
  const hints = useConversationListShortcuts((item) => setSelected(item.id))
  return (
    <>
      <output aria-label={name}>{selected}</output>
      {Array.from(hints, ([id, label]) => (
        <span key={id} aria-label={`hint-${id}`}>
          {label}
        </span>
      ))}
    </>
  )
}
function Page({
  name = 'chat',
  collapsed = [],
  listActive = true
}: {
  name?: string
  collapsed?: string[]
  listActive?: boolean
}) {
  const Provider = ResourceList.Provider<(typeof items)[number]>
  const rootRef = useRef<HTMLDivElement>(null)
  return (
    <CommandFocusScope rootRef={rootRef}>
      <div ref={rootRef}>
        <TabIdProvider tabId={name}>
          <Provider
            items={items}
            groupBy={(item) => ({ id: item.group, label: item.group })}
            collapsedState={collapsed}>
            <ResourceList.Frame active={listActive}>
              <List name={name} />
            </ResourceList.Frame>
          </Provider>
          <textarea aria-label={`${name} composer`} />
        </TabIdProvider>
      </div>
    </CommandFocusScope>
  )
}
function Root({ children, active = 'chat' }: { children: ReactNode; active?: string }) {
  return (
    <TabsContext value={{ ...tabs, activeTabId: active }}>
      <CommandContextKeyProvider>
        <CommandProvider>{children}</CommandProvider>
      </CommandContextKeyProvider>
    </TabsContext>
  )
}
function pressDigit(digit: string, page = 'chat') {
  const composer = screen.getByRole('textbox', { name: `${page} composer` })
  const event = new KeyboardEvent('keydown', {
    key: digit,
    code: `Digit${digit}`,
    ...modifier,
    bubbles: true,
    cancelable: true
  })
  act(() => {
    composer.focus()
    composer.dispatchEvent(event)
  })
  return event.defaultPrevented
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  mockPreferenceState.clear()
})

describe('conversation number shortcuts', () => {
  it.each(['chat', 'agent'])('switches %s conversations while its composer holds focus', (page) => {
    render(
      <Root active={page}>
        <Page name={page} />
      </Root>
    )
    expect(pressDigit('3', page)).toBe(true)
    expect(screen.getByLabelText(page)).toHaveTextContent('older')
    expect(screen.getByRole('textbox', { name: `${page} composer` })).toHaveFocus()
  })

  it('does not navigate a retained inactive list from the composer', () => {
    const tree = (active: boolean) => (
      <Root>
        <Page listActive={active} />
      </Root>
    )
    const view = render(tree(true))
    expect(pressDigit('1')).toBe(true)
    view.rerender(tree(false))
    expect(pressDigit('2')).toBe(false)
    expect(screen.getByLabelText('chat')).toHaveTextContent('pinned')
    view.rerender(tree(true))
    expect(pressDigit('2')).toBe(true)
    expect(screen.getByLabelText('chat')).toHaveTextContent('recent')
  })

  it('opens the visible position across pinned and recent groups, skipping collapsed groups and missing slots', () => {
    const view = render(
      <Root>
        <Page />
      </Root>
    )
    pressDigit('2')
    expect(screen.getByLabelText('chat')).toHaveTextContent('recent')
    pressDigit('9')
    expect(screen.getByLabelText('chat')).toHaveTextContent('recent')
    view.rerender(
      <Root>
        <Page collapsed={['pinned']} />
      </Root>
    )
    pressDigit('2')
    expect(screen.getByLabelText('chat')).toHaveTextContent('older')
  })

  it('moves ownership between active pages and unregisters when leaving the conversation page', () => {
    const content = (active: string) => (
      <Root active={active}>
        <Activity mode={active === 'chat' ? 'visible' : 'hidden'}>
          <Page />
        </Activity>
        <Activity mode={active === 'agent' ? 'visible' : 'hidden'}>
          <Page name="agent" />
        </Activity>
      </Root>
    )
    const view = render(content('chat'))
    pressDigit('1')
    expect(screen.getByLabelText('chat')).toHaveTextContent('pinned')
    view.rerender(content('agent'))
    pressDigit('2', 'agent')
    expect(screen.getByLabelText('agent')).toHaveTextContent('recent')
    view.rerender(content('chat'))
    expect(screen.getByLabelText('chat')).toHaveTextContent('pinned')
    view.rerender(content('settings'))
    const event = new KeyboardEvent('keydown', { key: '1', ...modifier, cancelable: true })
    fireEvent(window, event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('shows actual customized bindings after holding the modifier and clears on release or blur', async () => {
    mockPreferenceState.set('shortcut.app.sidebar.open_1', { binding: ['CommandOrControl', '7'], enabled: true })
    mockPreferenceState.set('shortcut.app.sidebar.open_2', { binding: ['CommandOrControl', '2'], enabled: false })
    vi.useFakeTimers()
    render(
      <Root>
        <Page />
      </Root>
    )
    fireEvent.keyDown(window, { key: modifierKey, ...modifier })
    await act(() => vi.advanceTimersByTime(499))
    expect(screen.queryByLabelText('hint-pinned')).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTime(1))
    expect(screen.getByLabelText('hint-pinned')).toHaveTextContent(isMac ? '⌘7' : 'Ctrl+7')
    expect(screen.queryByLabelText('hint-recent')).not.toBeInTheDocument()
    pressDigit('7')
    expect(screen.getByLabelText('chat')).toHaveTextContent('pinned')
    fireEvent.keyUp(window, { key: modifierKey })
    expect(screen.queryByLabelText('hint-pinned')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: modifierKey, ...modifier })
    await act(() => vi.advanceTimersByTime(500))
    fireEvent.blur(window)
    expect(screen.queryByLabelText('hint-pinned')).not.toBeInTheDocument()
  })
  it('uses the secondary modifier for conversation hints and selection after swapping modes', async () => {
    const secondary = isMac ? 'Ctrl' : 'Alt'
    mockPreferenceState.set('shortcut.app.sidebar.open_1', { binding: [secondary, '1'], enabled: true })
    vi.useFakeTimers()
    render(
      <Root>
        <Page />
      </Root>
    )
    const modifierState = isMac ? { ctrlKey: true } : { altKey: true }
    fireEvent.keyDown(window, { key: isMac ? 'Control' : 'Alt', ...modifierState })
    await act(() => vi.advanceTimersByTime(500))
    expect(screen.getByLabelText('hint-pinned')).toHaveTextContent(isMac ? '⌃1' : 'Alt+1')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'chat composer' }), {
      key: '1',
      code: 'Digit1',
      ...modifierState
    })
    expect(screen.getByLabelText('chat')).toHaveTextContent('pinned')
    fireEvent.keyUp(window, { key: isMac ? 'Control' : 'Alt' })
    expect(screen.queryByLabelText('hint-pinned')).not.toBeInTheDocument()
  })
})
