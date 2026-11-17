import { fireEvent, render, screen } from '@testing-library/react'
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

  it('pauses generation without closing the action window', () => {
    const onPause = vi.fn()
    render(<WindowFooter content="result" loading onPause={onPause} />)

    const stopButton = screen.getByRole('button', { name: 'selection.action.window.esc_stop' })

    fireEvent.click(stopButton)
    expect(onPause).toHaveBeenCalledOnce()
    expect(ipcRequest).not.toHaveBeenCalledWith('window.close')
  })
})
