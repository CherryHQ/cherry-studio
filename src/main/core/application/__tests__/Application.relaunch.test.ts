import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bootConfigService } from '@main/data/bootConfig'

import { BaseService } from '../../lifecycle/BaseService'
import { Injectable } from '../../lifecycle/decorators'
import { LifecycleManager } from '../../lifecycle/LifecycleManager'
import { ServiceContainer } from '../../lifecycle/ServiceContainer'
import { Phase } from '../../lifecycle/types'
import { Application } from '../Application'

vi.unmock('@application')

function resetApplication(): void {
  LifecycleManager.reset()
  ServiceContainer.reset()
  BaseService.resetInstances()
  ;(Application as unknown as { instance: Application | null }).instance = null
}

describe('Application relaunch persistence', () => {
  const originalPackaged = app.isPackaged
  const relaunch = vi.fn()
  const exit = vi.fn()

  beforeEach(() => {
    resetApplication()
    vi.clearAllMocks()
    Object.assign(app, { isPackaged: true, relaunch, exit })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.assign(app, { isPackaged: originalPackaged })
    resetApplication()
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

  it('still restarts and exits after services are destroyed when persistence fails', async () => {
    const stopped: string[] = []

    @Injectable('RestartTestService')
    class RestartTestService extends BaseService {
      protected override onStop() {
        stopped.push('stop')
      }

      protected override onDestroy() {
        stopped.push('destroy')
      }
    }

    const application = Application.getInstance()
    ServiceContainer.getInstance().register(RestartTestService)
    await application.getLifecycleManager().startPhase(Phase.WhenReady)
    vi.spyOn(bootConfigService, 'persist').mockImplementation(() => {
      throw new Error('Cannot save startup settings')
    })

    await application.shutdown()
    expect(stopped).toEqual(['stop', 'destroy'])
    expect(() => application.relaunch()).not.toThrow()
    expect(relaunch).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })
})
