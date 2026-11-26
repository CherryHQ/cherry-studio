import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { LocalAgentSessionInfo, LocalAgentSessionView } from '@shared/ai/localAgent'

import { useLocalAgentSessionInfo } from '../useLocalAgentSessionInfo'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn(), on: vi.fn() } }))

const connection: LocalAgentSessionInfo = {
  models: [],
  images: true,
  resume: true,
  thoughtLevel: {
    id: 'reasoning',
    application: 'session',
    modelId: 'current-model',
    currentValue: 'high',
    options: [
      { value: 'low', name: 'Low' },
      { value: 'high', name: 'High' }
    ]
  }
}
const idle = {
  info: null,
  idleMode: { id: 'mode', currentValue: 'ask', application: 'reconnect', options: [] }
} as const
let publish: (event: { sessionId: string } & LocalAgentSessionView) => void

beforeEach(() => {
  vi.mocked(ipcApi.request).mockReset()
  vi.mocked(ipcApi.on).mockImplementation((_name, handler) => {
    publish = handler
    return () => {}
  })
})

describe('local agent session controls', () => {
  it('displays the runtime-declared idle mode before a connection exists', async () => {
    vi.mocked(ipcApi.request).mockResolvedValue({ ...idle, idleMode: { ...idle.idleMode, options: [] } })
    const { result } = renderHook(() => useLocalAgentSessionInfo('one', true))
    await waitFor(() => expect(result.current).toMatchObject(idle))
  })

  it('withdraws the controls when their connection closes and ignores an older read', async () => {
    const read = Promise.withResolvers<LocalAgentSessionView>()
    vi.mocked(ipcApi.request).mockReturnValue(read.promise)
    const { result } = renderHook(() => useLocalAgentSessionInfo('one', true))
    act(() => publish({ sessionId: 'one', info: connection }))
    expect(result.current?.info?.thoughtLevel?.modelId).toBe('current-model')

    act(() => publish({ sessionId: 'one', info: null }))
    await act(async () => read.resolve({ info: connection }))
    expect(result.current?.info).toBeNull()
  })

  it('never displays a prior session’s controls after switching', async () => {
    const first = Promise.withResolvers<LocalAgentSessionView>()
    vi.mocked(ipcApi.request).mockReturnValueOnce(first.promise).mockResolvedValue({ info: null })
    const { result, rerender } = renderHook(({ sessionId }) => useLocalAgentSessionInfo(sessionId, true), {
      initialProps: { sessionId: 'one' }
    })
    const oldListener = publish
    rerender({ sessionId: 'two' })
    await act(async () => {
      first.resolve({ info: connection })
      oldListener({ sessionId: 'one', info: connection })
    })
    expect(result.current).toEqual({ info: null })
  })
})
