import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SelectionFilterMode, SelectionTriggerMode } from '@shared/data/preference/preferenceTypes'

import SelectionAssistantSettings from '../SelectionAssistantSettings'

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@renderer/utils/platform', () => ({ isWin: true, isMac: false, isLinux: false }))
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))
vi.mock('@renderer/components/selection/SelectionToolbarView', () => ({
  default: () => <div data-testid="selection-preview" />
}))
vi.mock('../components/SelectionActionsList', () => ({ default: () => null }))
vi.mock('../components/MacProcessTrustHintModal', () => ({ default: () => null }))
vi.mock('../components/SelectionFilterListModal', () => ({ default: () => null }))

describe('selection settings preferences', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.setPreferenceValue('feature.selection.enabled', false)
    MockUsePreferenceUtils.setPreferenceValue('feature.selection.action_items', [])
    MockUsePreferenceUtils.setPreferenceValue('feature.selection.action_window_opacity', 100)
    MockUsePreferenceUtils.setPreferenceValue('feature.selection.trigger_mode', SelectionTriggerMode.Selected)
    MockUsePreferenceUtils.setPreferenceValue('feature.selection.filter_mode', SelectionFilterMode.Default)
  })

  it('persists enabling and disabling the selection assistant', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<SelectionAssistantSettings />)
    const toggle = screen.getByRole('switch', { name: 'selection.settings.enable.title' })
    await user.click(toggle)
    await waitFor(() => expect(MockUsePreferenceUtils.getPreferenceValue('feature.selection.enabled')).toBe(true))
    rerender(<SelectionAssistantSettings />)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await user.click(toggle)
    await waitFor(() => expect(MockUsePreferenceUtils.getPreferenceValue('feature.selection.enabled')).toBe(false))
    rerender(<SelectionAssistantSettings />)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it.each([
    ['ctrlkey', SelectionTriggerMode.Ctrlkey],
    ['shortcut', SelectionTriggerMode.Shortcut]
  ])('persists the %s trigger mode selected in the toolbar settings', async (label, mode) => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.selection.enabled', true)
    render(<SelectionAssistantSettings />)

    await user.click(screen.getByRole('radio', { name: `selection.settings.toolbar.trigger_mode.${label}` }))

    await waitFor(() => expect(MockUsePreferenceUtils.getPreferenceValue('feature.selection.trigger_mode')).toBe(mode))
  })

  it.each([
    ['whitelist', SelectionFilterMode.Whitelist],
    ['blacklist', SelectionFilterMode.Blacklist]
  ])('persists the %s program filter mode', async (label, mode) => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.selection.enabled', true)
    render(<SelectionAssistantSettings />)

    await user.click(screen.getByRole('radio', { name: `selection.settings.advanced.filter_mode.${label}` }))

    await waitFor(() => expect(MockUsePreferenceUtils.getPreferenceValue('feature.selection.filter_mode')).toBe(mode))
  })
})
