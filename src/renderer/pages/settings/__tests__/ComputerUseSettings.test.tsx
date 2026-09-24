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
  await i18n.changeLanguage('en-us')
})
afterEach(cleanup)

describe('Computer Use permission settings', () => {
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

  it('shows a query failure and allows an explicit refresh to recover', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockRejectedValueOnce(new Error('runtime missing')).mockResolvedValue({ permissions: [] })
    showSettings()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check or request helper permissions')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled())
    expect(
      vi.mocked(ipcApi.request).mock.calls.filter(([route]) => route === 'computer_use.request_permissions')
    ).toHaveLength(1)
    expect(screen.getByText('Not confirmed')).toBeInTheDocument()
  })
})
