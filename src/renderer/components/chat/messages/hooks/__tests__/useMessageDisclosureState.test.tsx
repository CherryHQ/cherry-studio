import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  messageId: 'message-1' as string | undefined,
  states: new Map<string, Record<string, boolean>>(),
  listeners: new Map<string, Set<() => void>>(),
  update: vi.fn()
}))

vi.mock('../../blocks/MessagePartsContext', () => ({
  useMessagePartsScopeId: () => mocks.messageId
}))

vi.mock('@renderer/services/messageUiStateCache', () => ({
  getCachedMessageUiState: (messageId: string) => ({ disclosures: mocks.states.get(messageId) }),
  subscribeCachedMessageUiState: (messageId: string, listener: () => void) => {
    const listeners = mocks.listeners.get(messageId) ?? new Set()
    listeners.add(listener)
    mocks.listeners.set(messageId, listeners)
    return () => listeners.delete(listener)
  },
  updateCachedMessageUiState: mocks.update
}))

const { useMessageDisclosureState } = await import('../useMessageDisclosureState')

describe('useMessageDisclosureState', () => {
  beforeEach(() => {
    mocks.messageId = 'message-1'
    mocks.states.clear()
    mocks.listeners.clear()
    mocks.update.mockReset()
    mocks.update.mockImplementation(
      (messageId: string, update: (current: object) => { disclosures?: Record<string, boolean> }) => {
        const current = { disclosures: mocks.states.get(messageId) }
        const next = update(current)
        mocks.states.set(messageId, next.disclosures ?? {})
        for (const listener of mocks.listeners.get(messageId) ?? []) listener()
      }
    )
  })

  it('restores a disclosure state after its streamed subtree remounts', () => {
    const first = renderHook(() => useMessageDisclosureState('agent-tool:call-1'))
    expect(first.result.current[0]).toBe(false)

    act(() => first.result.current[1](true))
    expect(first.result.current[0]).toBe(true)
    expect(mocks.states.get('message-1')).toEqual({ 'agent-tool:call-1': true })

    first.unmount()
    const second = renderHook(() => useMessageDisclosureState('agent-tool:call-1'))
    expect(second.result.current[0]).toBe(true)

    act(() => second.result.current[1](false))
    second.unmount()

    const third = renderHook(() => useMessageDisclosureState('agent-tool:call-1'))
    expect(third.result.current[0]).toBe(false)
  })

  it('keeps disclosure state isolated by stable ID', () => {
    const first = renderHook(() => useMessageDisclosureState('tool-group:first'))
    act(() => first.result.current[1](true))
    first.unmount()

    const second = renderHook(() => useMessageDisclosureState('tool-group:second'))
    expect(second.result.current[0]).toBe(false)
  })

  it('reads and writes the new identity when disclosureId changes without remounting', () => {
    const { result, rerender } = renderHook(
      ({ disclosureId }: { disclosureId: string }) => useMessageDisclosureState(disclosureId),
      { initialProps: { disclosureId: 'tool-group:first' } }
    )
    act(() => result.current[1](true))

    rerender({ disclosureId: 'tool-group:second' })
    expect(result.current[0]).toBe(false)

    act(() => result.current[1]((current) => !current))
    expect(mocks.states.get('message-1')).toEqual({
      'tool-group:first': true,
      'tool-group:second': true
    })
  })

  it('reads and writes the new message identity without remounting', () => {
    mocks.states.set('message-1', { 'tool-group:first': true })
    const { result, rerender } = renderHook(() => useMessageDisclosureState('tool-group:first'))
    expect(result.current[0]).toBe(true)

    mocks.messageId = 'message-2'
    rerender()
    expect(result.current[0]).toBe(false)

    act(() => result.current[1](true))
    expect(mocks.states.get('message-1')).toEqual({ 'tool-group:first': true })
    expect(mocks.states.get('message-2')).toEqual({ 'tool-group:first': true })
  })
})
