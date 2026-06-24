import { MigrationIpcChannels } from '@shared/data/migration/v2/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isMac: false }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'migration.window.minimize': 'Minimize',
        'migration.window.close': 'Close'
      })[key] ?? key
  })
}))

vi.mock('@renderer/config/constant', () => ({
  get isMac() {
    return platformState.isMac
  }
}))

import { MigrationWindowControls } from '../MigrationWindowControls'

describe('MigrationWindowControls', () => {
  beforeEach(() => {
    platformState.isMac = false
  })

  it('renders custom controls and invokes the window control channels on Windows/Linux', () => {
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

  it('renders nothing on macOS, deferring to the native traffic lights', () => {
    platformState.isMac = true

    const { container } = render(<MigrationWindowControls />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: 'Minimize' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })
})
