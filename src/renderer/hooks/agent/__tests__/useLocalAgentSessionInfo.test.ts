import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { LocalAgentSessionInfo } from '@shared/ai/localAgent'

import { useLocalAgentSessionInfo } from '../useLocalAgentSessionInfo'

vi.unmock('@data/hooks/useCache')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn(), on: vi.fn() } }))

const first: LocalAgentSessionInfo = {
  models: [],
  images: true,
  resume: true,
  mode: {
    id: 'mode',
    currentValue: 'ask',
    options: [
      { value: 'ask', name: 'Ask' },
      { value: 'plan', name: 'Plan' }
    ]
  }
}
const next = { ...first, mode: { ...first.mode!, currentValue: 'plan' } }
let publish: (event: { sessionId: string; info: LocalAgentSessionInfo }) => void

beforeEach(() => {
  MockCacheUtils.resetMocks()
  vi.mocked(ipcApi.request).mockReset()
  vi.mocked(ipcApi.on).mockImplementation((_name, handler) => {
    publish = handler
    return () => {}
  })
})

describe('local agent session option cache', () => {
  it('immediately shows remembered options on remount but waits for a live connection before exposing capabilities', async () => {
    vi.mocked(ipcApi.request).mockResolvedValue(first)
    const initial = renderHook(() => useLocalAgentSessionInfo('one', true))
    await waitFor(() => expect(initial.result.current.info).toEqual(first))
    initial.unmount()
    vi.mocked(ipcApi.request).mockResolvedValue(null)
    const restored = renderHook(() => useLocalAgentSessionInfo('one', true))
    expect(restored.result.current.options?.mode).toEqual(first.mode)
    expect(restored.result.current.info).toBeNull()
    await act(async () => {})
    expect(restored.result.current.options?.mode).toEqual(first.mode)
    act(() => publish({ sessionId: 'one', info: next }))
    expect(restored.result.current.info).toEqual(next)
    expect(restored.result.current.options?.mode?.currentValue).toBe('plan')
  })

  it('isolates sessions and ignores reads and events belonging to the previous session', async () => {
    let finish!: (value: LocalAgentSessionInfo) => void
    vi.mocked(ipcApi.request).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    vi.mocked(ipcApi.request).mockResolvedValue(null)
    const view = renderHook(({ sessionId }) => useLocalAgentSessionInfo(sessionId, true), {
      initialProps: { sessionId: 'one' }
    })
    const previousPublish = publish
    view.rerender({ sessionId: 'two' })
    await act(async () => {
      finish(first)
      previousPublish({ sessionId: 'one', info: first })
    })
    expect(view.result.current.info).toBeNull()
    expect(view.result.current.options).toBeUndefined()
    act(() => publish({ sessionId: 'one', info: first }))
    expect(view.result.current.options).toBeUndefined()
    act(() => publish({ sessionId: 'two', info: next }))
    expect(view.result.current.options?.mode?.currentValue).toBe('plan')
  })

  it('does not let a late query overwrite a newer pushed configuration', async () => {
    let finish!: (value: LocalAgentSessionInfo | null) => void
    vi.mocked(ipcApi.request).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const view = renderHook(() => useLocalAgentSessionInfo('one', true))
    act(() => publish({ sessionId: 'one', info: next }))
    await act(async () => finish(first))
    expect(view.result.current.info?.mode?.currentValue).toBe('plan')
  })

  it('retains read-only options when reactivation fails and replaces options removed by the agent', async () => {
    vi.mocked(ipcApi.request).mockResolvedValue(first)
    const view = renderHook(({ enabled }) => useLocalAgentSessionInfo('one', enabled), {
      initialProps: { enabled: true }
    })
    await waitFor(() => expect(view.result.current.info).toEqual(first))
    view.rerender({ enabled: false })
    expect(view.result.current.info).toBeNull()
    vi.mocked(ipcApi.request).mockRejectedValue(new Error('Disconnected'))
    view.rerender({ enabled: true })
    await act(async () => {})
    expect(view.result.current.info).toBeNull()
    expect(view.result.current.options?.mode).toEqual(first.mode)
    act(() => publish({ sessionId: 'one', info: { models: [], images: false, resume: true } }))
    expect(view.result.current.options?.mode).toBeUndefined()
  })
})
