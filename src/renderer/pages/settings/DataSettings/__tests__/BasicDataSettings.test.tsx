import '@testing-library/jest-dom/vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
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

import BasicDataSettings from '../BasicDataSettings'

async function renderSettings() {
  render(<BasicDataSettings />)
  await waitFor(() => expect(requestMock).toHaveBeenCalledWith('app.get_info'))
  requestMock.mockClear()
}

describe('BasicDataSettings', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.conversation_greeting.enabled', false)
    getCacheSizeMock.mockResolvedValue('0')
    requestMock.mockResolvedValue(undefined)
    vi.stubGlobal('api', { getCacheSize: getCacheSizeMock })
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

  it('discloses contextual greeting data sharing and requires an explicit opt-in', async () => {
    await renderSettings()

    expect(screen.getByText('settings.privacy.contextual_greetings.description')).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'settings.privacy.contextual_greetings.title' })
    expect(toggle).not.toBeChecked()

    fireEvent.click(toggle)

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.conversation_greeting.enabled')).toBe(true)
    })
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
