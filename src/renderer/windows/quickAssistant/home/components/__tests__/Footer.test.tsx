import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Footer from '../Footer'

vi.mock('react-hotkeys-hook', () => ({ useHotkeys: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'chat.message.read_aloud.label' ? 'Read aloud' : key)
  })
}))

describe('Quick Assistant Footer', () => {
  const requiredProps = {
    route: 'chat',
    onEsc: vi.fn(),
    setIsPinned: vi.fn(),
    isPinned: false
  }

  it('offers manual playback only when a completed result is available and the window is idle', async () => {
    const user = userEvent.setup()
    const onReadAloud = vi.fn()
    const view = render(<Footer {...requiredProps} onReadAloud={onReadAloud} />)

    await user.click(screen.getByRole('button', { name: 'Read aloud' }))
    expect(onReadAloud).toHaveBeenCalledOnce()

    view.rerender(<Footer {...requiredProps} loading onReadAloud={onReadAloud} />)
    expect(screen.queryByRole('button', { name: 'Read aloud' })).not.toBeInTheDocument()
  })
})
