import { setImmediate as nextImmediate } from 'node:timers/promises'

import { app, dialog } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Application } from '@main/core/application/Application'
import { RuntimeActivityService } from '@main/core/application/RuntimeActivityService'
import { BaseService, Injectable, LifecycleManager, Phase, ServiceContainer } from '@main/core/lifecycle'

import { RuntimeQuitConfirmationService } from '../RuntimeQuitConfirmationService'

vi.unmock('@application')
vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

@Injectable('PowerService')
class TestPowerService extends BaseService {
  preventSleep() {
    return { dispose() {} }
  }
}

type QuitEvent = { preventDefault: () => void }

function resetApplication() {
  LifecycleManager.reset()
  ServiceContainer.reset()
  BaseService.resetInstances()
  ;(Application as unknown as { instance: Application | null }).instance = null
}

describe('RuntimeQuitConfirmationService', () => {
  let application: Application
  let activity: RuntimeActivityService
  let beforeQuit: (event: QuitEvent) => void
  let acceptedExits: number
  let prompt: ReturnType<typeof Promise.withResolvers<Electron.MessageBoxReturnValue>>

  const requestNativeQuit = () => {
    const event = { preventDefault: vi.fn() }
    beforeQuit(event)
    if (event.preventDefault.mock.calls.length === 0) acceptedExits++
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    resetApplication()
    acceptedExits = 0
    prompt = Promise.withResolvers<Electron.MessageBoxReturnValue>()
    Object.assign(app, {
      on: vi.fn((event: string, listener: (event: QuitEvent) => void) => {
        if (event === 'before-quit') beforeQuit = listener
      }),
      quit: vi.fn(requestNativeQuit)
    })
    vi.spyOn(dialog, 'showMessageBox').mockImplementation(() => prompt.promise)
    const container = ServiceContainer.getInstance()
    container.register(TestPowerService)
    container.register(RuntimeActivityService)
    container.register(RuntimeQuitConfirmationService)
    application = Application.getInstance()
    activity = application.get('RuntimeActivityService')
    application['setupQuitHandlers']()
    await LifecycleManager.getInstance().startPhase(Phase.WhenReady)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetApplication()
  })

  it('allows an idle native quit without showing a dialog', () => {
    requestNativeQuit()
    expect(acceptedExits).toBe(1)
    expect(application.isQuitting).toBe(true)
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it.each(['native', 'application'] as const)('keeps tasks running when a %s quit is cancelled', async (source) => {
    const hold = activity.begin('request')
    if (source === 'native') requestNativeQuit()
    else application.quit()
    expect(acceptedExits).toBe(0)
    expect(application.isQuitting).toBe(false)
    expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ defaultId: 0, cancelId: 0 }))
    prompt.resolve({ response: 0, checkboxChecked: false })
    await prompt.promise
    await nextImmediate()
    expect(activity.hasActiveTasks()).toBe(true)
    expect(acceptedExits).toBe(0)
    hold.dispose()
  })

  it('coalesces repeated quit requests and resumes the normal quit flow after confirmation', async () => {
    activity.begin('request')
    requestNativeQuit()
    requestNativeQuit()
    application.quit()
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect(acceptedExits).toBe(0)
    prompt.resolve({ response: 1, checkboxChecked: false })
    await vi.waitFor(() => expect(acceptedExits).toBe(1))
    expect(application.isQuitting).toBe(true)
    expect(activity.hasActiveTasks()).toBe(true)
  })

  it('continues blocking repeated quits while a prompt is pending even if the task finishes', async () => {
    const hold = activity.begin('request')
    requestNativeQuit()
    hold.dispose()
    requestNativeQuit()
    expect(acceptedExits).toBe(0)
    prompt.resolve({ response: 0, checkboxChecked: false })
    await prompt.promise
    await nextImmediate()
    requestNativeQuit()
    expect(acceptedExits).toBe(1)
  })

  it('does not bypass a hard quit hold acquired while the confirmation dialog is open', async () => {
    activity.begin('request')
    requestNativeQuit()
    const critical = application.preventQuit('migration')
    prompt.resolve({ response: 1, checkboxChecked: false })
    await prompt.promise
    await nextImmediate()
    expect(acceptedExits).toBe(0)
    expect(application.isQuitting).toBe(false)
    critical.dispose()
    prompt = Promise.withResolvers<Electron.MessageBoxReturnValue>()
    requestNativeQuit()
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2)
    prompt.resolve({ response: 0, checkboxChecked: false })
    await prompt.promise
    await nextImmediate()
  })

  it('leaves the app running if the dialog fails, and allows another attempt', async () => {
    activity.begin('request')
    requestNativeQuit()
    prompt.reject(new Error('dialog unavailable'))
    await prompt.promise.catch(() => {})
    await nextImmediate()
    expect(acceptedExits).toBe(0)
    expect(application.isQuitting).toBe(false)
    prompt = Promise.withResolvers<Electron.MessageBoxReturnValue>()
    requestNativeQuit()
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2)
    prompt.resolve({ response: 0, checkboxChecked: false })
    await prompt.promise
    await nextImmediate()
  })

  it('skips user confirmation for system shutdown while preserving hard quit holds', () => {
    activity.begin('request')
    const critical = application.preventQuit('migration')
    application.quit('system-shutdown')
    expect(acceptedExits).toBe(0)
    critical.dispose()
    application.quit('system-shutdown')
    expect(acceptedExits).toBe(1)
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('does not resume a stale prompt after system shutdown has already been accepted', async () => {
    activity.begin('request')
    requestNativeQuit()
    application.quit('system-shutdown')
    expect(acceptedExits).toBe(1)
    prompt.resolve({ response: 1, checkboxChecked: false })
    await prompt.promise
    await nextImmediate()
    expect(acceptedExits).toBe(1)
  })

  it('does not prompt again when the updater has already marked the app as quitting', () => {
    activity.begin('request')
    application.markQuitting()
    requestNativeQuit()
    expect(acceptedExits).toBe(1)
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('unregisters its quit guard when stopped', async () => {
    activity.begin('request')
    await application.get('RuntimeQuitConfirmationService')._doStop()
    requestNativeQuit()
    expect(acceptedExits).toBe(1)
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('registers the guard again after restart without duplicate prompts', async () => {
    const service = application.get('RuntimeQuitConfirmationService')
    await service._doStop()
    await service._doInit()
    activity.begin('request')
    requestNativeQuit()
    prompt.resolve({ response: 1, checkboxChecked: false })
    await nextImmediate()
    expect(acceptedExits).toBe(1)
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('does not quit from a dialog belonging to a stopped service', async () => {
    activity.begin('request')
    requestNativeQuit()
    await application.get('RuntimeQuitConfirmationService')._doStop()
    prompt.resolve({ response: 1, checkboxChecked: false })
    await nextImmediate()
    expect(acceptedExits).toBe(0)
    expect(application.isQuitting).toBe(false)
  })
})
