import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandContextKeyProvider } from '@renderer/components/command/CommandContextKeyProvider'
import { CommandProvider } from '@renderer/components/command/CommandProvider'
import i18n from '@renderer/i18n/resolver'

import { ComposerFocusShortcut } from '../ComposerFocusShortcut'

const state = vi.hoisted(() => ({ active: true }))

vi.mock('@renderer/hooks/tab', () => ({ useIsActiveTab: () => state.active }))

// The announced-wording assertion below is a literal, so pin the catalog it is written against.
beforeAll(() => i18n.changeLanguage('en-US'))

function mount(editable = true) {
  render(
    <CommandContextKeyProvider>
      <CommandProvider>
        <textarea aria-label="Message" />
        <ComposerFocusShortcut
          focus={() => screen.getByRole('textbox', { name: 'Message' }).focus()}
          editable={editable}
        />
      </CommandProvider>
    </CommandContextKeyProvider>
  )
  return { input: screen.getByRole('textbox', { name: 'Message' }), user: userEvent.setup() }
}

describe('ComposerFocusShortcut', () => {
  beforeEach(() => {
    state.active = true
    MockUsePreferenceUtils.resetMocks()
  })
  afterEach(cleanup)

  it('focuses the active composer with the displayed default shortcut', async () => {
    const { input, user } = mount()
    expect(screen.getByText('Ctrl+I')).toBeInTheDocument()
    await user.keyboard('{Control>}i{/Control}')
    expect(input).toHaveFocus()
  })

  it('follows a customized binding for both the hint and the action', async () => {
    MockUsePreferenceUtils.setPreferenceValue('shortcut.chat.input.focus', {
      binding: ['CommandOrControl', 'L'],
      enabled: true
    })
    const { input, user } = mount()
    expect(screen.getByText('Ctrl+L')).toBeInTheDocument()
    await user.keyboard('{Control>}i{/Control}')
    expect(input).not.toHaveFocus()
    await user.keyboard('{Control>}l{/Control}')
    expect(input).toHaveFocus()
  })

  it('does not activate a background tab', async () => {
    state.active = false
    const { input, user } = mount()
    await user.keyboard('{Control>}i{/Control}')
    expect(input).not.toHaveFocus()
  })

  it('names the shortcut for assistive technology, which cannot read the keycap', () => {
    mount()

    // The keycap itself is aria-hidden, so the label beside it is the only announceable form.
    expect(screen.getByText('Focus Input')).toHaveClass('sr-only')

    expect(screen.getByText('Ctrl+I')).toHaveAttribute('aria-hidden', 'true')
  })

  it.each(['disabled', 'readonly'])('hides the hint and ignores the shortcut when %s', async (mode) => {
    if (mode === 'disabled') {
      MockUsePreferenceUtils.setPreferenceValue('shortcut.chat.input.focus', {
        binding: ['CommandOrControl', 'I'],
        enabled: false
      })
    }
    const { input, user } = mount(mode !== 'readonly')
    expect(screen.queryByText('Ctrl+I')).not.toBeInTheDocument()
    await user.keyboard('{Control>}i{/Control}')
    expect(input).not.toHaveFocus()
  })
})
