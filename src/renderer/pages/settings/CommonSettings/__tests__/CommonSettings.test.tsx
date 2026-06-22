import type { MenuPresentationMode } from '@shared/data/preference/preferenceTypes'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { confirmMenuPresentationModeChange } from '../index'

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error))
}))

describe('CommonSettings menu presentation mode', () => {
  const t = (key: string) => key
  const setMenuPresentationMode = vi.fn<(mode: MenuPresentationMode) => Promise<void>>()
  const setTimeoutTimer = vi.fn<(key: string, callback: () => void, delay: number) => void>()
  const confirm = vi.fn()
  const relaunch = vi.fn()
  const toastError = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    setMenuPresentationMode.mockResolvedValue(undefined)
    ;(window as any).modal = { confirm }
    ;(window as any).toast = { error: toastError }
    ;(window as any).api = { application: { relaunch } }
  })

  it('does nothing when the selected mode is already active', () => {
    confirmMenuPresentationModeChange({
      currentMode: 'cherry',
      mode: 'cherry',
      setMenuPresentationMode,
      setTimeoutTimer,
      t
    })

    expect(confirm).not.toHaveBeenCalled()
  })

  it('saves the selected mode and schedules relaunch after confirmation', async () => {
    confirmMenuPresentationModeChange({
      currentMode: 'cherry',
      mode: 'native',
      setMenuPresentationMode,
      setTimeoutTimer,
      t
    })

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.general.common.menu.presentation_mode.restart.title',
        content: 'settings.general.common.menu.presentation_mode.restart.content',
        okText: 'common.confirm',
        cancelText: 'common.cancel',
        centered: true
      })
    )

    const options = confirm.mock.calls[0][0]
    await options.onOk()

    expect(setMenuPresentationMode).toHaveBeenCalledWith('native')
    expect(setTimeoutTimer).toHaveBeenCalledWith('handleMenuPresentationModeChange', expect.any(Function), 500)

    setTimeoutTimer.mock.calls[0][1]()
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('surfaces save failures without scheduling relaunch', async () => {
    const error = new Error('save failed')
    setMenuPresentationMode.mockRejectedValue(error)

    confirmMenuPresentationModeChange({
      currentMode: 'cherry',
      mode: 'native',
      setMenuPresentationMode,
      setTimeoutTimer,
      t
    })

    const options = confirm.mock.calls[0][0]
    await expect(options.onOk()).rejects.toThrow('save failed')

    expect(toastError).toHaveBeenCalledWith('save failed')
    expect(setTimeoutTimer).not.toHaveBeenCalled()
    expect(relaunch).not.toHaveBeenCalled()
  })
})
