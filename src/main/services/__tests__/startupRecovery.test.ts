import { app, dialog } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { diagnosticBundleService } from '../diagnostics'
import { showStartupRecovery } from '../startupRecovery'
import type * as RecoveryProgressModule from '../startupRecoveryProgress'
import { StartupRecoveryCanceled, withStartupRecoveryProgress } from '../startupRecoveryProgress'
import { canStopDatabaseProcess, listDatabaseProcesses, stopDatabaseProcess } from '../windowsRestartManager'

vi.mock('../startupRecoveryProgress', async (importOriginal) => ({
  ...(await importOriginal<typeof RecoveryProgressModule>()),
  withStartupRecoveryProgress: vi.fn((_language, operation) => operation(undefined))
}))

vi.mock('../windowsRestartManager', () => ({
  canStopDatabaseProcess: vi.fn(),
  listDatabaseProcesses: vi.fn(),
  stopDatabaseProcess: vi.fn()
}))

vi.mock('../diagnostics', () => ({ diagnosticBundleService: { exportStartupBundle: vi.fn() } }))
vi.mock('electron', () => ({
  app: { whenReady: vi.fn().mockResolvedValue(undefined), getLocale: vi.fn(() => 'zh-CN'), getVersion: () => '2.0.14' },
  dialog: { showMessageBox: vi.fn() }
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(application.get).mockImplementation(() => {
    throw new Error('Services unavailable')
  })
})

describe('startup recovery without database services', () => {
  it('explains file I/O failure in Chinese and offers a fresh restart, not SQL', async () => {
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false })
    const error = new Error('CREATE TABLE private_table', { cause: { code: 'SQLITE_IOERR_TRUNCATE' } })
    expect(await showStartupRecovery(error)).toBe('retry')
    const options = vi.mocked(dialog.showMessageBox).mock.calls[0][0]
    expect(options.message).toContain('文件操作')
    expect(options.detail).toContain('SQLITE_IOERR_TRUNCATE')
    expect(JSON.stringify(options)).not.toContain('CREATE TABLE')
    expect(options.buttons).toHaveLength(3)
  })

  it('keeps recovery available after an export error so the user can exit', async () => {
    vi.mocked(dialog.showMessageBox)
      .mockResolvedValueOnce({ response: 1, checkboxChecked: false })
      .mockResolvedValueOnce({ response: 0, checkboxChecked: false })
      .mockResolvedValueOnce({ response: 2, checkboxChecked: false })
    vi.mocked(diagnosticBundleService.exportStartupBundle).mockRejectedValue(new Error('ENOSPC'))
    expect(await showStartupRecovery({ code: 'SQLITE_FULL' })).toBe('exit')
    const options = vi.mocked(dialog.showMessageBox).mock.calls[1][0]
    expect(options.message).toContain('其他保存位置')
  })

  it('falls back to English before preferences exist and canceling export does not exit', async () => {
    vi.mocked(app.getLocale).mockReturnValueOnce('unsupported')
    vi.mocked(dialog.showMessageBox)
      .mockResolvedValueOnce({ response: 1, checkboxChecked: false })
      .mockResolvedValueOnce({ response: 2, checkboxChecked: false })
    vi.mocked(diagnosticBundleService.exportStartupBundle).mockResolvedValue({ status: 'canceled' })
    expect(await showStartupRecovery({ code: 'SQLITE_BUSY' })).toBe('exit')
    const options = vi.mocked(dialog.showMessageBox).mock.calls[0][0]
    expect(options.message).toContain('database is busy')
  })
})

describe('database process recovery', () => {
  const owner = { pid: 1234, started: '123456', name: 'Cherry Studio', executable: 'C:\\Cherry Studio.exe' }
  beforeEach(() => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.mocked(listDatabaseProcesses).mockResolvedValue([owner])
    vi.mocked(canStopDatabaseProcess).mockReturnValue(true)
    vi.mocked(stopDatabaseProcess).mockResolvedValue(undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  function responses(...values: number[]) {
    for (const response of values)
      vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response, checkboxChecked: false })
  }

  it('never offers termination for an external process', async () => {
    vi.mocked(canStopDatabaseProcess).mockReturnValue(false)
    responses(3, 0, 0, 2)
    expect(await showStartupRecovery({ code: 'SQLITE_BUSY' }, 'C:\\test.sqlite')).toBe('exit')
    expect(stopDatabaseProcess).not.toHaveBeenCalled()
    expect(vi.mocked(dialog.showMessageBox).mock.calls[1][0].message).toContain('手动关闭')
  })

  it('does not terminate when normal exit is canceled', async () => {
    responses(3, 1, 2)
    expect(await showStartupRecovery({ code: 'SQLITE_BUSY' })).toBe('exit')
    expect(stopDatabaseProcess).not.toHaveBeenCalled()
  })

  it('requires separate force consent after a normal exit request fails', async () => {
    responses(3, 0, 1, 2)
    expect(await showStartupRecovery({ code: 'SQLITE_BUSY' }, 'C:\\test.sqlite')).toBe('exit')
    expect(vi.mocked(stopDatabaseProcess).mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['C:\\test.sqlite', owner, false]
    ])
    expect(vi.mocked(dialog.showMessageBox).mock.calls[2][0]).toMatchObject({ defaultId: 1, cancelId: 1 })
  })

  it('restarts only after confirmed termination releases all file users', async () => {
    responses(3, 0, 0)
    vi.mocked(listDatabaseProcesses)
      .mockResolvedValueOnce([owner])
      .mockResolvedValueOnce([owner])
      .mockResolvedValueOnce([])
    expect(await showStartupRecovery({ code: 'SQLITE_BUSY' }, 'C:\\test.sqlite')).toBe('retry')
    expect(vi.mocked(stopDatabaseProcess).mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['C:\\test.sqlite', owner, false],
      ['C:\\test.sqlite', owner, true]
    ])
  })

  it('returns to recovery when process identity verification fails', async () => {
    responses(3, 0, 0, 2)
    vi.mocked(stopDatabaseProcess).mockRejectedValue(new Error('Database process identity changed'))
    expect(await showStartupRecovery({ code: 'SQLITE_BUSY' })).toBe('exit')
    expect(vi.mocked(stopDatabaseProcess).mock.calls.map((call) => call[2])).toEqual([false])
  })
  it('does not escalate or restart after progress cancellation', async () => {
    responses(3, 2)
    vi.mocked(withStartupRecoveryProgress).mockRejectedValueOnce(new StartupRecoveryCanceled())
    expect(await showStartupRecovery({ code: 'SQLITE_BUSY' })).toBe('exit')
    expect(stopDatabaseProcess).not.toHaveBeenCalled()
  })

  it('explains a failed force exit and preserves the recovery exit option', async () => {
    responses(3, 0, 0, 0, 2)
    vi.mocked(stopDatabaseProcess).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('351'))
    expect(await showStartupRecovery({ code: 'SQLITE_BUSY' })).toBe('exit')
    expect(vi.mocked(dialog.showMessageBox).mock.calls[3][0].message).toContain('强制结束进程失败')
  })
})
