import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bootConfigService } from '@main/data/bootConfig'

import { Application } from '../Application'

vi.unmock('@application')

describe('Application relaunch persistence', () => {
  const originalPackaged = app.isPackaged
  const relaunch = vi.fn()
  const exit = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(app, { isPackaged: true, relaunch, exit })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.assign(app, { isPackaged: originalPackaged })
  })

  it('persists pending startup settings before scheduling a restart and exiting', () => {
    const events: string[] = []
    vi.spyOn(bootConfigService, 'persist').mockImplementation(() => {
      events.push('persist')
    })
    relaunch.mockImplementation(() => {
      events.push('relaunch')
    })
    exit.mockImplementation(() => {
      events.push('exit')
    })
    Application.getInstance().relaunch()
    expect(events).toEqual(['persist', 'relaunch', 'exit'])
  })

  it('keeps the current process when startup settings cannot be persisted', () => {
    vi.spyOn(bootConfigService, 'persist').mockImplementation(() => {
      throw new Error('Cannot save startup settings')
    })
    expect(() => Application.getInstance().relaunch()).toThrow('Cannot save startup settings')
    expect(relaunch).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })
})
