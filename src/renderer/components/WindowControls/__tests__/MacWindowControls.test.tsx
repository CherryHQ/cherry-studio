// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as WindowControlsModule from '../index'

const mocks = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (value: boolean) => void>(),
  request: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mocks.request
  },
  useIpcOn: (channel: string, handler: (value: boolean) => void) => {
    mocks.ipcHandlers.set(channel, handler)
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'navbar.window.close': 'Close',
        'navbar.window.maximize': 'Maximize',
        'navbar.window.minimize': 'Minimize',
        'navbar.window.restore': 'Restore'
      })[key] ?? key
  })
}))

const MacWindowControls = (WindowControlsModule as typeof WindowControlsModule & { MacWindowControls?: ComponentType })
  .MacWindowControls

function renderMacWindowControls() {
  expect(MacWindowControls, 'Expected WindowControls to export MacWindowControls').toBeTypeOf('function')
  if (!MacWindowControls) throw new Error('MacWindowControls is not exported')
  return render(<MacWindowControls />)
}

beforeEach(() => {
  mocks.request.mockImplementation((route: string) =>
    Promise.resolve(route === 'window.is_full_screen' ? false : undefined)
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.ipcHandlers.clear()
})

describe('MacWindowControls', () => {
  it('fits the red, yellow, and green controls inside the 65px sidebar width', () => {
    renderMacWindowControls()

    const controls = screen.getByTestId('mac-window-controls')
    const buttons = screen.getAllByRole('button')

    expect(controls).toHaveStyle({ width: '65px' })
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Close', 'Minimize', 'Maximize'])
    expect(buttons[0]).toHaveClass('bg-[#ff5f57]')
    expect(buttons[1]).toHaveClass('bg-[#febc2e]')
    expect(buttons[2]).toHaveClass('bg-[#28c840]')
  })

  it('delegates close, minimize, and native fullscreen to the current window IPC routes', async () => {
    const user = userEvent.setup()
    renderMacWindowControls()

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('window.is_full_screen'))
    mocks.request.mockClear()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Minimize' }))
    await user.click(screen.getByRole('button', { name: 'Maximize' }))

    expect(mocks.request).toHaveBeenNthCalledWith(1, 'window.close')
    expect(mocks.request).toHaveBeenNthCalledWith(2, 'window.minimize')
    expect(mocks.request).toHaveBeenNthCalledWith(3, 'window.set_full_screen', true)
  })

  it('exits fullscreen after receiving the native fullscreen state event', async () => {
    const user = userEvent.setup()
    renderMacWindowControls()

    act(() => {
      mocks.ipcHandlers.get('window.fullscreen_changed')?.(true)
    })
    await user.click(screen.getByRole('button', { name: 'Restore' }))

    expect(mocks.request).toHaveBeenCalledWith('window.set_full_screen', false)
  })
})
