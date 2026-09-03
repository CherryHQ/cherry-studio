import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LabSettings from '../LabSettings'

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingDivider: () => <hr />,
  SettingGroup: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  SettingRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingRowTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingsContentColumn: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  SettingTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('LabSettings', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('offers all navigation layouts and persists the selected layout', async () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.navigation.layout', 'both')
    render(<LabSettings />)

    expect(screen.getByTestId('segmented-control')).toHaveAttribute('data-value', 'both')
    expect(screen.getByRole('button', { name: 'settings.lab.navigation_layout.both' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.lab.navigation_layout.sidebar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.lab.navigation_layout.tabs' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'settings.lab.navigation_layout.sidebar' }))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('ui.navigation.layout')).toBe('sidebar')
    })
  })
})
