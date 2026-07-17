import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { BackupUnavailableGate } from '../BackupUnavailableGate'
import { LegacyLocalBackupGate } from '../LegacyLocalBackupGate'
import { V2BackupActionGate } from '../V2BackupActionGate'

describe('scoped backup gates', () => {
  it('V2BackupActionGate is a passthrough for migrated actions in DEV', () => {
    render(
      <V2BackupActionGate ready>
        <button type="button">v2-backup</button>
      </V2BackupActionGate>
    )
    const button = screen.getByRole('button', { name: 'v2-backup' })
    expect(button).toBeInTheDocument()
    expect(button.parentElement).not.toHaveAttribute('inert')
  })

  it('V2BackupActionGate is inert when packaged (non-DEV)', () => {
    render(
      <V2BackupActionGate ready={false}>
        <button type="button">v2-backup</button>
      </V2BackupActionGate>
    )
    expect(screen.getByText('settings.data.backup.v2_unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'v2-backup' }).parentElement).toHaveAttribute('inert')
  })

  it('LegacyLocalBackupGate keeps local v1 controls inert with distinct copy', () => {
    render(
      <LegacyLocalBackupGate>
        <button type="button">legacy</button>
      </LegacyLocalBackupGate>
    )
    expect(screen.getByText('settings.data.backup.legacy_local_unavailable')).toBeInTheDocument()
    const wrapper = screen.getByRole('button', { name: 'legacy' }).parentElement
    expect(wrapper).toHaveAttribute('inert')
  })

  it('BackupUnavailableGate still gates shared provider surfaces', () => {
    render(
      <BackupUnavailableGate>
        <button type="button">provider</button>
      </BackupUnavailableGate>
    )
    expect(screen.getByRole('button', { name: 'provider' }).parentElement).toHaveAttribute('inert')
  })
})
