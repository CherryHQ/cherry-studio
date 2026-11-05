import { fireEvent, render, screen } from '@testing-library/react'
import { useHotkeys } from 'react-hotkeys-hook'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WindowFooter from '../WindowFooter'

const ipcRequest = vi.hoisted(() => vi.fn())

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequest }
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('WindowFooter', () => {
  beforeEach(() => {
    ipcRequest.mockClear()
  })

  it('uses neutral foreground colors for button hover feedback', () => {
    render(<WindowFooter content="result" onRegenerate={vi.fn()} />)

    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('hover:text-foreground', 'hover:[&_.btn-icon]:text-foreground')
      expect(button).not.toHaveClass('hover:text-primary', 'hover:[&_.btn-icon]:text-primary')
    }

    fireEvent.click(screen.getByRole('button', { name: 'selection.action.window.esc_close' }))
    expect(ipcRequest).toHaveBeenCalledWith('window.close')
  })

  it('enables the Escape binding inside inputs while typing keys stay form-safe', () => {
    const hotkeys = vi.mocked(useHotkeys)
    hotkeys.mockClear()

    render(<WindowFooter content="result" />)

    // Regression: with the ask-input field autofocused, Escape must still
    // reach the footer binding (close/pause), while 'c' and 'r' must stay
    // ignored in form controls so typing them is unaffected.
    const escCall = hotkeys.mock.calls.find(([keys]) => keys === 'esc')
    expect(escCall?.[2]).toMatchObject({ enableOnFormTags: ['INPUT'] })
    for (const keys of ['c', 'r']) {
      const call = hotkeys.mock.calls.find(([k]) => k === keys)
      expect(call?.[2]).toBeUndefined()
    }
  })

  it('uses the error color when hovering the stop button', () => {
    const onPause = vi.fn()
    render(<WindowFooter content="result" loading onPause={onPause} />)

    const stopButton = screen.getByRole('button', { name: 'selection.action.window.esc_stop' })
    expect(stopButton).toHaveClass('hover:text-error', 'hover:[&_.btn-icon]:text-error')
    expect(stopButton).not.toHaveClass('hover:text-primary', 'hover:[&_.btn-icon]:text-primary')

    fireEvent.click(stopButton)
    expect(onPause).toHaveBeenCalledOnce()
    expect(ipcRequest).not.toHaveBeenCalledWith('window.close')
  })
})
