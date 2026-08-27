import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import InputBar from '../InputBar'

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({ default: () => null }))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'quickAssistant.tooltip.restore_main' ? 'Back to Main Window' : key)
  })
}))

describe('InputBar', () => {
  it('restores Main from its accessible action', async () => {
    const user = userEvent.setup()
    const onRestoreMain = vi.fn()

    render(
      <InputBar
        text=""
        placeholder="Ask for help"
        loading={false}
        onRestoreMain={onRestoreMain}
        handleKeyDown={vi.fn()}
        handleChange={vi.fn()}
      />
    )

    const restoreButton = screen.getByRole('button', { name: 'Back to Main Window' })

    await user.click(restoreButton)
    expect(onRestoreMain).toHaveBeenCalledTimes(1)
  })
})
