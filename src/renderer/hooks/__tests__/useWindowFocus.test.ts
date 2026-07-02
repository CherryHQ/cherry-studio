// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))
// Capture the focus_changed subscriber so tests can drive events directly.
const ipcHandlers = new Map<string, (payload: unknown) => void>()

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))
vi.mock('@renderer/ipc/useIpcOn', () => ({
  useIpcOn: (channel: string, handler: (payload: unknown) => void) => {
    ipcHandlers.set(channel, handler)
  }
}))

import useWindowFocus from '../useWindowFocus'

beforeEach(() => {
  vi.clearAllMocks()
  ipcHandlers.clear()
  requestMock.mockResolvedValue(true)
})

describe('useWindowFocus', () => {
  it('seeds authoritative state from window.is_focused on mount', async () => {
    requestMock.mockResolvedValueOnce(false)

    const { result } = renderHook(() => useWindowFocus())

    expect(requestMock).toHaveBeenCalledWith('window.is_focused')
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('updates when a window.focus_changed event arrives', async () => {
    const { result } = renderHook(() => useWindowFocus())
    await waitFor(() => expect(result.current).toBe(true))

    act(() => ipcHandlers.get('window.focus_changed')?.(false))
    expect(result.current).toBe(false)

    act(() => ipcHandlers.get('window.focus_changed')?.(true))
    expect(result.current).toBe(true)
  })

  it('coerces a non-boolean event payload to a boolean', async () => {
    const { result } = renderHook(() => useWindowFocus())
    await waitFor(() => expect(result.current).toBe(true))

    act(() => ipcHandlers.get('window.focus_changed')?.(0 as unknown))
    expect(result.current).toBe(false)
  })
})
