import { act, render, renderHook } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { requestConversationLocate, useConversationLocateRequest } from '../useConversationLocateRequest'

interface HarnessProps {
  activeConversationId?: string | null
  visibleConversationId?: string | null
  navigationTabId?: string
}

function renderLocateRequest(initialProps: HarnessProps = {}) {
  return renderHook(
    (props: HarnessProps) =>
      useConversationLocateRequest({
        ...props,
        activeConversationId: props.activeConversationId,
        visibleConversationId: props.visibleConversationId
      }),
    { initialProps }
  )
}

type LocateApi = ReturnType<typeof useConversationLocateRequest>

// Mirrors ChatContent / AgentChat: the consumer re-runs its locate effect whenever history
// state (`loadedPages`) moves, and child effects run before the parent hook's cleanup effect.
function LocateConsumer({
  conversationId,
  locateMessageId,
  loadedPages,
  onLoadOlder
}: {
  conversationId: string | null | undefined
  locateMessageId: string | undefined
  loadedPages: number
  onLoadOlder: (conversationId: string | null | undefined, messageId: string, loadedPages: number) => void
}) {
  useEffect(() => {
    if (!locateMessageId) return
    onLoadOlder(conversationId, locateMessageId, loadedPages)
  }, [conversationId, loadedPages, locateMessageId, onLoadOlder])
  return null
}

function LocateHarness({
  activeConversationId,
  visibleConversationId,
  loadedPages,
  onLoadOlder,
  apiRef
}: HarnessProps & {
  loadedPages: number
  onLoadOlder: (conversationId: string | null | undefined, messageId: string, loadedPages: number) => void
  apiRef: { current: LocateApi | null }
}) {
  const api = useConversationLocateRequest({ activeConversationId, visibleConversationId })
  apiRef.current = api
  return (
    <LocateConsumer
      conversationId={visibleConversationId}
      locateMessageId={api.locateMessageId}
      loadedPages={loadedPages}
      onLoadOlder={onLoadOlder}
    />
  )
}

describe('useConversationLocateRequest', () => {
  it('retains a tab navigation request through lazy mount and previous-session visibility', () => {
    requestConversationLocate('lazy-tab', 'A', 'result-message')
    const { result, rerender, unmount } = renderLocateRequest({
      navigationTabId: 'lazy-tab',
      activeConversationId: 'A',
      visibleConversationId: 'B'
    })
    expect(result.current.locateMessageId).toBeUndefined()
    rerender({ navigationTabId: 'lazy-tab', activeConversationId: 'A', visibleConversationId: 'A' })
    expect(result.current.locateMessageId).toBe('result-message')
    act(() => result.current.clearLocate())
    unmount()
    const remounted = renderLocateRequest({
      navigationTabId: 'lazy-tab',
      activeConversationId: 'A',
      visibleConversationId: 'A'
    })
    expect(remounted.result.current.locateMessageId).toBeUndefined()
  })

  it('represents an explicit end request without a synthetic message id and clears it after handling', () => {
    requestConversationLocate('end-tab', 'A', null)
    const { result } = renderLocateRequest({
      navigationTabId: 'end-tab',
      activeConversationId: 'A',
      visibleConversationId: 'A'
    })
    expect(result.current.locateMessageId).toBeUndefined()
    expect(result.current.locateToEnd).toBe(true)
    act(() => result.current.clearLocate())
    expect(result.current.locateToEnd).toBe(false)
  })

  it('does not replay navigation abandoned while the target history was loading', () => {
    requestConversationLocate('abandoned-tab', 'A', 'result-message')
    const { result, rerender } = renderLocateRequest({
      navigationTabId: 'abandoned-tab',
      activeConversationId: 'A',
      visibleConversationId: 'B'
    })
    rerender({ navigationTabId: 'abandoned-tab', activeConversationId: 'B', visibleConversationId: 'B' })
    rerender({ navigationTabId: 'abandoned-tab', activeConversationId: 'A', visibleConversationId: 'A' })
    expect(result.current.locateMessageId).toBeUndefined()
  })

  it('keeps the arriving navigation when invalidating a previous conversation request in the same commit', () => {
    const { result, rerender } = renderLocateRequest({
      navigationTabId: 'swapping-tab',
      activeConversationId: 'B',
      visibleConversationId: 'B'
    })
    act(() => result.current.requestLocate('B', 'previous-message'))
    act(() => requestConversationLocate('swapping-tab', 'A', 'result-message'))
    rerender({ navigationTabId: 'swapping-tab', activeConversationId: 'A', visibleConversationId: 'A' })
    expect(result.current.locateMessageId).toBe('result-message')
  })

  it('exposes a request only to its active visible conversation', () => {
    const { result } = renderLocateRequest({ activeConversationId: 'A', visibleConversationId: 'A' })

    act(() => result.current.requestLocate('A', 'm1'))

    expect(result.current.locateMessageId).toBe('m1')
  })

  it('invalidates a request after leaving its conversation', () => {
    const { result, rerender } = renderLocateRequest({ activeConversationId: 'A', visibleConversationId: 'A' })

    act(() => result.current.requestLocate('A', 'm1'))
    rerender({ activeConversationId: 'B', visibleConversationId: 'B' })
    expect(result.current.locateMessageId).toBeUndefined()

    rerender({ activeConversationId: 'A', visibleConversationId: 'A' })
    expect(result.current.locateMessageId).toBeUndefined()
  })

  it('withholds a request while a previous conversation remains visible', () => {
    const { result, rerender } = renderLocateRequest({ activeConversationId: 'A', visibleConversationId: 'B' })

    act(() => result.current.requestLocate('A', 'm1'))
    expect(result.current.locateMessageId).toBeUndefined()

    rerender({ activeConversationId: 'A', visibleConversationId: 'A' })
    expect(result.current.locateMessageId).toBe('m1')
  })

  it('clears a request explicitly', () => {
    const { result } = renderLocateRequest({ activeConversationId: 'A', visibleConversationId: 'A' })

    act(() => result.current.requestLocate('A', 'm1'))
    act(() => result.current.clearLocate())

    expect(result.current.locateMessageId).toBeUndefined()
  })

  it('never hands the still-visible previous conversation a request once the active one has moved on', () => {
    const onLoadOlder = vi.fn()
    const apiRef: { current: LocateApi | null } = { current: null }
    const { rerender } = render(
      <LocateHarness
        activeConversationId="A"
        visibleConversationId="A"
        loadedPages={1}
        onLoadOlder={onLoadOlder}
        apiRef={apiRef}
      />
    )

    act(() => apiRef.current?.requestLocate('A', 'm1'))
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
    expect(onLoadOlder).toHaveBeenLastCalledWith('A', 'm1', 1)

    // Route swapped to B while A is still visible and A's next page lands in the same commit.
    rerender(
      <LocateHarness
        activeConversationId="B"
        visibleConversationId="A"
        loadedPages={2}
        onLoadOlder={onLoadOlder}
        apiRef={apiRef}
      />
    )
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
    expect(apiRef.current?.locateMessageId).toBeUndefined()

    rerender(
      <LocateHarness
        activeConversationId="B"
        visibleConversationId="B"
        loadedPages={1}
        onLoadOlder={onLoadOlder}
        apiRef={apiRef}
      />
    )
    rerender(
      <LocateHarness
        activeConversationId="A"
        visibleConversationId="A"
        loadedPages={3}
        onLoadOlder={onLoadOlder}
        apiRef={apiRef}
      />
    )
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
    expect(apiRef.current?.locateMessageId).toBeUndefined()
  })
})
