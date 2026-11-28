import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
// The lazy icon-list import fails.
vi.mock('lucide-react/dynamic', () => {
  throw new Error('icon list unavailable')
})

import SelectionActionIconPicker from '../SelectionActionIconPicker'

afterEach(cleanup)

describe('SelectionActionIconPicker failed dice import', () => {
  it('resolves the roll as empty without an unhandled rejection', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const user = userEvent.setup()
    const onChange = vi.fn()
    let roll: Promise<string | null> | undefined
    render(
      <SelectionActionIconPicker
        value="languages"
        onChange={onChange}
        onRoll={(pending) => {
          roll = pending
        }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'selection.settings.user_modal.icon.random' }))
    await expect(roll).resolves.toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(onChange).not.toHaveBeenCalled()
    expect(unhandled).not.toHaveBeenCalled()
    process.off('unhandledRejection', unhandled)
  })
})
