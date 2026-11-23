import { app, dialog } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'

import { DatabaseSchemaTooNewError } from '@data/db/checkDatabaseVersion'
import { ServiceInitError } from '@main/core/lifecycle'

import { Application } from '../Application'

vi.unmock('@application')

afterEach(() => vi.restoreAllMocks())

it('shows localized upgrade guidance and exits when the database schema is newer', async () => {
  const showMessageBox = vi.fn().mockResolvedValue({ response: 0 })
  const whenReady = vi.fn().mockResolvedValue(undefined)
  Object.assign(app, { whenReady, getLocale: () => 'zh-CN', getName: () => 'Cherry Studio' })
  Object.assign(dialog, { showMessageBox })

  const application = Application.getInstance()
  const forceExit = vi.spyOn(application, 'forceExit').mockImplementation(() => {})
  const error = new ServiceInitError('DbService', new DatabaseSchemaTooNewError(2, 1))
  await application['handleFatalServiceError'](error)

  expect(showMessageBox).toHaveBeenCalledWith({
    type: 'error',
    title: 'Cherry Studio',
    message: expect.stringContaining('请更新 Cherry Studio'),
    buttons: ['退出']
  })
  expect(forceExit).toHaveBeenCalledWith(1)
})
