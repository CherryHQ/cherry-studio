import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())
const ipcEventHandlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>())

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: requestMock },
  useIpcOn: vi.fn((event: string, handler: (payload: unknown) => void) => {
    ipcEventHandlers.set(event, handler)
  })
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))

import { useBinaryInstallStates } from '../useBinaryInstallStates'

describe('useBinaryInstallStates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcEventHandlers.clear()
  })

  it('hydrates from binary.get_install_states on mount', async () => {
    requestMock.mockResolvedValue({ fd: { status: 'installing' } })

    const { result } = renderHook(() => useBinaryInstallStates())

    expect(result.current).toEqual({})
    await waitFor(() => expect(result.current).toEqual({ fd: { status: 'installing' } }))
    expect(requestMock).toHaveBeenCalledWith('binary.get_install_states')
  })

  it('replaces the map wholesale on each broadcast', async () => {
    requestMock.mockResolvedValue({})
    const { result } = renderHook(() => useBinaryInstallStates())

    act(() => {
      ipcEventHandlers.get('binary.install_states_changed')?.({ fd: { status: 'failed', error: 'boom' } })
    })
    expect(result.current).toEqual({ fd: { status: 'failed', error: 'boom' } })

    act(() => {
      ipcEventHandlers.get('binary.install_states_changed')?.({})
    })
    expect(result.current).toEqual({})
  })

  it('ignores a late hydration snapshot once a broadcast has arrived', async () => {
    let resolveHydration!: (value: unknown) => void
    requestMock.mockReturnValue(
      new Promise((resolve) => {
        resolveHydration = resolve
      })
    )
    const { result } = renderHook(() => useBinaryInstallStates())

    act(() => {
      ipcEventHandlers.get('binary.install_states_changed')?.({ rg: { status: 'installing' } })
    })
    // Stale snapshot resolves after the broadcast — it must not win.
    await act(async () => {
      resolveHydration({ fd: { status: 'failed', error: 'stale' } })
    })

    expect(result.current).toEqual({ rg: { status: 'installing' } })
  })
})
