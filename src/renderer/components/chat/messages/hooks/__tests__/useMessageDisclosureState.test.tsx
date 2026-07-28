import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  messageId: 'message-1' as string | undefined,
  states: new Map<string, boolean>(),
  get: vi.fn(),
  set: vi.fn()
}))

vi.mock('../../blocks/MessagePartsContext', () => ({
  useMessagePartsScopeId: () => mocks.messageId
}))

vi.mock('@renderer/services/MessageDisclosureStateService', () => ({
  messageDisclosureStateService: {
    get: mocks.get,
    set: mocks.set
  }
}))

const { useMessageDisclosureState } = await import('../useMessageDisclosureState')

describe('useMessageDisclosureState', () => {
  beforeEach(() => {
    mocks.messageId = 'message-1'
    mocks.states.clear()
    mocks.get.mockReset()
    mocks.set.mockReset()
    mocks.get.mockImplementation((messageId: string, disclosureId: string) => {
      return mocks.states.get(JSON.stringify([messageId, disclosureId]))
    })
    mocks.set.mockImplementation((messageId: string, disclosureId: string, expanded: boolean) => {
      mocks.states.set(JSON.stringify([messageId, disclosureId]), expanded)
    })
  })

  it('restores a disclosure state after its streamed subtree remounts', () => {
    const first = renderHook(() => useMessageDisclosureState('agent-tool:call-1'))
    expect(first.result.current[0]).toBe(false)

    act(() => first.result.current[1](true))
    expect(first.result.current[0]).toBe(true)
    expect(mocks.set).toHaveBeenCalledWith('message-1', 'agent-tool:call-1', true)

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
})
