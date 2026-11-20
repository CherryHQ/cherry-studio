import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TerminalContextMenu, TerminalDropdownMenu } from '../TerminalContextMenu'

vi.unmock('@cherrystudio/ui')

beforeEach(() => {
  MockUsePreferenceUtils.setPreferenceValue('feature.agent.terminal.cursor_style', 'block')
  MockUsePreferenceUtils.setPreferenceValue('feature.agent.terminal.cursor_blink', true)
})

afterEach(() => {
  cleanup()
  MockUsePreferenceUtils.resetMocks()
})

describe.each(['context', 'dropdown'] as const)('%s menu', (kind) => {
  const terminal =
    kind === 'context' ? (
      <TerminalContextMenu>
        <div role="region" aria-label="Terminal" tabIndex={0}>
          Terminal
        </div>
      </TerminalContextMenu>
    ) : (
      <TerminalDropdownMenu />
    )
  const openMenu = () =>
    kind === 'context'
      ? userEvent.pointer({ target: screen.getByRole('region', { name: 'Terminal' }), keys: '[MouseRight]' })
      : userEvent.click(screen.getByRole('button', { name: t('common.more') }))

  async function openStyles() {
    await openMenu()
    await userEvent.hover(screen.getByRole('menuitem', { name: new RegExp(t('terminal.settings.cursor_style')) }))
    return screen.findByRole('menuitemradio', { name: t('terminal.settings.bar') })
  }

  it('saves a cursor shape selected from the submenu and shows it again on remount', async () => {
    const first = render(terminal)
    await userEvent.click(await openStyles())
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.agent.terminal.cursor_style')).toBe('bar')
    first.unmount()
    render(terminal)
    expect(await openStyles()).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: t('terminal.settings.block') })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('saves the blink switch and shows its saved state on remount', async () => {
    const first = render(terminal)
    await openMenu()
    const blink = screen.getByRole('menuitemcheckbox', { name: t('terminal.settings.cursor_blink') })
    expect(blink).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(blink)
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.agent.terminal.cursor_blink')).toBe(false)
    first.unmount()
    render(terminal)
    await openMenu()
    expect(screen.getByRole('menuitemcheckbox', { name: t('terminal.settings.cursor_blink') })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })
})
