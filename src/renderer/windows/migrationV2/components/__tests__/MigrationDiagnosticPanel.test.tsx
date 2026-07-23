import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveDiagnostics: vi.fn(),
  showDiagnosticBundleInFolder: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

const translations: Record<string, string> = {
  'migration.diagnostics.contact': 'Contact us: support@cherry-ai.com',
  'migration.diagnostics.copy_failed': 'Copy failed',
  'migration.diagnostics.copy_success': 'Copied',
  'migration.diagnostics.logs_not_included':
    'Application logs could not be included. This diagnostic bundle contains only system information.',
  'migration.diagnostics.open_folder': 'Open file location',
  'migration.diagnostics.open_folder_failed': 'Could not open file location',
  'migration.diagnostics.privacy':
    'Application logs may contain file paths, error stacks, user content, or credentials. Do not share them publicly or with anyone outside the Cherry Studio support team.',
  'migration.diagnostics.save': 'Save diagnostic bundle',
  'migration.diagnostics.save_failed': 'Could not save diagnostic bundle',
  'migration.diagnostics.saved_local': 'The diagnostic bundle was saved locally and was not uploaded automatically.',
  'migration.diagnostics.saving': 'Saving…'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key
  })
}))

vi.mock('@renderer/components/ToastHost', () => {
  const React = require('react')
  return {
    default: () => React.createElement('div', { 'data-testid': 'toast-host' })
  }
})

vi.mock('@renderer/services/toast', () => ({
  toast: mocks.toast
}))

vi.mock('../../hooks/useMigrationProgress', () => ({
  useMigrationActions: () => ({
    saveDiagnostics: mocks.saveDiagnostics,
    showDiagnosticBundleInFolder: mocks.showDiagnosticBundleInFolder
  })
}))

import { MigrationDiagnosticPanel } from '../MigrationDiagnosticPanel'

async function saveBundle(logs: 'included' | 'not_included' = 'included') {
  mocks.saveDiagnostics.mockResolvedValueOnce({ status: 'saved', logs })
  render(<MigrationDiagnosticPanel />)
  fireEvent.click(screen.getByRole('button', { name: 'Save diagnostic bundle' }))
  await screen.findByText('The diagnostic bundle was saved locally and was not uploaded automatically.')
}

describe('MigrationDiagnosticPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mocks.saveDiagnostics.mockResolvedValue({ status: 'canceled' })
    mocks.showDiagnosticBundleInFolder.mockResolvedValue(true)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the exact private-log warning before save and owns the toast host', () => {
    render(<MigrationDiagnosticPanel />)

    expect(
      screen.getByText(
        'Application logs may contain file paths, error stacks, user content, or credentials. Do not share them publicly or with anyone outside the Cherry Studio support team.'
      )
    ).toBeInTheDocument()
    expect(screen.getByTestId('toast-host')).toBeInTheDocument()
  })

  it('keeps the failure-page local date when save happens after midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 23, 23, 59))
    render(<MigrationDiagnosticPanel />)

    vi.setSystemTime(new Date(2026, 6, 24, 0, 1))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save diagnostic bundle' }))
      await Promise.resolve()
    })

    expect(mocks.saveDiagnostics).toHaveBeenCalledWith('Save diagnostic bundle', '2026-07-23')
  })

  it('disables only the save action while saving and restores it after cancel', async () => {
    let resolveSave: (result: { status: 'canceled' }) => void = () => undefined
    mocks.saveDiagnostics.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve
      })
    )
    render(<MigrationDiagnosticPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Save diagnostic bundle' }))

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    await act(async () => resolveSave({ status: 'canceled' }))
    expect(screen.getByRole('button', { name: 'Save diagnostic bundle' })).toBeEnabled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it.each([
    ['failed result', () => Promise.resolve({ status: 'failed' as const })],
    ['IPC rejection', () => Promise.reject(new Error('save failed'))]
  ])('shows save failure feedback and keeps save reusable after a %s', async (_label, saveResult) => {
    mocks.saveDiagnostics.mockImplementationOnce(saveResult)
    render(<MigrationDiagnosticPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Save diagnostic bundle' }))

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Could not save diagnostic bundle'))
    expect(screen.getByRole('button', { name: 'Save diagnostic bundle' })).toBeEnabled()
  })

  it('shows only reveal and contact actions after saving with logs', async () => {
    await saveBundle()

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Open file location' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Contact us: support@cherry-ai.com' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save|retry|email/i })).not.toBeInTheDocument()
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull()
  })

  it('states that a metadata-only bundle is local, not uploaded, and contains only system information', async () => {
    await saveBundle('not_included')

    expect(
      screen.getByText(
        'Application logs could not be included. This diagnostic bundle contains only system information.'
      )
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('reveals the bundle through IPC', async () => {
    await saveBundle()

    fireEvent.click(screen.getByRole('button', { name: 'Open file location' }))

    await waitFor(() => expect(mocks.showDiagnosticBundleInFolder).toHaveBeenCalledOnce())
  })

  it.each([
    ['false', () => Promise.resolve(false)],
    ['a rejection', () => Promise.reject(new Error('reveal failed'))]
  ])('shows an error toast when reveal returns %s', async (_label, revealResult) => {
    mocks.showDiagnosticBundleInFolder.mockImplementationOnce(revealResult)
    await saveBundle()

    fireEvent.click(screen.getByRole('button', { name: 'Open file location' }))

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Could not open file location'))
  })

  it('copies the support address and shows a success toast', async () => {
    await saveBundle()

    fireEvent.click(screen.getByRole('button', { name: 'Contact us: support@cherry-ai.com' }))

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('support@cherry-ai.com'))
    expect(mocks.toast.success).toHaveBeenCalledWith('Copied')
  })

  it('shows an error toast when clipboard copy fails', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('copy failed'))
    await saveBundle()

    fireEvent.click(screen.getByRole('button', { name: 'Contact us: support@cherry-ai.com' }))

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Copy failed'))
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })
})
