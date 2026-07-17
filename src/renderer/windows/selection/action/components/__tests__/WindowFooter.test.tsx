import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import WindowFooter from '../WindowFooter'

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() }
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('WindowFooter', () => {
  it('uses neutral foreground colors for button hover feedback', () => {
    render(<WindowFooter content="result" onRegenerate={vi.fn()} />)

    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('hover:text-foreground', 'hover:[&_.btn-icon]:text-foreground')
      expect(button).not.toHaveClass('hover:text-primary', 'hover:[&_.btn-icon]:text-primary')
    }
  })

  it('uses the error color when hovering the stop button', () => {
    render(<WindowFooter content="result" loading onPause={vi.fn()} />)

    const stopButton = screen.getByRole('button', { name: 'selection.action.window.esc_stop' })
    expect(stopButton).toHaveClass('hover:text-error-base', 'hover:[&_.btn-icon]:text-error-base')
    expect(stopButton).not.toHaveClass('hover:text-primary', 'hover:[&_.btn-icon]:text-primary')
  })
})
