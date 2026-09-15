import { act, render, renderHook } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useConversationLocateRequest } from '../useConversationLocateRequest'

interface HarnessProps {
  activeConversationId?: string | null
  visibleConversationId?: string | null
}

function renderLocateRequest(initialProps: HarnessProps = {}) {
  return renderHook(
    ({ activeConversationId, visibleConversationId }: HarnessProps) =>
      useConversationLocateRequest({ activeConversationId, visibleConversationId }),
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
