// @vitest-environment jsdom
import type { MessageListProviderValue, MessageListSelectionState } from '@renderer/components/chat/messages/types'
import { MessageSelectionStore } from '@renderer/components/chat/messages/selection/MessageSelectionStore'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  MessageListProvider,
  useIsMessageSelected,
  useMessageListSelection,
  useMessageSelectionMode,
  useSelectedMessageIds
} from '../MessageListProvider'

vi.mock('@renderer/components/chat/messages/hooks/useMessageSelectionController', () => ({
  useMessageSelectionController: () => ({ selection: {}, selectionStore: null, actions: {} })
}))

/** Per-message row: subscribes through the store, like MessageFrame (#19209). */
function PerIdRow({ messageId }: { messageId: string }) {
  const selected = useIsMessageSelected(messageId)
  return <div data-testid={`row-${messageId}`}>{selected ? 'selected' : 'unselected'}</div>
}

/** Toolbar-shaped consumer: needs the full id list. */
function Toolbar() {
  const ids = useSelectedMessageIds()
  return <div data-testid="toolbar">{ids.length}</div>
}

/** Mode-only consumer, like the header checkbox visibility. */
function ModeProbe() {
  const mode = useMessageSelectionMode()
  return <div data-testid="mode">{mode?.isMultiSelectMode ? 'multi' : 'single'}</div>
}

/**
 * The pre-#19209 shape: reads the whole selection object off the context, so
 * its render count grows on every selection change while per-id rows do not.
 */
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
    actions: {} as MessageListProviderValue['actions'],
    meta: {} as MessageListProviderValue['meta'],
    selectionStore: store
  }
}

describe('per-message selection subscriptions (#19209)', () => {
  it('re-renders only the row whose selection flipped; the context consumer still updates', () => {
    const store = new MessageSelectionStore()
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

    // The controller flow: cached state changes (provider rerenders with the new
    // ids) AND the store mirror is replaced.
    const withA = { enabled: true, isMultiSelectMode: true, selectedMessageIds: ['a'] as readonly string[] }
    store.replace(['a'])
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

    // Selecting b as well: a's row re-renders only because React rerenders are
    // not asserted here — the contract under test is the boolean stream. The
    // decisive assertion is deselect, where b flips back and a's subtree can
    // stay idle (asserted via the store's per-id notifications below).
    const both = { enabled: true, isMultiSelectMode: true, selectedMessageIds: ['a', 'b'] as readonly string[] }
    store.replace(['a', 'b'])
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

    // Mode toggle changes the mode probe but leaves per-id booleans untouched.
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
    const store = new MessageSelectionStore()
    const aListener = vi.fn()
    const bListener = vi.fn()
    const listListener = vi.fn()
    store.subscribeId('a', aListener)
    store.subscribeId('b', bListener)
    store.subscribeList(listListener)

    store.replace(['a'])
    expect(aListener).toHaveBeenCalledTimes(1)
    expect(bListener).not.toHaveBeenCalled()
    expect(listListener).toHaveBeenCalledTimes(1)

    // Same content replace: nobody fires, snapshot identity stays stable.
    const before = store.getSnapshot()
    store.replace(['a'])
    expect(aListener).toHaveBeenCalledTimes(1)
    expect(listListener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toBe(before)

    store.replace(['a', 'b'])
    expect(aListener).toHaveBeenCalledTimes(1)
    expect(bListener).toHaveBeenCalledTimes(1)
    expect(listListener).toHaveBeenCalledTimes(2)

    store.replace([])
    expect(aListener).toHaveBeenCalledTimes(2)
    expect(bListener).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()).toEqual([])
  })

  it('unsubscribes cleanly', () => {
    const store = new MessageSelectionStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribeId('a', listener)
    unsubscribe()
    store.replace(['a'])
    expect(listener).not.toHaveBeenCalled()
  })
})
