import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'

import { ComputerUseSettings } from '../ComputerUseSettings'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

function showSettings() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ComputerUseSettings />
    </SWRConfig>
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  MockUsePreferenceUtils.resetMocks()
  MockUsePreferenceUtils.setPreferenceValue('app.computer_use.approved_apps', [])
  MockUsePreferenceUtils.setPreferenceValue('app.computer_use.agent_control.enabled', true)
  await i18n.changeLanguage('en-us')
})
afterEach(cleanup)

describe('Computer Use permission settings', () => {
  it('defaults to enabled and lets the user explicitly disable desktop control', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockResolvedValue({ permissions: [] })
    showSettings()
    const toggle = screen.getByRole('switch', { name: 'Allow agents to control desktop applications' })
    expect(toggle).toBeChecked()
    expect(
      vi.mocked(ipcApi.request).mock.calls.every(([route]) => route === 'computer_use.get_permission_status')
    ).toBe(true)
    await waitFor(() => expect(toggle).toBeEnabled())
    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(MockUsePreferenceUtils.getPreferenceValue('app.computer_use.agent_control.enabled')).toBe(false)
  })
  it('revokes only the selected saved app through the main-process authority', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.computer_use.approved_apps', [
      'com.example.editor',
      'com.example.mail'
    ])
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'computer_use.revoke_approval') {
        const { identity } = input as { identity: string }
        const current = MockUsePreferenceUtils.getPreferenceValue('app.computer_use.approved_apps') as string[]
        MockUsePreferenceUtils.setPreferenceValue(
          'app.computer_use.approved_apps',
          current.filter((app) => app !== identity)
        )
        return undefined
      }
      return { permissions: [] }
    })
    showSettings()
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await waitFor(() => expect(screen.queryByText('com.example.editor')).not.toBeInTheDocument())
    expect(screen.getByText('com.example.mail')).toBeVisible()
  })

  it('requests only on a click, keeps an unconfirmed result, and refreshes after returning from settings', async () => {
    const user = userEvent.setup()
    let granted = false
    vi.mocked(ipcApi.request).mockImplementation(async () => ({
      permissions: [
        {
          id: 'accessibility',
          label: 'Accessibility',
          status: granted ? 'granted' : 'unknown',
          interaction: granted ? 'none' : 'systemSettings'
        }
      ]
    }))
    showSettings()
    const grant = await screen.findByRole('button', { name: 'Manage Accessibility permission' })
    expect(screen.getByText('Not confirmed')).toBeInTheDocument()
    expect(ipcApi.request).not.toHaveBeenCalledWith('computer_use.request_permissions', expect.anything())
    await user.click(grant)
    expect(ipcApi.request).toHaveBeenCalledWith('computer_use.request_permissions', { ids: ['accessibility'] })
    await waitFor(() => expect(grant).toBeEnabled())
    expect(screen.getByText('Not confirmed')).toBeInTheDocument()
    granted = true
    fireEvent.focus(window)
    expect(await screen.findByText('Granted')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage Accessibility permission' })).not.toBeInTheDocument()
  })

  it('shows a query failure and allows an explicit permission recheck to recover', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockRejectedValueOnce(new Error('runtime missing')).mockResolvedValue({ permissions: [] })
    showSettings()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check or request helper permissions')
    await user.click(screen.getByRole('button', { name: 'Recheck permissions' }))
    expect(await screen.findByText(/This runtime has no system permission request flow/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Granted')).not.toBeInTheDocument()
  })

  it('surfaces a failed request without retrying the system interaction', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'computer_use.request_permissions') throw new Error('cancelled')
      return {
        permissions: [
          { id: 'screenRecording', label: 'Screen Recording', status: 'unknown', interaction: 'systemSettings' }
        ]
      }
    })
    showSettings()
    await user.click(await screen.findByRole('button', { name: 'Manage Screen Recording permission' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.focus(window)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recheck permissions' })).toBeEnabled())
    expect(
      vi.mocked(ipcApi.request).mock.calls.filter(([route]) => route === 'computer_use.request_permissions')
    ).toHaveLength(1)
    expect(screen.getByText('Not confirmed')).toBeInTheDocument()
  })
})

describe('global input settings', () => {
  it('defaults off and saves an explicit opt-in', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockResolvedValue({ permissions: [] })
    showSettings()
    const toggle = screen.getByRole('switch', { name: 'Allow global pointer and keyboard input' })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.computer_use.global_input.enabled')).toBe(true)
    )
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toBeChecked()
  })

  it('keeps a stored opt-in checked while desktop control is off', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.computer_use.agent_control.enabled', false)
    MockUsePreferenceUtils.setPreferenceValue('app.computer_use.global_input.enabled', true)
    vi.mocked(ipcApi.request).mockResolvedValue({ permissions: [] })
    showSettings()
    const toggle = screen.getByRole('switch', { name: 'Allow global pointer and keyboard input' })
    expect(toggle).toBeDisabled()
    expect(toggle).toBeChecked()
    expect(MockUsePreferenceUtils.getPreferenceValue('app.computer_use.global_input.enabled')).toBe(true)
  })

  it('reports a global input save failure separately and preserves the stored value', async () => {
    vi.mocked(ipcApi.request).mockResolvedValue({ permissions: [] })
    const original = mockUsePreference.getMockImplementation()!
    MockUsePreferenceUtils.mockPreferenceError('app.computer_use.global_input.enabled', new Error('save failed'))
    try {
      showSettings()
      const toggle = screen.getByRole('switch', { name: 'Allow global pointer and keyboard input' })
      await userEvent.click(toggle)
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the global input setting.')
      expect(screen.queryByText('Could not save the desktop control setting.')).not.toBeInTheDocument()
      expect(toggle).not.toBeChecked()
      expect(MockUsePreferenceUtils.getPreferenceValue('app.computer_use.global_input.enabled')).toBe(false)
    } finally {
      mockUsePreference.mockImplementation(original)
    }
  })

  it('requests the translated portal permission and keeps unknown ids non-requestable', async () => {
    await i18n.changeLanguage('zh-cn')
    vi.mocked(ipcApi.request).mockResolvedValue({
      permissions: [
        { id: 'remoteDesktop', label: 'Remote Desktop portal', status: 'unknown', interaction: 'systemSettings' },
        { id: 'futurePermission', label: 'Future permission', status: 'unknown', interaction: 'systemSettings' }
      ]
    })
    showSettings()
    const label = i18n.t('settings.computerUse.remoteDesktop')
    const button = await screen.findByRole('button', {
      name: i18n.t('settings.computerUse.requestLabel', { permission: label })
    })
    expect(screen.getByText(label)).toBeVisible()
    expect(screen.getByTestId('computer-use-permission-futurePermission').querySelector('button')).toBeNull()
    await userEvent.click(button)
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('computer_use.request_permissions', { ids: ['remoteDesktop'] })
    )
  })
})
