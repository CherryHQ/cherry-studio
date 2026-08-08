import '@testing-library/jest-dom/vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ClearCachePopupModule from '../ClearCachePopup'

const { clearCacheShowMock, indexedDbDatabasesMock, requestMock } = vi.hoisted(() => ({
  clearCacheShowMock: vi.fn(),
  indexedDbDatabasesMock: vi.fn(),
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
vi.mock('../ClearCachePopup', async (importOriginal) => {
  const actual = await importOriginal<typeof ClearCachePopupModule>()
  return { ...actual, default: { show: clearCacheShowMock } }
})

import BasicDataSettings from '../BasicDataSettings'
import V1RemigrationPopup from '../V1RemigrationPopup'

async function renderSettings() {
  render(<BasicDataSettings />)
  await waitFor(() => expect(requestMock).toHaveBeenCalledWith('app.get_info'))
  requestMock.mockClear()
}

describe('BasicDataSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    indexedDbDatabasesMock.mockResolvedValue([])
    vi.stubGlobal('indexedDB', { databases: indexedDbDatabasesMock })
    localStorage.clear()
    requestMock.mockImplementation((route: string) =>
      Promise.resolve(
        route === 'app.cache_cleanup.inspect'
          ? {
              results: [
                {
                  group: 'normal_cache',
                  size: { bytes: 0, accuracy: 'estimated', completeness: 'complete' }
                }
              ]
            }
          : undefined
      )
    )
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

  it('hides the v1 remigration entry when neither exact v1 source exists', async () => {
    localStorage.setItem('persist:other-app', '{}')
    indexedDbDatabasesMock.mockResolvedValueOnce([{ name: 'cherrystudio', version: 1 }])
    await renderSettings()

    await waitFor(() => expect(indexedDbDatabasesMock).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: 'settings.data.v1_remigration.button' })).not.toBeInTheDocument()
  })

  it('shows the v1 remigration entry for the exact Redux key and opens its warning', async () => {
    localStorage.setItem('persist:cherry-studio', '{}')
    await renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'settings.data.v1_remigration.button' }))

    expect(V1RemigrationPopup.show).toHaveBeenCalledTimes(1)
  })

  it('shows the v1 remigration entry for the exact IndexedDB database name', async () => {
    indexedDbDatabasesMock.mockResolvedValueOnce([
      { name: 'other-database', version: 1 },
      { name: 'CherryStudio', version: 29 }
    ])
    await renderSettings()

    expect(await screen.findByRole('button', { name: 'settings.data.v1_remigration.button' })).toBeInTheDocument()
  })

  it('continues non-v1 cleanup when the legacy retry marker cannot be written', async () => {
    await renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'settings.data.clear_cache.button' }))
    await waitFor(() => expect(clearCacheShowMock).toHaveBeenCalledOnce())
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })
    requestMock.mockResolvedValueOnce({
      results: [{ group: 'normal_cache', status: 'cleared' }]
    })
    const onClear = clearCacheShowMock.mock.calls[0][0].onClear as (
      groups: Array<'normal_cache' | 'legacy_v1'>
    ) => Promise<boolean>

    let succeeded: boolean | undefined
    await act(async () => {
      succeeded = await onClear(['normal_cache', 'legacy_v1'])
    })

    expect(succeeded).toBe(false)
    expect(requestMock).toHaveBeenCalledWith('app.cache_cleanup.run', { groups: ['normal_cache'] })
    expect(toast.warning).toHaveBeenCalledWith('settings.data.clear_cache.partial_success')
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
