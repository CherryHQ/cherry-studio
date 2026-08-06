// @vitest-environment jsdom

import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: {
    checking: false,
    downloading: false,
    downloaded: false,
    info: null
  },
  update: vi.fn(),
  request: vi.fn(),
  showUpdate: vi.fn(),
  t: vi.fn((key: string) => key)
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@renderer/hooks/useAppUpdateState', () => ({
  useAppUpdateState: () => ({ appUpdateState: mocks.state, updateAppUpdateState: mocks.update })
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }))
vi.mock('@renderer/components/UpdateDialogPopup', () => ({ default: { show: mocks.showUpdate } }))

import { useManualUpdateCheck } from '../useManualUpdateCheck'

describe('useManualUpdateCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(new Date('2026-07-28T12:00:00Z'))
    Object.assign(mocks.state, {
      checking: false,
      downloading: false,
      downloaded: false,
      info: null
    })
  })

  it('marks a manual check and uses the existing updater route', async () => {
    vi.mocked(ipcApi.request).mockResolvedValue(undefined)
    const { result } = renderHook(() => useManualUpdateCheck())

    await act(() => result.current.checkForUpdates())

    expect(mocks.update).toHaveBeenNthCalledWith(1, { checking: true, manualCheck: true })
    expect(ipcApi.request).toHaveBeenCalledWith('app.updater.check_for_update')
    expect(mocks.update).toHaveBeenLastCalledWith({ checking: false })
  })

  it('does not start another check while checking or downloading', async () => {
    mocks.state.checking = true
    const { result, rerender } = renderHook(() => useManualUpdateCheck())

    await act(() => result.current.checkForUpdates())
    mocks.state.checking = false
    mocks.state.downloading = true
    rerender()
    vi.setSystemTime(new Date('2026-07-28T12:00:03Z'))
    await act(() => result.current.checkForUpdates())

    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it('opens an already-downloaded update without requesting another check', async () => {
    mocks.state.downloaded = true
    mocks.state.info = { version: '2.1.0' } as never
    const { result } = renderHook(() => useManualUpdateCheck())

    await act(() => result.current.checkForUpdates())

    expect(mocks.showUpdate).toHaveBeenCalledWith({ releaseInfo: mocks.state.info })
    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it('clears manual state and reports an IPC failure', async () => {
    vi.mocked(ipcApi.request).mockRejectedValue(new Error('IPC unavailable'))
    const { result } = renderHook(() => useManualUpdateCheck())

    await act(() => result.current.checkForUpdates())

    expect(mocks.update).toHaveBeenCalledWith({ manualCheck: false })
    expect(toast.error).toHaveBeenCalledWith('settings.about.updateError')
    expect(mocks.update).toHaveBeenLastCalledWith({ checking: false })
  })
})
