import { app, dialog } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'

import { DatabaseSchemaTooNewError } from '@data/db/checkDatabaseVersion'
import {
  BaseService,
  ErrorHandling,
  FatalStartupError,
  Injectable,
  LifecycleManager,
  Phase,
  ServiceContainer,
  ServiceInitError
} from '@main/core/lifecycle'

import { Application } from '../Application'

vi.unmock('@application')

afterEach(() => {
  vi.restoreAllMocks()
  LifecycleManager.reset()
  ServiceContainer.reset()
  BaseService.resetInstances()
  ;(Application as unknown as { instance: Application | null }).instance = null
})

it('shows localized upgrade guidance and exits when the database schema is newer', async () => {
  const showMessageBox = vi.fn().mockResolvedValue({ response: 0 })
  const whenReady = vi.fn().mockResolvedValue(undefined)
  Object.assign(app, { whenReady, getLocale: () => 'zh-CN', getName: () => 'Cherry Studio' })
  Object.assign(dialog, { showMessageBox })

  @Injectable('FatalStartupService')
  @ErrorHandling('fail-fast')
  class FatalStartupService extends BaseService {
    protected override onInit(): void {
      throw new DatabaseSchemaTooNewError(2, 1)
    }
  }
  ServiceContainer.getInstance().register(FatalStartupService)
  const error = await LifecycleManager.getInstance()
    .startPhase(Phase.WhenReady)
    .catch((failure: unknown) => failure)
  expect(error).toBeInstanceOf(ServiceInitError)
  expect((error as ServiceInitError).cause).toBeInstanceOf(FatalStartupError)

  const application = Application.getInstance()
  const forceExit = vi.spyOn(application, 'forceExit').mockImplementation(() => {})
  const relaunch = vi.spyOn(application, 'relaunch').mockImplementation(() => {})
  await application['handleFatalServiceError'](error as ServiceInitError)

  expect(showMessageBox).toHaveBeenCalledWith({
    type: 'error',
    title: 'Cherry Studio',
    message: expect.stringContaining('请更新 Cherry Studio'),
    buttons: ['退出']
  })
  expect(forceExit).toHaveBeenCalledWith(1)
  expect(relaunch).not.toHaveBeenCalled()
})

it.each([0, 1])('preserves the exit and restart choices for generic startup failures (choice %s)', async (response) => {
  const showMessageBox = vi.fn().mockResolvedValue({ response })
  Object.assign(app, { whenReady: vi.fn().mockResolvedValue(undefined) })
  Object.assign(dialog, { showMessageBox })
  const application = Application.getInstance()
  const forceExit = vi.spyOn(application, 'forceExit').mockImplementation(() => {})
  const relaunch = vi.spyOn(application, 'relaunch').mockImplementation(() => {})

  await application['handleFatalServiceError'](new ServiceInitError('CriticalService', new Error('Connection failed')))

  expect(showMessageBox).toHaveBeenCalledWith(
    expect.objectContaining({ buttons: ['Exit', 'Restart'], message: expect.stringContaining('CriticalService') })
  )
  if (response === 0) {
    expect(forceExit).toHaveBeenCalledWith(1)
    expect(relaunch).not.toHaveBeenCalled()
  } else {
    expect(relaunch).toHaveBeenCalledOnce()
    expect(forceExit).not.toHaveBeenCalled()
  }
})
