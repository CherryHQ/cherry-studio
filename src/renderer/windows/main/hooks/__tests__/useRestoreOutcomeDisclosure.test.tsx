import { renderHook, waitFor } from '@testing-library/react'
import { type ReactNode, StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock, showMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  showMock: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: requestMock }
}))

vi.mock('@renderer/pages/settings/DataSettings/RestoreV2Popup', () => ({
  default: { show: showMock }
}))

const StrictModeWrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>

async function renderDisclosureHook() {
  const { useRestoreOutcomeDisclosure } = await import('../useRestoreOutcomeDisclosure')
  return renderHook(() => useRestoreOutcomeDisclosure(), { wrapper: StrictModeWrapper })
}

describe('useRestoreOutcomeDisclosure', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    showMock.mockResolvedValue({})
  })

  it('opens the restore popup once for a terminal outcome under StrictMode', async () => {
    requestMock.mockResolvedValue({ state: 'failed', reason: 'disk full' })

    await renderDisclosureHook()

    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1))
    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(requestMock).toHaveBeenCalledWith('backup.restore_status')
  })

  it('opens the restore popup once for a pending restore with a persisted summary', async () => {
    requestMock.mockResolvedValue({
      state: 'pending',
      summary: { toRestore: [{ kind: 'file', count: 1 }], toSkip: [] }
    })

    await renderDisclosureHook()

    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1))
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('does not open the restore popup when no journal exists', async () => {
    requestMock.mockResolvedValue({ state: 'none' })

    await renderDisclosureHook()

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1))
    expect(showMock).not.toHaveBeenCalled()
  })
})
