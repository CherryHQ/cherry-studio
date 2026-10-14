import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { exportErrorCodes, type ExportErrorCode } from '@shared/ipc/errors/export'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { DocumentFormat } from '@shared/types/documentConversion'

const logger = loggerService.withContext('documentExport')

export const documentExportFormats = ['pdf', 'docx', 'pptx', 'xlsx'] as const satisfies readonly DocumentFormat[]

const formatNames: Record<DocumentFormat, string> = {
  pdf: 'PDF',
  docx: 'Word (.docx)',
  pptx: 'PowerPoint (.pptx)',
  xlsx: 'Excel (.xlsx)'
}

const errorLabels: Record<string, string> = {
  [exportErrorCodes.EMPTY_DOCUMENT]: 'notes.no_content_to_export',
  [exportErrorCodes.DOCUMENT_TOO_LARGE]: 'document_export.too_large',
  [exportErrorCodes.INVALID_TABLE]: 'document_export.invalid_table',
  [exportErrorCodes.INVALID_IMAGE]: 'document_export.invalid_image',
  [exportErrorCodes.DOCUMENT_SAVE_FAILED]: 'settings.tool.file_processing.errors.save_failed',
  [exportErrorCodes.CONVERSION_FAILED]: 'chat.topics.export.failed'
} satisfies Record<ExportErrorCode, string>

export function getDocumentExportLabel(format: DocumentFormat): string {
  return i18n.t('document_export.as_format', { format: formatNames[format] })
}

interface DocumentExportInput {
  markdown: string | (() => Promise<string>)
  format: DocumentFormat
  defaultName: string
  sourcePath?: string
  assetRoot?: string
}

export async function exportDocument(input: DocumentExportInput): Promise<void> {
  const operation = async () => {
    const markdown = typeof input.markdown === 'function' ? await input.markdown() : input.markdown
    return ipcApi.request('export.document.convert_and_save', { ...input, markdown })
  }
  const promise = operation()
  const loadingKey = toast.loading({
    title: i18n.t('document_export.converting', { format: formatNames[input.format] }),
    promise: promise.finally(() => toast.closeToast(loadingKey))
  })

  try {
    const artifact = await promise
    if (!artifact) return
    toast.success({
      title: i18n.t('common.success'),
      description: artifact.path.split(/[/\\]/).at(-1),
      action: {
        label: i18n.t('common.open'),
        onClick: async () => {
          try {
            await ipcApi.request('system.shell.open_path', artifact.path)
          } catch (error) {
            logger.error('Failed to open exported document', error as Error)
            toast.error(i18n.t('file_preview.pdf.too_large.open_error'))
          }
        }
      }
    })
  } catch (error) {
    logger.error('Document export failed', error as Error)
    const data = error instanceof IpcError ? error.data : undefined
    const preview = data && typeof data === 'object' && 'preview' in data ? data.preview : undefined
    toast.error({
      title: i18n.t('chat.topics.export.failed'),
      description: i18n.t(
        error instanceof IpcError
          ? (errorLabels[error.code] ?? 'chat.topics.export.failed')
          : 'chat.topics.export.failed'
      ),
      action:
        typeof preview === 'string' && preview.length > 0
          ? {
              label: i18n.t('common.preview'),
              onClick: async () => {
                await popup.info({
                  title: i18n.t('common.preview'),
                  content: preview,
                  icon: null,
                  className:
                    '[&_[data-slot=dialog-description]]:max-h-96 [&_[data-slot=dialog-description]]:overflow-auto [&_[data-slot=dialog-description]]:font-mono [&_[data-slot=dialog-description]]:whitespace-pre-wrap'
                })
              }
            }
          : undefined
    })
  }
}
