import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { BackupUnavailableGate } from '../BackupUnavailableGate'

describe('BackupUnavailableGate', () => {
  it('renders the v2-unavailable notice above the wrapped section', () => {
    render(
      <BackupUnavailableGate>
        <button type="button">backup</button>
      </BackupUnavailableGate>
    )

    expect(screen.getByText('settings.data.backup.v2_unavailable')).toBeInTheDocument()
  })

  it('keeps children mounted but makes them inert and grayed out', () => {
    render(
      <BackupUnavailableGate>
        <button type="button">backup</button>
      </BackupUnavailableGate>
    )

    const child = screen.getByRole('button', { name: 'backup' })
    const wrapper = child.parentElement

    expect(child).toBeInTheDocument()
    expect(wrapper).toHaveAttribute('inert')
    expect(wrapper).toHaveClass('pointer-events-none', 'opacity-50')
  })
})
