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
  it('renders the restore action after the input and invokes its callback', async () => {
    const user = userEvent.setup()
    const onRestoreMain = vi.fn()

    render(
      <InputBar
        text=""
        referenceText=""
        placeholder="Ask for help"
        loading={false}
        onRestoreMain={onRestoreMain}
        handleKeyDown={vi.fn()}
        handleChange={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText('Ask for help')
    const restoreButton = screen.getByRole('button', { name: 'Back to Main Window' })

    expect(input).toHaveClass('flex-1', 'min-w-0', 'bg-transparent', 'dark:bg-transparent')
    expect(input.compareDocumentPosition(restoreButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(restoreButton.querySelector('.lucide-picture-in-picture-2')).toBeInTheDocument()
    await user.click(restoreButton)
    expect(onRestoreMain).toHaveBeenCalledTimes(1)
  })

  it('does not render the restore action without a callback', () => {
    render(
      <InputBar
        text=""
        referenceText=""
        placeholder="Ask anything"
        loading={false}
        handleKeyDown={vi.fn()}
        handleChange={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'Restore Main' })).not.toBeInTheDocument()
  })
})
