import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'migration.diagnostics.actions.copy_email': 'Copy support email',
        'migration.diagnostics.actions.open_email': 'Open email client',
        'migration.diagnostics.actions.show_in_folder': 'Show in folder'
      })[key] ?? key
  })
}))

import { MigrationDiagnosticsSavedActions } from '../MigrationDiagnosticsSavedActions'

describe('MigrationDiagnosticsSavedActions', () => {
  it('renders exactly three controlled support actions and dispatches each callback', () => {
    const onOpenEmail = vi.fn()
    const onShowInFolder = vi.fn()
    const onCopyEmail = vi.fn()

    render(
      <MigrationDiagnosticsSavedActions
        onOpenEmail={onOpenEmail}
        onShowInFolder={onShowInFolder}
        onCopyEmail={onCopyEmail}
      />
    )

    expect(screen.getAllByRole('button')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Open email client' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy support email' }))

    expect(onOpenEmail).toHaveBeenCalledTimes(1)
    expect(onShowInFolder).toHaveBeenCalledTimes(1)
    expect(onCopyEmail).toHaveBeenCalledTimes(1)
  })

  it('disables all support actions and suppresses callbacks while one is pending', () => {
    const onOpenEmail = vi.fn()
    const onShowInFolder = vi.fn()
    const onCopyEmail = vi.fn()

    render(
      <MigrationDiagnosticsSavedActions
        disabled
        onOpenEmail={onOpenEmail}
        onShowInFolder={onShowInFolder}
        onCopyEmail={onCopyEmail}
      />
    )

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
      fireEvent.click(button)
    }
    expect(onOpenEmail).not.toHaveBeenCalled()
    expect(onShowInFolder).not.toHaveBeenCalled()
    expect(onCopyEmail).not.toHaveBeenCalled()
  })
})
