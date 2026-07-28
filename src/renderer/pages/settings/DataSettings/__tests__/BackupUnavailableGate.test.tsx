import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { BACKUP_V1_ENABLED, BackupUnavailableGate } from '../BackupUnavailableGate'

describe('BackupUnavailableGate', () => {
  it('enables the retained v1 backup surfaces', () => {
    expect(BACKUP_V1_ENABLED).toBe(true)
  })

  it('passes the wrapped section through without a warning or inert wrapper', () => {
    render(
      <BackupUnavailableGate>
        <button type="button">backup</button>
      </BackupUnavailableGate>
    )

    const child = screen.getByRole('button', { name: 'backup' })

    expect(child).toBeInTheDocument()
    expect(screen.queryByText('settings.data.backup.v2_unavailable')).not.toBeInTheDocument()
    expect(child.parentElement).not.toHaveAttribute('inert')
  })
})
