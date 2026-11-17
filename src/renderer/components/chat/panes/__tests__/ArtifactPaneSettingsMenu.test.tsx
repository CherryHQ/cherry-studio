import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArtifactPaneSettingsMenu } from '../ArtifactPaneSettingsMenu'

vi.unmock('@cherrystudio/ui')

const wordWrapItem = async () => {
  await userEvent.click(screen.getByRole('button', { name: t('agent.preview_pane.settings.title') }))
  return screen.findByRole('menuitemcheckbox', { name: new RegExp(t('agent.preview_pane.settings.word_wrap')) })
}

describe('ArtifactPaneSettingsMenu', () => {
  afterEach(() => MockUsePreferenceUtils.resetMocks())

  it('greys out word wrap for a file too long to wrap and keeps the saved choice', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.agent.file_pane.word_wrap', true)
    render(<ArtifactPaneSettingsMenu wordWrapUnavailable />)

    const item = await wordWrapItem()
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAttribute('aria-checked', 'false')
    expect(item).toHaveTextContent(t('agent.preview_pane.settings.word_wrap_unavailable'))

    await userEvent.click(item)
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.agent.file_pane.word_wrap')).toBe(true)
  })

  it('toggles word wrap when the file can wrap', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.agent.file_pane.word_wrap', true)
    render(<ArtifactPaneSettingsMenu />)

    const item = await wordWrapItem()
    expect(item).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(item)
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.agent.file_pane.word_wrap')).toBe(false)
  })
})
