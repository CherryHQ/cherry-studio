import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { TerminalSettingsMenu } from '../TerminalSettingsMenu'

vi.unmock('@cherrystudio/ui')

beforeEach(() => {
  MockUsePreferenceUtils.setPreferenceValue('feature.agent.terminal.cursor_style', 'block')
  MockUsePreferenceUtils.setPreferenceValue('feature.agent.terminal.cursor_blink', true)
})

afterEach(() => {
  cleanup()
  MockUsePreferenceUtils.resetMocks()
})

async function openStyles() {
  await userEvent.click(screen.getByRole('button', { name: t('terminal.settings.title') }))
  await userEvent.hover(screen.getByRole('menuitem', { name: new RegExp(t('terminal.settings.cursor_style')) }))
  return screen.findByRole('menuitemradio', { name: t('terminal.settings.bar') })
}

it('saves a cursor shape selected from the submenu and shows it again on remount', async () => {
  const first = render(<TerminalSettingsMenu />)
  await userEvent.click(await openStyles())
  expect(MockUsePreferenceUtils.getPreferenceValue('feature.agent.terminal.cursor_style')).toBe('bar')
  first.unmount()
  render(<TerminalSettingsMenu />)
  expect(await openStyles()).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('menuitemradio', { name: t('terminal.settings.block') })).toHaveAttribute(
    'aria-checked',
    'false'
  )
})

it('saves the blink switch and shows its saved state on remount', async () => {
  const first = render(<TerminalSettingsMenu />)
  await userEvent.click(screen.getByRole('button', { name: t('terminal.settings.title') }))
  const blink = screen.getByRole('menuitemcheckbox', { name: t('terminal.settings.cursor_blink') })
  expect(blink).toHaveAttribute('aria-checked', 'true')
  await userEvent.click(blink)
  expect(MockUsePreferenceUtils.getPreferenceValue('feature.agent.terminal.cursor_blink')).toBe(false)
  first.unmount()
  render(<TerminalSettingsMenu />)
  await userEvent.click(screen.getByRole('button', { name: t('terminal.settings.title') }))
  expect(screen.getByRole('menuitemcheckbox', { name: t('terminal.settings.cursor_blink') })).toHaveAttribute(
    'aria-checked',
    'false'
  )
})
