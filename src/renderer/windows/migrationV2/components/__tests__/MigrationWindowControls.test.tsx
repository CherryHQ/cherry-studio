import { MigrationIpcChannels } from '@shared/data/migration/v2/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'migration.window.minimize': 'Minimize',
        'migration.window.close': 'Close'
      })[key] ?? key
  })
}))

import { MigrationWindowControls } from '../MigrationWindowControls'

describe('MigrationWindowControls', () => {
  it('invokes the migration window control channels', () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { electron: { ipcRenderer: { invoke: typeof invoke } } }).electron = {
      ipcRenderer: { invoke }
    }

    render(<MigrationWindowControls />)

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.Minimize)
    expect(invoke).toHaveBeenCalledWith(MigrationIpcChannels.CloseWindow)
  })

  it('uses shared button and semantic hover styling', () => {
    render(<MigrationWindowControls />)

    const minimizeButton = screen.getByRole('button', { name: 'Minimize' })
    const closeButton = screen.getByRole('button', { name: 'Close' })

    expect(minimizeButton).toHaveAttribute('variant', 'ghost')
    expect(minimizeButton.className).toContain('hover:bg-accent')
    expect(minimizeButton.className).not.toContain('rgba')
    expect(closeButton).toHaveAttribute('variant', 'ghost')
    expect(closeButton.className).toContain('hover:bg-destructive')
    expect(closeButton.className).not.toContain('rgba')
  })
})
