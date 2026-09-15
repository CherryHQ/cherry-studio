import { app, dialog } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { diagnosticBundleService } from '../diagnostics'
import { showStartupRecovery } from '../startupRecovery'

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
