import { mockUsePreference } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'

import ObsidianSettings from '../ObsidianSettings'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))
const defaultPreferenceImplementation = mockUsePreference.getMockImplementation()
const stableSetVault = vi.fn(async () => {})

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: requestMock }
}))

function installVaultPreference(setVault: (vaultName: string) => Promise<void> = stableSetVault) {
  mockUsePreference.mockImplementation((key, options) => {
    const [value] = defaultPreferenceImplementation!(key, options)
    return [value, key === 'data.integration.obsidian.default_vault' ? setVault : stableSetVault]
  })
}

describe('ObsidianSettings', () => {
  let previousLanguage = i18n.language

  beforeEach(async () => {
    previousLanguage = i18n.language
    await i18n.changeLanguage('en-US')
    vi.clearAllMocks()
    stableSetVault.mockResolvedValue(undefined)
    installVaultPreference()
    requestMock.mockResolvedValue([])
  })

  afterEach(async () => {
    if (defaultPreferenceImplementation) mockUsePreference.mockImplementation(defaultPreferenceImplementation)
    await i18n.changeLanguage(previousLanguage)
  })

  it('shows fetch details when listing vaults fails and keeps an empty list distinct', async () => {
    const failure = new Error('socket down')
    requestMock.mockRejectedValueOnce(failure)
    const failed = render(<ObsidianSettings />)

    expect(await screen.findByText('Failed to fetch Obsidian vault')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument()
    expect(screen.queryByText('socket down')).not.toBeInTheDocument()
    expect(screen.queryByText('No Obsidian vaults found')).not.toBeInTheDocument()

    failed.unmount()
    requestMock.mockResolvedValueOnce([])
    render(<ObsidianSettings />)

    expect(await screen.findByText('No Obsidian vaults found')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Details' })).not.toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch Obsidian vault')).not.toBeInTheDocument()
  })

  it('reports a preference write failure without losing the thrown cause', async () => {
    const failure = new Error('disk denied')
    requestMock.mockResolvedValue([{ path: '/vaults/work', name: 'Work' }])
    installVaultPreference(async () => {
      throw failure
    })

    render(<ObsidianSettings />)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Save failed',
          cause: failure,
          data: expect.objectContaining({
            localizedErrorMessage: 'Save failed',
            errorContext: expect.objectContaining({
              message: 'disk denied',
              source: 'settings.obsidian',
              operation: 'obsidian.vault.save',
              recordId: 'Work'
            })
          })
        })
      )
    )
    expect(screen.queryByText('disk denied')).not.toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch Obsidian vault')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument()
  })
})
