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

  it('closes the action window', () => {
    render(<WindowFooter content="result" onRegenerate={vi.fn()} />)

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

  it('pauses generation without closing the action window', () => {
    const onPause = vi.fn()
    render(<WindowFooter content="result" loading onPause={onPause} />)

    const stopButton = screen.getByRole('button', { name: 'selection.action.window.esc_stop' })

    fireEvent.click(stopButton)
    expect(onPause).toHaveBeenCalledOnce()
    expect(ipcRequest).not.toHaveBeenCalledWith('window.close')
  })
})
