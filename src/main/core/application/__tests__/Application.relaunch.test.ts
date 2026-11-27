import { app, dialog } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'

import { Application } from '../Application'

vi.unmock('@application')

afterEach(() => vi.restoreAllMocks())

it.each([false, true])('exits development relaunch with Electron ready=%s', (ready) => {
  const exits: number[] = []
  Object.assign(app, {
    isReady: vi.fn(() => ready),
    exit: vi.fn((code: number) => exits.push(code))
  })
  Object.assign(dialog, {
    showMessageBoxSync: vi.fn(() => {
      if (!ready) throw new Error('dialog module can only be used after app is ready')
      return 0
    })
  })
  Application.getInstance().relaunch()
  expect(exits).toEqual([0])
  if (ready)
    expect(dialog.showMessageBoxSync).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Manual Restart Required' })
    )
})
