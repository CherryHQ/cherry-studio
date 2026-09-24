import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToastConfig } from '@cherrystudio/ui'
import i18n, { initI18n } from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { IpcError } from '@shared/ipc/errors/IpcError'

import { exportDocument } from '../documentExport'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

function getToastConfig(method: typeof toast.success): ToastConfig {
  const config = vi.mocked(method).mock.calls[0]?.[0]
  if (!config || typeof config === 'string') throw new Error('Expected a toast with document details')
  return config
}

describe('document export feedback', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(toast.loading).mockImplementation(({ promise }) => {
      void promise.catch(() => undefined)
      return 'document-export'
    })
  })

  it('exports loaded content and offers to open the actual saved file', async () => {
    vi.mocked(ipcApi.request).mockResolvedValueOnce({
      path: '/exports/renamed.xlsx',
      format: 'xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })

    await exportDocument({
      markdown: async () => '| Name |\n| --- |\n| Cherry |',
      format: 'xlsx',
      defaultName: 'report',
      assetRoot: '/notes',
      sourcePath: '/notes/report.md'
    })

    expect(ipcApi.request).toHaveBeenCalledWith('export.document.convert_and_save', {
      markdown: '| Name |\n| --- |\n| Cherry |',
      format: 'xlsx',
      defaultName: 'report',
      assetRoot: '/notes',
      sourcePath: '/notes/report.md'
    })
    const success = getToastConfig(toast.success)
    expect(success.description).toBe('renamed.xlsx')
    expect(success.action?.label).toBe('Open')
    await success.action?.onClick()
    expect(ipcApi.request).toHaveBeenLastCalledWith('system.shell.open_path', '/exports/renamed.xlsx')
    expect(toast.closeToast).toHaveBeenCalledWith('document-export')
  })

  it('dismisses loading without a success or error message when the save dialog is cancelled', async () => {
    vi.mocked(ipcApi.request).mockResolvedValueOnce(null)

    await exportDocument({ markdown: '# Report', format: 'pdf', defaultName: 'report' })

    expect(toast.closeToast).toHaveBeenCalledWith('document-export')
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('exposes a conversion error and a preview action without reporting a saved file', async () => {
    vi.mocked(ipcApi.request).mockRejectedValueOnce(
      new IpcError('INVALID_TABLE', 'Table row has too many columns', { preview: '| a | b | c |' })
    )

    await exportDocument({ markdown: '| a | b | c |', format: 'xlsx', defaultName: 'report' })

    expect(getToastConfig(toast.error)).toMatchObject({
      title: 'Export failed',
      description: 'A table has rows with different numbers of columns. Check the preview and fix the table.',
      action: { label: 'Preview' }
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.closeToast).toHaveBeenCalledWith('document-export')
    await getToastConfig(toast.error).action?.onClick()
    expect(popup.info).toHaveBeenCalledWith(expect.objectContaining({ title: 'Preview', content: '| a | b | c |' }))
  })

  it('reports a source read failure before requesting conversion', async () => {
    await exportDocument({
      markdown: async () => {
        throw new Error('The source file was removed')
      },
      format: 'docx',
      defaultName: 'report'
    })

    expect(ipcApi.request).not.toHaveBeenCalled()
    expect(getToastConfig(toast.error).description).toBe('Export failed')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
