import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

const mocks = vi.hoisted(() => ({ request: vi.fn(), listeners: new Map<string, (effects: any[]) => void>() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@data/hooks/useDataChange', () => ({
  useDataChange: (endpoints: string | string[], listener: (effects: any[]) => void) => {
    for (const endpoint of Array.isArray(endpoints) ? endpoints : [endpoints]) mocks.listeners.set(endpoint, listener)
  }
}))
import { useAgentSessionForkAvailability } from '../useAgentSessionForkAvailability'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const message = (n: number): CherryUIMessage => ({
  id: id(n),
  role: 'assistant',
  metadata: { status: 'success' },
  parts: []
})
const reply = (ids: string[], availability: unknown = { enabled: true }) => ({
  items: ids.map((messageId) => ({ messageId, availability }))
})

beforeEach(() => {
  mocks.request.mockReset()
  mocks.listeners.clear()
})
afterEach(() => {
  vi.useRealTimers()
})
describe('useAgentSessionForkAvailability', () => {
  it.each([{ enabled: true }, { enabled: false, reason: 'legacy_history' }] as const)(
    'keeps the known decision during revalidation and replaces it on failure: %o',
    async (known) => {
      const pending = Promise.withResolvers<unknown>()
      mocks.request
        .mockResolvedValueOnce({ ...reply([id(1)], known), extra: true })
        .mockReturnValueOnce(pending.promise)
      const { result } = renderHook(() =>
        useAgentSessionForkAvailability({ sourceSessionId: 'a', messages: [message(1)], enabled: true })
      )
      await waitFor(() => expect(result.current.get(id(1))).toEqual(known))
      let revalidation: Promise<void>
      act(() => {
        revalidation = result.current.revalidate()
      })
      expect(result.current.get(id(1))).toEqual(known)
      expect(result.current.byMessageId.get(id(1))).toEqual(known)
      await act(async () => {
        pending.reject(new Error('offline'))
        await revalidation
      })
      expect(result.current.get(id(1))).toEqual({ enabled: null, reason: 'operation_failed' })
    }
  )
  it('exposes pending then confirmed decisions and probes only new persisted messages', async () => {
    const first = Promise.withResolvers<any>()
    mocks.request
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async (_route, input) => reply(input.messageIds))
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useAgentSessionForkAvailability({ sourceSessionId: 'a', agentId: 'agent', messages, enabled: true }),
      { initialProps: { messages: [message(1)] } }
    )
    expect(result.current.get(id(1))).toBeUndefined()
    await act(async () => first.resolve(reply([id(1)], { enabled: false, reason: 'legacy_history' })))
    expect(result.current.get(id(1))).toEqual({ enabled: false, reason: 'legacy_history' })
    rerender({ messages: [{ ...message(1), parts: [{ type: 'text', text: 'stream' }] }] })
    expect(mocks.request).toHaveBeenCalledTimes(1)
    rerender({
      messages: [
        { ...message(1), parts: [{ type: 'text', text: 'stream' }] },
        message(2),
        { ...message(3), id: 'temp' }
      ]
    })
    await waitFor(() => expect(result.current.get(id(2))).toEqual({ enabled: true }))
    expect(mocks.request.mock.calls.map(([, input]) => input.messageIds)).toEqual([[id(1)], [id(2)]])
  })
  it('recovers from failure and revalidates on notifications, focus and invalidation', async () => {
    mocks.request
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (_route, input) => reply(input.messageIds))
    const { result } = renderHook(() =>
      useAgentSessionForkAvailability({ sourceSessionId: 'a', agentId: 'agent', messages: [message(1)], enabled: true })
    )
    await waitFor(() => expect(result.current.get(id(1))).toEqual({ enabled: null, reason: 'operation_failed' }))
    await act(async () => result.current.revalidate())
    expect(result.current.get(id(1))).toEqual({ enabled: true })
    const count = mocks.request.mock.calls.length
    await act(async () => mocks.listeners.get('/agents/:agentId')?.([{ entityIds: ['other-agent'] }]))
    expect(mocks.request).toHaveBeenCalledTimes(count)
    for (const trigger of [
      () => mocks.listeners.get('/agent-sessions/:sessionId/messages')?.([{}]),
      () => mocks.listeners.get('/agents')?.([{ entityIds: ['agent'] }]),
      () => mocks.listeners.get('/agents/:agentId')?.([{ entityIds: ['agent'] }]),
      () => window.dispatchEvent(new Event('focus')),
      () => result.current.invalidate()
    ]) {
      const count = mocks.request.mock.calls.length
      await act(async () => trigger())
      await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(count + 1))
    }
  })
  it('isolates late session responses and batches at most 200 IDs', async () => {
    const old = Promise.withResolvers<any>()
    mocks.request.mockReturnValueOnce(old.promise).mockImplementation(async (_route, input) => reply(input.messageIds))
    const messages = Array.from({ length: 201 }, (_, n) => message(n + 1))
    const { result, rerender } = renderHook(
      ({ session }) => useAgentSessionForkAvailability({ sourceSessionId: session, messages, enabled: true }),
      { initialProps: { session: 'a' } }
    )
    rerender({ session: 'b' })
    await waitFor(() => expect(result.current.byMessageId.size).toBe(201))
    await act(async () =>
      old.resolve(
        reply(
          messages.slice(0, 200).map((m) => m.id),
          { enabled: false, reason: 'legacy_history' }
        )
      )
    )
    expect(result.current.get(id(1))).toEqual({ enabled: true })
    expect(mocks.request.mock.calls.every(([, input]) => input.messageIds.length <= 200)).toBe(true)
  })
  it('discards late responses after an agent change and unmount', async () => {
    const old = Promise.withResolvers<unknown>()
    const current = Promise.withResolvers<unknown>()
    mocks.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, rerender, unmount } = renderHook(
      ({ agentId }) =>
        useAgentSessionForkAvailability({ sourceSessionId: 'a', agentId, messages: [message(1)], enabled: true }),
      { initialProps: { agentId: 'one' } }
    )
    rerender({ agentId: 'two' })
    await act(async () => old.resolve(reply([id(1)], { enabled: false, reason: 'legacy_history' })))
    expect(result.current.get(id(1))).toBeUndefined()
    unmount()
    await act(async () => current.resolve(reply([id(1)])))
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })
  it('coalesces invalidations while a request is in flight and discards stale decisions', async () => {
    const first = Promise.withResolvers<unknown>()
    const second = Promise.withResolvers<unknown>()
    mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() =>
      useAgentSessionForkAvailability({ sourceSessionId: 'a', messages: [message(1)], enabled: true })
    )
    act(() => {
      result.current.invalidate()
      result.current.invalidate()
      result.current.invalidate()
    })
    await act(async () => first.resolve(reply([id(1)], { enabled: true })))
    expect(result.current.get(id(1))).toBeUndefined()
    expect(mocks.request).toHaveBeenCalledTimes(2)
    await act(async () => second.resolve(reply([id(1)], { enabled: false, reason: 'history_changed' })))
    expect(result.current.get(id(1))).toEqual({ enabled: false, reason: 'history_changed' })
  })
  it('treats missing, duplicate and invalid decisions as unknown', async () => {
    mocks.request.mockResolvedValue({
      items: [
        { messageId: id(1), availability: { enabled: true } },
        { messageId: id(1), availability: { enabled: true } },
        { messageId: id(2), availability: { enabled: false } }
      ]
    })
    const { result } = renderHook(() =>
      useAgentSessionForkAvailability({
        sourceSessionId: 'a',
        messages: [message(1), message(2), message(3)],
        enabled: true
      })
    )
    await waitFor(() => expect(result.current.byMessageId.size).toBe(3))
    for (const n of [1, 2, 3]) expect(result.current.get(id(n))).toEqual({ enabled: null, reason: 'operation_failed' })
  })
  it('turns a deadline into unknown and ignores completion after unmount', async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<any>()
    mocks.request.mockReturnValue(pending.promise)
    const { result, unmount } = renderHook(() =>
      useAgentSessionForkAvailability({ sourceSessionId: 'a', messages: [message(1)], enabled: true })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(result.current.get(id(1))).toEqual({ enabled: null, reason: 'operation_failed' })
    unmount()
    await act(async () => pending.resolve(reply([id(1)])))
  })
})
