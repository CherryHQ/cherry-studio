import { app, dialog } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService, Injectable, LifecycleManager, ServiceContainer } from '@main/core/lifecycle'

import { Application } from '../Application'
import { RuntimeActivityService } from '../RuntimeActivityService'

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

describe('Application quit confirmation', () => {
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

  beforeEach(() => {
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
    application = Application.getInstance()
    activity = application.get('RuntimeActivityService')
    application['setupQuitHandlers']()
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
    requestNativeQuit()
    expect(acceptedExits).toBe(1)
  })

  it('does not bypass a hard quit hold acquired while the confirmation dialog is open', async () => {
    activity.begin('request')
    requestNativeQuit()
    const critical = application.preventQuit('migration')
    prompt.resolve({ response: 1, checkboxChecked: false })
    await prompt.promise
    expect(acceptedExits).toBe(0)
    expect(application.isQuitting).toBe(false)
    critical.dispose()
    prompt = Promise.withResolvers<Electron.MessageBoxReturnValue>()
    requestNativeQuit()
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2)
    prompt.resolve({ response: 0, checkboxChecked: false })
    await prompt.promise
  })

  it('leaves the app running if the dialog fails, and allows another attempt', async () => {
    activity.begin('request')
    requestNativeQuit()
    prompt.reject(new Error('dialog unavailable'))
    await prompt.promise.catch(() => {})
    expect(acceptedExits).toBe(0)
    expect(application.isQuitting).toBe(false)
    prompt = Promise.withResolvers<Electron.MessageBoxReturnValue>()
    requestNativeQuit()
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2)
    prompt.resolve({ response: 0, checkboxChecked: false })
    await prompt.promise
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
    expect(acceptedExits).toBe(1)
  })

  it('does not prompt again when the updater has already marked the app as quitting', () => {
    activity.begin('request')
    application.markQuitting()
    requestNativeQuit()
    expect(acceptedExits).toBe(1)
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })
})
