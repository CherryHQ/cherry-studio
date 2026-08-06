import '@testing-library/jest-dom/vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCacheSizeMock, requestMock } = vi.hoisted(() => ({
  getCacheSizeMock: vi.fn(),
  requestMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: requestMock }
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingDivider: () => <hr />,
  SettingGroup: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SettingHelpText: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SettingRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SettingRowTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SettingTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>
}))

vi.mock('../BackupPopup', () => ({ default: { show: vi.fn() } }))
vi.mock('../RestorePopup', () => ({ default: { show: vi.fn() } }))
vi.mock('../V1RemigrationPopup', () => ({ default: { show: vi.fn() } }))

import BasicDataSettings from '../BasicDataSettings'
import V1RemigrationPopup from '../V1RemigrationPopup'

async function renderSettings() {
  render(<BasicDataSettings />)
  await waitFor(() => expect(requestMock).toHaveBeenCalledWith('app.get_info'))
  requestMock.mockClear()
}

describe('BasicDataSettings', () => {
  beforeEach(() => {
    getCacheSizeMock.mockResolvedValue('0')
    requestMock.mockResolvedValue(undefined)
    vi.stubGlobal('api', { getCacheSize: getCacheSizeMock })
    localStorage.clear()
  })

  it('leaves backup and restore actions interactive', async () => {
    await renderSettings()

    expect(screen.getByText('settings.data.backup.skip_file_data_title')).toBeInTheDocument()

    for (const name of ['settings.general.backup.button', 'settings.general.restore.button']) {
      const action = screen.getByRole('button', { name })
      expect(action).toBeEnabled()
      expect(action.closest('[inert]')).toBeNull()
    }
  })

  it('hides the v1 remigration entry when the exact Redux key is absent', async () => {
    localStorage.setItem('persist:other-app', '{}')
    await renderSettings()

    expect(screen.queryByRole('button', { name: 'settings.data.v1_remigration.button' })).not.toBeInTheDocument()
  })

  it('shows the v1 remigration entry for the exact Redux key and opens its warning', async () => {
    localStorage.setItem('persist:cherry-studio', '{}')
    await renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'settings.data.v1_remigration.button' }))

    expect(V1RemigrationPopup.show).toHaveBeenCalledTimes(1)
  })

  it('does not send IPC when the renderer confirmation is cancelled', async () => {
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    await renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'settings.data.data_reset.button' }))

    await waitFor(() => expect(popup.confirm).toHaveBeenCalledOnce())
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('sends exactly the data-reset request after confirmation', async () => {
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    await renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'settings.data.data_reset.button' }))

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledExactlyOnceWith('app.data_reset.request')
    })
  })

  it('shows the localized error toast when the data-reset request rejects', async () => {
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    await renderSettings()
    requestMock.mockRejectedValueOnce(new Error('marker write failed'))

    fireEvent.click(screen.getByRole('button', { name: 'settings.data.data_reset.button' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledExactlyOnceWith('settings.data.data_reset.error')
    })
    expect(requestMock).toHaveBeenCalledExactlyOnceWith('app.data_reset.request')
  })
})
