import { dialog } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { presentMigrationDiagnosticFailure, presentMigrationDiagnosticRecovery } from '../migrationDiagnosticDialogs'

const showMessageBoxMock = vi.mocked(dialog.showMessageBox)
const showSaveDialogMock = vi.mocked(dialog.showSaveDialog)

describe('migrationDiagnosticDialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns to the original failure decision after save cancellation', async () => {
    showMessageBoxMock.mockResolvedValueOnce({ response: 0 } as never).mockResolvedValueOnce({ response: 1 } as never)
    showSaveDialogMock.mockResolvedValue({ canceled: true, filePath: undefined } as never)
    const saveBundle = vi.fn()

    const result = await presentMigrationDiagnosticFailure({
      locale: 'en-US',
      code: 'database_initialize_failed',
      retry: 'relaunch',
      saveBundle
    })

    expect(result).toBe('retry')
    expect(showMessageBoxMock).toHaveBeenCalledTimes(2)
    expect(showMessageBoxMock.mock.calls[0]?.[0].buttons).toEqual(['Save diagnostic bundle', 'Retry', 'Exit'])
    expect(showMessageBoxMock.mock.calls[1]?.[0].buttons).toEqual(['Save diagnostic bundle', 'Retry', 'Exit'])
    expect(saveBundle).not.toHaveBeenCalled()
  })

  it('shows only stable follow-up actions after a bundle build failure', async () => {
    showMessageBoxMock.mockResolvedValueOnce({ response: 0 } as never).mockResolvedValueOnce({ response: 0 } as never)
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/safe/diagnostics.zip' } as never)
    const saveBundle = vi.fn().mockResolvedValue({ status: 'failed', code: 'archive_failed' })

    const result = await presentMigrationDiagnosticFailure({
      locale: 'en-US',
      code: 'migration_window_failed',
      retry: 'relaunch',
      saveBundle
    })

    expect(result).toBe('retry')
    expect(saveBundle).toHaveBeenCalledWith('/safe/diagnostics.zip')
    const failureDialog = showMessageBoxMock.mock.calls[1]?.[0]
    expect(failureDialog.buttons).toEqual(['Retry', 'Exit'])
    expect(failureDialog.buttons).not.toContain('Save diagnostic bundle')
    expect(failureDialog.detail).toContain('MIGRATION-DIAGNOSTIC-ARCHIVE-FAILED')
  })

  it('maps a thrown save operation to a stable summary without exposing the raw error', async () => {
    showMessageBoxMock.mockResolvedValueOnce({ response: 0 } as never).mockResolvedValueOnce({ response: 1 } as never)
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/safe/diagnostics.zip' } as never)
    const saveBundle = vi.fn().mockRejectedValue(new Error('Bearer secret-token /Users/private'))

    const result = await presentMigrationDiagnosticFailure({
      locale: 'en-US',
      code: 'migration_status_probe_failed',
      retry: 'relaunch',
      saveBundle
    })

    expect(result).toBe('exit')
    const rendered = JSON.stringify(showMessageBoxMock.mock.calls)
    expect(rendered).toContain('MIGRATION-DIAGNOSTIC-SNAPSHOT-FAILED')
    expect(rendered).not.toContain('secret-token')
    expect(rendered).not.toContain('/Users/private')
  })

  it('fails closed when the native save-outcome dialog itself cannot be shown', async () => {
    showMessageBoxMock
      .mockResolvedValueOnce({ response: 0 } as never)
      .mockRejectedValueOnce(new Error('native dialog unavailable'))
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/safe/diagnostics.zip' } as never)

    await expect(
      presentMigrationDiagnosticFailure({
        locale: 'en-US',
        code: 'database_initialize_failed',
        retry: 'relaunch',
        saveBundle: vi.fn().mockResolvedValue({ status: 'failed', code: 'publish_failed' })
      })
    ).resolves.toBe('exit')
  })

  it('returns to the recovery decision after canceling save before initialization', async () => {
    showMessageBoxMock.mockResolvedValueOnce({ response: 0 } as never).mockResolvedValueOnce({ response: 1 } as never)
    showSaveDialogMock.mockResolvedValue({ canceled: true, filePath: undefined } as never)
    const saveBundle = vi.fn()

    const result = await presentMigrationDiagnosticRecovery({
      locale: 'zh-CN',
      saveBundle
    })

    expect(result).toBe('retry')
    expect(showMessageBoxMock).toHaveBeenCalledTimes(2)
    expect(showMessageBoxMock.mock.calls[0]?.[0].buttons).toEqual(['保存上次诊断包', '重试迁移', '退出'])
    expect(showMessageBoxMock.mock.calls[1]?.[0].buttons).toEqual(['保存上次诊断包', '重试迁移', '退出'])
    expect(saveBundle).not.toHaveBeenCalled()
  })

  it('preserves the typed use-default decision for an inaccessible legacy location', async () => {
    showMessageBoxMock.mockResolvedValue({ response: 2 } as never)

    const result = await presentMigrationDiagnosticFailure({
      locale: 'en-US',
      code: 'legacy_data_location_unavailable',
      retry: 'relaunch',
      allowUseDefault: true,
      saveBundle: vi.fn()
    })

    expect(result).toBe('use_default')
    expect(showMessageBoxMock.mock.calls[0]?.[0].buttons).toEqual([
      'Save diagnostic bundle',
      'Retry',
      'Use default directory',
      'Exit'
    ])
  })
})
