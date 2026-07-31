// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useMainWindowNavigation: vi.fn(() => ({
    settingsPath: '/settings/about' as string | null,
    setSettingsPath: vi.fn(),
    closeSettings: vi.fn()
  }))
}))

vi.mock('@renderer/hooks/tab', () => ({
  useMainWindowNavigation: mocks.useMainWindowNavigation
}))

import { SettingsSurfaceProvider, useSettingsSurface } from '../SettingsSurfaceProvider'

function SettingsSurfaceConsumer() {
  const { settingsPath } = useSettingsSurface()

  return <output data-testid="settings-path">{settingsPath ?? 'closed'}</output>
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SettingsSurfaceProvider', () => {
  it('mounts the window navigation hook once and shares its Settings state', () => {
    render(
      <SettingsSurfaceProvider>
        <SettingsSurfaceConsumer />
        <SettingsSurfaceConsumer />
      </SettingsSurfaceProvider>
    )

    expect(mocks.useMainWindowNavigation).toHaveBeenCalledTimes(1)
    expect(screen.getAllByTestId('settings-path')).toHaveLength(2)
    for (const output of screen.getAllByTestId('settings-path')) {
      expect(output).toHaveTextContent('/settings/about')
    }
  })

  it('fails loudly when the Settings surface is read outside the provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => render(<SettingsSurfaceConsumer />)).toThrow(/SettingsSurfaceProvider/)

    consoleError.mockRestore()
  })
})
