import { application } from '@application'
import type { MigrationDiagnosticSavedResult } from '@shared/data/migration/v2/diagnostics'
import { dialog } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createMigrationDiagnosticSavedDetail,
  presentMigrationDiagnosticFailure,
  saveMigrationDiagnosticBundleWithDialog
} from '../migrationDiagnosticDialogs'
import { createMigrationDiagnosticNativeI18n } from '../migrationDiagnosticNativeI18n'

const showMessageBoxMock = vi.mocked(dialog.showMessageBox)
const showSaveDialogMock = vi.mocked(dialog.showSaveDialog)
const getPathMock = vi.mocked(application.getPath)

const context = {
  source: 'native' as const,
  stage: 'preboot' as const,
  failureCode: 'database_initialize_failed',
  errorSummary: 'Could not initialize the migration database.'
}

describe('migrationDiagnosticDialogs', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getPathMock.mockImplementation((key: string, filename?: string) =>
      filename ? `/central/${key}/${filename}` : `/central/${key}`
    )
  })

  it.each([
    [
      { status: 'saved', logs: 'included', size: 'standard' },
      '诊断包包含当天的原始应用日志，可能含有文件路径、错误堆栈、用户内容或凭据。发送前请自行检查。\n\n诊断包不会自动上传。'
    ],
    [
      { status: 'saved', logs: 'included', size: 'large' },
      '诊断包包含当天的原始应用日志，可能含有文件路径、错误堆栈、用户内容或凭据。发送前请自行检查。\n\n文件较大，建议使用邮箱的大附件或网盘功能发送。\n\n诊断包不会自动上传。'
    ],
    [
      { status: 'saved', logs: 'not_included', retry: 'suggested', size: 'standard' },
      '诊断包已保存，但当天应用日志未能加入。基础诊断信息会记录原因和相关绝对路径；发生收集异常时还会包含原始异常文本与完整错误堆栈。您可以重新保存；即使日志仍缺失，当前诊断包也可用于排查。\n\n诊断包不会自动上传。'
    ],
    [
      { status: 'saved', logs: 'not_included', retry: 'not_suggested', size: 'large' },
      '诊断包已保存，但当天应用日志未能加入。基础诊断信息会记录原因和相关绝对路径；发生收集异常时还会包含原始异常文本与完整错误堆栈。再次保存通常无法解决，当前诊断包仍可用于排查。\n\n文件较大，建议使用邮箱的大附件或网盘功能发送。\n\n诊断包不会自动上传。'
    ]
  ] as const)('builds the exact ordered Chinese saved detail for %#', async (result, expected) => {
    const i18n = await createMigrationDiagnosticNativeI18n('zh-CN')

    expect(createMigrationDiagnosticSavedDetail(result satisfies MigrationDiagnosticSavedResult, i18n)).toBe(expected)
  })

  it('uses the central app.logs path and returns canceled without building', async () => {
    showSaveDialogMock.mockResolvedValue({ canceled: true, filePath: undefined } as never)
    const saveBundle = vi.fn()

    const outcome = await saveMigrationDiagnosticBundleWithDialog(context, { locale: 'zh-CN', saveBundle })

    expect(outcome).toEqual({ result: { status: 'canceled' } })
    expect(getPathMock).toHaveBeenCalledWith('app.logs', 'cherry-studio-migration-diagnostics.zip')
    expect(showSaveDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: '/central/app.logs/cherry-studio-migration-diagnostics.zip',
        filters: [{ name: 'ZIP', extensions: ['zip'] }]
      })
    )
    expect(saveBundle).not.toHaveBeenCalled()
  })

  it('maps a save-dialog exception to dialog_failed', async () => {
    showSaveDialogMock.mockRejectedValue(new Error('native dialog unavailable'))

    await expect(saveMigrationDiagnosticBundleWithDialog(context)).resolves.toEqual({
      result: { status: 'failed', code: 'dialog_failed' }
    })
  })

  it('maps builder rejection and failure to bundle_save_failed', async () => {
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/chosen/diagnostics.zip' } as never)

    await expect(
      saveMigrationDiagnosticBundleWithDialog(context, {
        saveBundle: async () => {
          throw new Error('write failed')
        }
      })
    ).resolves.toEqual({ result: { status: 'failed', code: 'bundle_save_failed' } })

    await expect(
      saveMigrationDiagnosticBundleWithDialog(context, {
        saveBundle: async () => ({ status: 'failed', code: 'bundle_save_failed' })
      })
    ).resolves.toEqual({ result: { status: 'failed', code: 'bundle_save_failed' } })
  })

  it('returns the Main-selected destination and central logs directory on success', async () => {
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/chosen/diagnostics.zip' } as never)
    const saved: MigrationDiagnosticSavedResult = { status: 'saved', logs: 'included', size: 'large' }
    const saveBundle = vi.fn(async () => saved)

    const outcome = await saveMigrationDiagnosticBundleWithDialog(context, { locale: 'en-US', saveBundle })

    expect(outcome).toEqual({ result: saved, destination: '/chosen/diagnostics.zip' })
    expect(saveBundle).toHaveBeenCalledWith({
      destination: '/chosen/diagnostics.zip',
      logsDirectory: '/central/app.logs',
      context
    })
  })

  it('returns to the original failure dialog after canceling save and preserves original decision ids', async () => {
    showMessageBoxMock.mockResolvedValueOnce({ response: 0 } as never).mockResolvedValueOnce({ response: 1 } as never)
    showSaveDialogMock.mockResolvedValue({ canceled: true, filePath: undefined } as never)

    const result = await presentMigrationDiagnosticFailure({
      locale: 'zh-CN',
      context,
      failure: {
        type: 'warning',
        title: '原始标题',
        message: '原始消息',
        detail: '原始详情',
        buttons: ['重试', '使用默认目录', '退出'],
        defaultId: 0,
        cancelId: 2
      }
    })

    expect(result).toBe(0)
    expect(showMessageBoxMock).toHaveBeenCalledTimes(2)
    expect(showMessageBoxMock.mock.calls[0]?.[0]).toMatchObject({
      title: '原始标题',
      message: '原始消息',
      detail: '原始详情',
      buttons: ['保存诊断包', '重试', '使用默认目录', '退出'],
      defaultId: 1,
      cancelId: 3
    })
    expect(showMessageBoxMock.mock.calls[1]?.[0].buttons).toEqual(['保存诊断包', '重试', '使用默认目录', '退出'])
  })

  it('falls back to the original failure dialog when the diagnostic-enhanced dialog fails', async () => {
    showMessageBoxMock
      .mockRejectedValueOnce(new Error('diagnostic dialog unavailable'))
      .mockResolvedValueOnce({ response: 1 } as never)

    const failure = {
      type: 'warning' as const,
      title: 'Original title',
      message: 'Original message',
      detail: 'Original detail',
      buttons: ['Retry', 'Use Default Directory', 'Quit'],
      defaultId: 0,
      cancelId: 2
    }

    const result = await presentMigrationDiagnosticFailure({ locale: 'en-US', context, failure })

    expect(result).toBe(1)
    expect(showMessageBoxMock).toHaveBeenCalledTimes(2)
    expect(showMessageBoxMock.mock.calls[1]?.[0]).toEqual(failure)
  })

  it('shows the unified success notice and then returns only an original decision', async () => {
    showMessageBoxMock.mockResolvedValueOnce({ response: 0 } as never).mockResolvedValueOnce({ response: 1 } as never)
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/chosen/diagnostics.zip' } as never)

    const result = await presentMigrationDiagnosticFailure(
      {
        locale: 'zh-Hans',
        context,
        failure: {
          type: 'error',
          title: '启动失败',
          message: '无法启动',
          buttons: ['重试', '使用默认目录', '退出'],
          defaultId: 0,
          cancelId: 2
        }
      },
      { saveBundle: async () => ({ status: 'saved', logs: 'included', size: 'large' }) }
    )

    expect(result).toBe(1)
    expect(showMessageBoxMock.mock.calls[1]?.[0]).toEqual({
      type: 'info',
      title: '诊断包已保存',
      message: '诊断包已保存',
      detail:
        '诊断包包含当天的原始应用日志，可能含有文件路径、错误堆栈、用户内容或凭据。发送前请自行检查。\n\n文件较大，建议使用邮箱的大附件或网盘功能发送。\n\n诊断包不会自动上传。',
      buttons: ['重试', '使用默认目录', '退出'],
      defaultId: 0,
      cancelId: 2
    })
  })

  it('offers Save Again for retryable missing logs and repeats the save flow directly', async () => {
    showMessageBoxMock
      .mockResolvedValueOnce({ response: 0 } as never)
      .mockResolvedValueOnce({ response: 0 } as never)
      .mockResolvedValueOnce({ response: 1 } as never)
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/chosen/diagnostics.zip' } as never)
    const saveBundle = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'saved',
        logs: 'not_included',
        retry: 'suggested',
        size: 'standard'
      })
      .mockResolvedValueOnce({ status: 'saved', logs: 'included', size: 'standard' })

    const result = await presentMigrationDiagnosticFailure(
      {
        locale: 'en-US',
        context,
        failure: {
          type: 'error',
          title: 'Startup failed',
          message: 'Could not start',
          buttons: ['Retry', 'Quit'],
          defaultId: 0,
          cancelId: 1
        }
      },
      { saveBundle }
    )

    expect(result).toBe(1)
    expect(showSaveDialogMock).toHaveBeenCalledTimes(2)
    expect(saveBundle).toHaveBeenCalledTimes(2)
    expect(showMessageBoxMock.mock.calls[1]?.[0]).toMatchObject({
      buttons: ['Save again', 'Retry', 'Quit'],
      defaultId: 0,
      cancelId: 2
    })
    expect(showMessageBoxMock.mock.calls[2]?.[0].buttons).toEqual(['Retry', 'Quit'])
  })

  it('explains that failed saves did not upload or send data before returning an original decision', async () => {
    showMessageBoxMock.mockResolvedValueOnce({ response: 0 } as never).mockResolvedValueOnce({ response: 0 } as never)
    showSaveDialogMock.mockRejectedValue(new Error('dialog failed'))

    const result = await presentMigrationDiagnosticFailure({
      locale: 'en-US',
      context,
      failure: {
        type: 'error',
        title: 'Startup failed',
        message: 'Could not start',
        buttons: ['Quit'],
        defaultId: 0,
        cancelId: 0
      }
    })

    expect(result).toBe(0)
    expect(showMessageBoxMock.mock.calls[1]?.[0]).toMatchObject({
      type: 'error',
      title: 'Could not save diagnostic bundle',
      message: 'The diagnostic bundle could not be saved. No data was uploaded or sent.',
      buttons: ['Quit'],
      defaultId: 0,
      cancelId: 0
    })
  })
})
