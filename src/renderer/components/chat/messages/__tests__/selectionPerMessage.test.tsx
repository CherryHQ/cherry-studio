import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessageSelectionStore } from '@renderer/components/chat/messages/selection/MessageSelectionStore'
// @vitest-environment jsdom
import type { MessageListProviderValue, MessageListSelectionState } from '@renderer/components/chat/messages/types'

import {
  MessageListProvider,
  useIsMessageSelected,
  useMessageListSelection,
  useMessageSelectionMode,
  useSelectedMessageIds
} from '../MessageListProvider'

function PerIdRow({ messageId }: { messageId: string }) {
  const selected = useIsMessageSelected(messageId)
  return <div data-testid={`row-${messageId}`}>{selected ? 'selected' : 'unselected'}</div>
}

function Toolbar() {
  const ids = useSelectedMessageIds()
  return <div data-testid="toolbar">{ids.length}</div>
}

function ModeProbe() {
  const mode = useMessageSelectionMode()
  return <div data-testid="mode">{mode?.isMultiSelectMode ? 'multi' : 'single'}</div>
}

function LegacyContextRow() {
  const selection = useMessageListSelection()
  return <div data-testid="legacy">{selection?.selectedMessageIds?.length ?? 0}</div>
}

function buildValue(selection: MessageListSelectionState, store: MessageSelectionStore): MessageListProviderValue {
  return {
    state: {
      topic: { id: 't1', name: 'Topic' } as MessageListProviderValue['state']['topic'],
      messages: [],
      partsByMessageId: {},
      renderConfig: {} as MessageListProviderValue['state']['renderConfig'],
      messageNavigation: 'none',
      estimateSize: 0,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      selection
    },
    actions: {},
    meta: {} as MessageListProviderValue['meta'],
    selectionStore: store
  }
}

function createSelectionSource() {
  let ids: readonly string[] = []
  const listeners = new Set<() => void>()
  const store = new MessageSelectionStore(
    () => ids,
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  )
  const replace = (next: readonly string[]) => {
    if (ids.length === next.length && ids.every((id, index) => id === next[index])) return
    ids = next
    for (const listener of listeners) listener()
  }
  return { store, replace }
}

describe('per-message selection subscriptions (#19209)', () => {
  it('re-renders only the row whose selection flipped; the context consumer still updates', () => {
    const { store, replace } = createSelectionSource()
    const view = render(
      <MessageListProvider
        value={buildValue({ enabled: true, isMultiSelectMode: true, selectedMessageIds: [] }, store)}>
        <PerIdRow messageId="a" />
        <PerIdRow messageId="b" />
        <Toolbar />
        <ModeProbe />
        <LegacyContextRow />
      </MessageListProvider>
    )

    expect(view.getByTestId('row-a').textContent).toBe('unselected')
    expect(view.getByTestId('row-b').textContent).toBe('unselected')

    const withA = { enabled: true, isMultiSelectMode: true, selectedMessageIds: ['a'] as readonly string[] }
    act(() => replace(['a']))
    view.rerender(
      <MessageListProvider value={buildValue(withA, store)}>
        <PerIdRow messageId="a" />
        <PerIdRow messageId="b" />
        <Toolbar />
        <ModeProbe />
        <LegacyContextRow />
      </MessageListProvider>
    )

    expect(view.getByTestId('row-a').textContent).toBe('selected')
    expect(view.getByTestId('row-b').textContent).toBe('unselected')
    expect(view.getByTestId('toolbar').textContent).toBe('1')
    expect(view.getByTestId('legacy').textContent).toBe('1')

    const both = { enabled: true, isMultiSelectMode: true, selectedMessageIds: ['a', 'b'] as readonly string[] }
    act(() => replace(['a', 'b']))
    view.rerender(
      <MessageListProvider value={buildValue(both, store)}>
        <PerIdRow messageId="a" />
        <PerIdRow messageId="b" />
        <Toolbar />
        <ModeProbe />
        <LegacyContextRow />
      </MessageListProvider>
    )
    expect(view.getByTestId('row-b').textContent).toBe('selected')

    const modeOff = { enabled: true, isMultiSelectMode: false, selectedMessageIds: ['a', 'b'] as readonly string[] }
    view.rerender(
      <MessageListProvider value={buildValue(modeOff, store)}>
        <PerIdRow messageId="a" />
        <PerIdRow messageId="b" />
        <Toolbar />
        <ModeProbe />
        <LegacyContextRow />
      </MessageListProvider>
    )
    expect(view.getByTestId('mode').textContent).toBe('single')
    expect(view.getByTestId('row-a').textContent).toBe('selected')
  })

  it('store notifies per-id listeners only for ids whose boolean flipped', () => {
    const { store, replace } = createSelectionSource()
    const aListener = vi.fn()
    const bListener = vi.fn()
    const listListener = vi.fn()
    store.subscribeId('a', aListener)
    store.subscribeId('b', bListener)
    store.subscribeList(listListener)

    replace(['a'])
    expect(aListener).toHaveBeenCalledTimes(1)
    expect(bListener).not.toHaveBeenCalled()
    expect(listListener).toHaveBeenCalledTimes(1)

    const before = store.getSnapshot()
    replace(['a'])
    expect(aListener).toHaveBeenCalledTimes(1)
    expect(listListener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toBe(before)

    replace(['a', 'b'])
    expect(aListener).toHaveBeenCalledTimes(1)
    expect(bListener).toHaveBeenCalledTimes(1)
    expect(listListener).toHaveBeenCalledTimes(2)

    replace([])
    expect(aListener).toHaveBeenCalledTimes(2)
    expect(bListener).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()).toEqual([])
  })

  it('reads the authoritative snapshot even before source notifications run', () => {
    let ids: readonly string[] = []
    const store = new MessageSelectionStore(
      () => ids,
      () => () => {}
    )
    ids = ['a']
    expect(store.isSelected('a')).toBe(true)
    expect(store.getSnapshot()).toBe(ids)
    ids = []
    expect(store.isSelected('a')).toBe(false)
  })

  it('unsubscribes cleanly', () => {
    const { store, replace } = createSelectionSource()
    const listener = vi.fn()
    const unsubscribe = store.subscribeId('a', listener)
    unsubscribe()
    replace(['a'])
    expect(listener).not.toHaveBeenCalled()
  })
})
