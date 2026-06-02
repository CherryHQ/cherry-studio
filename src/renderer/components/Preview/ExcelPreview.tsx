import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat'
import { ExcelWorkbookView } from '@renderer/components/Excel'
import type { ExcelImportDiagnosticCode, ExcelPreviewTable } from '@shared/excelPreview'
import type { IWorkbookData } from '@univerjs/core'
import type { TFunction } from 'i18next'
import { AlertCircle, FileSpreadsheet } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ExcelPreview')

export interface ExcelPreviewProps {
  filePath: string
  fileName?: string
  refreshKey?: number
}

type ExcelPreviewStatus =
  | { type: 'loading' }
  | { type: 'ready'; tables?: ExcelPreviewTable[]; workbookData: IWorkbookData }
  | { type: 'empty' }
  | { type: 'error'; code: ExcelImportDiagnosticCode; detail?: string }

const isUniverWorkbookEmpty = (workbookData: IWorkbookData): boolean => workbookData.sheetOrder.length === 0

const EXCEL_PREVIEW_ERROR_KEYS: Record<ExcelImportDiagnosticCode, string> = {
  excel_file_too_large: 'agent.preview_pane.excel.errors.file_too_large',
  excel_parse_error: 'agent.preview_pane.excel.errors.parse_failed',
  excel_preview_too_complex: 'agent.preview_pane.excel.errors.too_complex',
  invalid_excel_preview_request: 'agent.preview_pane.excel.errors.invalid_request',
  unsupported_excel_charts: 'agent.preview_pane.excel.errors.parse_failed',
  unsupported_excel_extension: 'agent.preview_pane.excel.errors.unsupported_extension',
  unsupported_excel_images: 'agent.preview_pane.excel.errors.parse_failed',
  unsupported_xls_format: 'agent.preview_pane.excel.errors.unsupported_xls'
}

const getExcelPreviewErrorDescription = (t: TFunction, code: ExcelImportDiagnosticCode, detail?: string): string => {
  return t(EXCEL_PREVIEW_ERROR_KEYS[code], { defaultValue: detail ?? t('common.error') })
}

const ExcelPreview = ({ filePath, fileName, refreshKey }: ExcelPreviewProps) => {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ExcelPreviewStatus>({ type: 'loading' })

  const handleWorkbookError = useCallback((error: Error) => {
    setStatus({ type: 'error', code: 'excel_parse_error', detail: error.message })
  }, [])

  useEffect(() => {
    let cancelled = false

    setStatus({ type: 'loading' })

    void (async () => {
      try {
        const request = fileName ? { filePath, fileName } : { filePath }
        const result = await window.api.excel.readWorkbookPreview(request)
        if (cancelled) return

        if (!result.success) {
          logger.warn(`Excel preview failed with ${result.error.code}: ${filePath}`)
          setStatus({ type: 'error', code: result.error.code, detail: result.error.message })
          return
        }

        const warnings = result.data.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning')

        if (warnings.length) {
          logger.warn(`Excel preview loaded with ${warnings.length} import diagnostics: ${filePath}`, warnings)
        }

        setStatus(
          isUniverWorkbookEmpty(result.data.workbookData)
            ? { type: 'empty' }
            : { type: 'ready', tables: result.data.tables, workbookData: result.data.workbookData }
        )
      } catch (err) {
        if (cancelled) return

        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error(`Failed to load Excel preview: ${filePath}`, normalized)
        setStatus({ type: 'error', code: 'excel_parse_error', detail: normalized.message })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fileName, filePath, refreshKey])

  if (status.type === 'loading') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <LoadingState label={t('common.loading')} />
      </div>
    )
  }

  if (status.type === 'empty') {
    return (
      <div className="h-full w-full bg-background">
        <EmptyState icon={FileSpreadsheet} title={t('agent.preview_pane.empty.title')} />
      </div>
    )
  }

  if (status.type === 'error') {
    return (
      <div className="h-full w-full bg-background">
        <EmptyState
          icon={AlertCircle}
          title={t('common.error')}
          description={getExcelPreviewErrorDescription(t, status.code, status.detail)}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <ExcelWorkbookView
        ariaLabel={fileName ?? filePath}
        className="min-h-0 flex-1"
        onError={handleWorkbookError}
        readOnly
        tables={status.tables}
        workbookData={status.workbookData}
      />
    </div>
  )
}

export default ExcelPreview
