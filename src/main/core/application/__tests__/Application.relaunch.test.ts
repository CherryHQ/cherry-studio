import { app, ipcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bootConfigService } from '@main/data/bootConfig'
import { IpcChannel } from '@shared/IpcChannel'

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
    relaunch.mockReset()
    exit.mockReset()
    Object.assign(app, { isPackaged: true, relaunch, exit })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
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

  it('still completes a terminal restart when pending startup settings cannot be persisted', () => {
    vi.spyOn(bootConfigService, 'persist').mockImplementation(() => {
      throw new Error('Cannot save startup settings')
    })

    expect(() => Application.getInstance().relaunch()).not.toThrow()
    expect(relaunch).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('rejects a renderer restart before entering terminal relaunch when startup settings cannot be persisted', () => {
    const application = Application.getInstance()
    vi.spyOn(application, 'getPath').mockReturnValue(process.cwd())
    vi.stubEnv('ELECTRON_RENDERER_URL', 'https://cherry.test')
    application['registerApplicationIpc']()
    const request = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === IpcChannel.Application_Relaunch)?.[1]
    expect(request).toBeTypeOf('function')
    const terminalRelaunch = vi.spyOn(application, 'relaunch')
    vi.spyOn(bootConfigService, 'persist').mockImplementation(() => {
      throw new Error('Cannot save startup settings')
    })
    const event = {
      sender: { getType: () => 'window' },
      senderFrame: { url: 'https://cherry.test/window', parent: null }
    } as Electron.IpcMainInvokeEvent

    expect(() => request!(event)).toThrow('Cannot save startup settings')
    expect(terminalRelaunch).not.toHaveBeenCalled()
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
