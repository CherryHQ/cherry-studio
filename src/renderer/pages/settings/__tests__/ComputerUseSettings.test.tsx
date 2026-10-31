import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'

import { ComputerUseSettings } from '../ComputerUseSettings'

const environment = vi.hoisted(() => ({ isMac: true }))
vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return environment.isMac
  }
}))

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
  vi.mocked(ipcApi.request).mockReset()
  environment.isMac = true
  MockUsePreferenceUtils.resetMocks()
  await i18n.changeLanguage('en-us')
})
afterEach(cleanup)

describe('Computer Use permission settings', () => {
  it('requires an explicit desktop-control grant independently of OS permission status', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockImplementation(async (route) =>
      route === 'app.get_info' ? { isPackaged: false } : { permissions: [] }
    )
    showSettings()
    const toggle = screen.getByRole('switch', { name: 'Allow agents to control desktop applications' })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    expect(toggle).toBeChecked()
    expect(MockUsePreferenceUtils.getPreferenceValue('app.computer_use.agent_control.enabled')).toBe(true)
    expect(ipcApi.request).not.toHaveBeenCalledWith('computer_use.request_permissions', expect.anything())
    await waitFor(() => expect(toggle).toBeEnabled())
    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(MockUsePreferenceUtils.getPreferenceValue('app.computer_use.agent_control.enabled')).toBe(false)
  })
  it('requests only on a click, keeps an unconfirmed result, and refreshes after returning from settings', async () => {
    const user = userEvent.setup()
    let granted = false
    vi.mocked(ipcApi.request).mockImplementation(async (route) =>
      route === 'app.get_info'
        ? { isPackaged: false }
        : {
            permissions: [
              {
                id: 'accessibility',
                label: 'Accessibility',
                status: granted ? 'granted' : 'unknown',
                interaction: granted ? 'none' : 'systemSettings'
              }
            ]
          }
    )
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
    let failed = false
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'app.get_info') return { isPackaged: false }
      if (!failed) {
        failed = true
        throw new Error('runtime missing')
      }
      return { permissions: [] }
    })
    showSettings()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not check or request permissions. Please try again.'
    )
    await user.click(screen.getByRole('button', { name: 'Recheck permissions' }))
    expect(await screen.findByText(/This runtime has no system permission request flow/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Granted')).not.toBeInTheDocument()
  })

  it('surfaces a failed request without retrying the system interaction', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'app.get_info') return { isPackaged: false }
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

const screenRecordingHint =
  'Allow Cherry Studio in the screen recording settings under macOS System Settings → Privacy & Security. If it is missing, add Cherry Studio.app. Reopen the app if macOS asks, then recheck permissions.'

describe('Computer Use host screen recording guidance', () => {
  it.each([
    ['unknown', 'systemSettings'],
    ['notDetermined', 'systemPrompt'],
    ['denied', 'systemSettings']
  ])('shows host guidance for packaged macOS screen status %s', async (status, interaction) => {
    vi.mocked(ipcApi.request).mockImplementation(async (route) =>
      route === 'app.get_info'
        ? { isPackaged: true }
        : { permissions: [{ id: 'screenRecording', label: 'Screen Recording', status, interaction }] }
    )
    showSettings()
    expect(await screen.findByText(screenRecordingHint)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manage Screen Recording permission' })).toBeEnabled()
  })

  it.each([
    [true, false, 'screenRecording', 'unknown', 'systemSettings'],
    [false, true, 'screenRecording', 'unknown', 'systemSettings'],
    [true, true, 'accessibility', 'unknown', 'systemSettings'],
    [true, true, 'screenRecording', 'granted', 'none'],
    [true, true, 'screenRecording', 'unavailable', 'none'],
    [true, true, 'screenRecording', 'denied', 'none']
  ])('omits host guidance for mac=%s packaged=%s %s %s/%s', async (isMac, isPackaged, id, status, interaction) => {
    environment.isMac = isMac
    const appInfo = Promise.withResolvers<{ isPackaged: boolean }>()
    vi.mocked(ipcApi.request).mockImplementation(async (route) =>
      route === 'app.get_info' ? appInfo.promise : { permissions: [{ id, label: id, status, interaction }] }
    )
    showSettings()
    expect(await screen.findByText(id === 'accessibility' ? 'Accessibility' : 'Screen Recording')).toBeInTheDocument()
    expect(screen.queryByText(screenRecordingHint)).not.toBeInTheDocument()
    await act(async () => appInfo.resolve({ isPackaged }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recheck permissions' })).toBeEnabled())
    expect(screen.queryByText(screenRecordingHint)).not.toBeInTheDocument()
  })

  it('keeps permission rows usable without guidance when app info fails', async () => {
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'app.get_info') throw new Error('app info unavailable')
      return {
        permissions: [
          { id: 'screenRecording', label: 'Screen Recording', status: 'unknown', interaction: 'systemSettings' }
        ]
      }
    })
    showSettings()
    expect(await screen.findByRole('button', { name: 'Manage Screen Recording permission' })).toBeEnabled()
    expect(screen.getByText('Not confirmed')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(screenRecordingHint)).not.toBeInTheDocument()
  })
})
