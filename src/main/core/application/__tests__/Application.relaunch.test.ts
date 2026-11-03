import { app, dialog } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService, LifecycleManager, ServiceContainer } from '@main/core/lifecycle'

import { Application } from '../Application'

vi.unmock('@application')

function resetApplication() {
  LifecycleManager.reset()
  ServiceContainer.reset()
  BaseService.resetInstances()
  ;(Application as unknown as { instance: Application | null }).instance = null
}

describe('Application relaunch', () => {
  let application: Application
  const appProperties = new Map(
    ['isPackaged', 'isReady', 'whenReady', 'exit', 'relaunch'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(app, key)
    ])
  )
  const messageBoxProperty = Object.getOwnPropertyDescriptor(dialog, 'showMessageBoxSync')

  beforeEach(() => {
    vi.clearAllMocks()
    resetApplication()
    Object.assign(app, {
      isPackaged: false,
      isReady: vi.fn(() => true),
      whenReady: vi.fn(() => Promise.resolve()),
      exit: vi.fn(),
      relaunch: vi.fn()
    })
    Object.assign(dialog, { showMessageBoxSync: vi.fn(() => 0) })
    application = Application.getInstance()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const [key, descriptor] of appProperties) {
      if (descriptor) Object.defineProperty(app, key, descriptor)
      else Reflect.deleteProperty(app, key)
    }
    if (messageBoxProperty) Object.defineProperty(dialog, 'showMessageBoxSync', messageBoxProperty)
    else Reflect.deleteProperty(dialog, 'showMessageBoxSync')
    resetApplication()
  })

  it('waits for readiness before showing the dev notice and exiting', async () => {
    const ready = Promise.withResolvers<void>()
    Object.assign(app, {
      isReady: vi.fn(() => false),
      whenReady: vi.fn(() => ready.promise)
    })

    application.relaunch()

    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled()
    expect(app.exit).not.toHaveBeenCalled()

    ready.resolve()
    await ready.promise

    expect(dialog.showMessageBoxSync).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'Manual Restart Required' })
    )
    expect(app.exit).toHaveBeenCalledExactlyOnceWith(0)
    expect(dialog.showMessageBoxSync).toHaveBeenCalledBefore(vi.mocked(app.exit))
    expect(app.relaunch).not.toHaveBeenCalled()
  })

  it('shows the dev notice and exits immediately when ready', () => {
    application.relaunch()

    expect(dialog.showMessageBoxSync).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'Manual Restart Required' })
    )
    expect(app.exit).toHaveBeenCalledExactlyOnceWith(0)
    expect(dialog.showMessageBoxSync).toHaveBeenCalledBefore(vi.mocked(app.exit))
    expect(app.relaunch).not.toHaveBeenCalled()
  })

  it('relaunches and exits without a dialog when packaged', () => {
    Object.assign(app, { isPackaged: true })

    application.relaunch()

    expect(app.relaunch).toHaveBeenCalledTimes(1)
    expect(app.exit).toHaveBeenCalledExactlyOnceWith(0)
    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled()
    expect(dialog.showErrorBox).not.toHaveBeenCalled()
  })
})
