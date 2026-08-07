import '@testing-library/jest-dom/vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ClearCachePopupModule from '../ClearCachePopup'

const { clearCacheShowMock, requestMock } = vi.hoisted(() => ({
  clearCacheShowMock: vi.fn(),
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
vi.mock('../ClearCachePopup', async (importOriginal) => {
  const actual = await importOriginal<typeof ClearCachePopupModule>()
  return { ...actual, default: { show: clearCacheShowMock } }
})

import BasicDataSettings from '../BasicDataSettings'

async function renderSettings() {
  render(<BasicDataSettings />)
  await waitFor(() => expect(requestMock).toHaveBeenCalledWith('app.get_info'))
  requestMock.mockClear()
}

describe('BasicDataSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
