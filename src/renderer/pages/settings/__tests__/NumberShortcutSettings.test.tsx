import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { expect, it, vi } from 'vitest'

import type * as UI from '@cherrystudio/ui'
import type { NumberShortcutMode } from '@renderer/utils/numberShortcuts'

import { NumberShortcutSettings } from '../NumberShortcutSettings'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof UI>())

it('selects a single mode and updates the two shortcut roles together', async () => {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en',
    keySeparator: false,
    resources: {
      en: {
        translation: {
          'settings.shortcuts.number_keys.title': 'Number shortcuts',
          'settings.shortcuts.number_keys.conversations': 'Select conversation',
          'settings.shortcuts.number_keys.tabs': 'Switch tabs',
          'settings.shortcuts.number_keys.description': '{{conversations}} for conversations; {{tabs}} for tabs'
        }
      }
    }
  })
  function Settings() {
    const [mode, setMode] = useState<NumberShortcutMode>('conversation')
    return (
      <I18nextProvider i18n={i18n}>
        <NumberShortcutSettings mode={mode} saving={false} onChange={setMode} />
      </I18nextProvider>
    )
  }
  Element.prototype.scrollIntoView = vi.fn()
  const user = userEvent.setup()
  render(<Settings />)
  expect(screen.getByRole('combobox', { name: 'Number shortcuts' })).toHaveTextContent('Select conversation')
  screen.getByRole('combobox', { name: 'Number shortcuts' }).focus()
  await user.keyboard('{ArrowUp}')
  await screen.findByRole('option', { name: /Switch tabs/ })
  await user.keyboard('{Home}{Enter}')
  expect(screen.getByRole('combobox', { name: 'Number shortcuts' })).toHaveTextContent('Switch tabs')
  expect(screen.getByText(/for conversations; .*for tabs/)).toHaveTextContent(
    /(Alt\+|⌃) 1–9 for conversations; (Ctrl\+|⌘) 1–9 for tabs/
  )
})
