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
})
