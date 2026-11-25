import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('selection settings header', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.setPreferenceValue('feature.selection.enabled', false)
    MockUsePreferenceUtils.setPreferenceValue('feature.selection.action_items', [])
    MockUsePreferenceUtils.setPreferenceValue('feature.selection.action_window_opacity', 100)
  })

  it('keeps the grouped header while removing the empty preview area after enabling', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<SelectionAssistantSettings />)
    const toggle = screen.getByRole('switch', { name: 'selection.settings.enable.title' })
    const group = toggle.closest<HTMLElement>('[data-ui="ui.setting-group"]')!

    expect(within(group).getByTestId('selection-preview')).toBeInTheDocument()
    expect(within(group).getByRole('separator')).toBeInTheDocument()

    await user.click(toggle)
    await waitFor(() => expect(MockUsePreferenceUtils.getPreferenceValue('feature.selection.enabled')).toBe(true))
    rerender(<SelectionAssistantSettings />)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle.closest('[data-ui="ui.setting-group"]')).toBe(group)
    expect(within(group).queryByTestId('selection-preview')).not.toBeInTheDocument()
    expect(within(group).queryByRole('separator')).not.toBeInTheDocument()
    const triggerTitle = screen
      .getByText('selection.settings.toolbar.trigger_mode.title')
      .closest<HTMLElement>('[data-ui="ui.setting-row-title"]')!
    expect(within(triggerTitle).getAllByRole('img')).toHaveLength(1)

    await user.click(toggle)
    await waitFor(() => expect(MockUsePreferenceUtils.getPreferenceValue('feature.selection.enabled')).toBe(false))
    rerender(<SelectionAssistantSettings />)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(within(group).getByTestId('selection-preview')).toBeInTheDocument()
    expect(within(group).getByRole('separator')).toBeInTheDocument()
  })
})
