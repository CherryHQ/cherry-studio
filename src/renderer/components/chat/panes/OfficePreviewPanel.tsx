import '@univerjs/preset-sheets-core/lib/index.css'

import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat/primitives'
import { ipcApi } from '@renderer/ipc'
import { IpcError } from '@shared/ipc/errors'
import { officePreviewErrorCodes } from '@shared/ipc/errors/officePreview'
import type { UniverWorkbookSnapshot } from '@shared/ipc/schemas/officePreview'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import sheetsCoreLocaleEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import { createUniver, defaultTheme, type IWorkbookData, LocaleType } from '@univerjs/presets'
import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('OfficePreviewPanel')

interface OfficePreviewPanelProps {
  workspacePath: string
  filePath: string
  refreshKey: number
  actions?: ReactNode
}

type PreviewState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; error: Error }

function getErrorDescriptionKey(error: Error): string {
  if (!(error instanceof IpcError)) return ''

  switch (error.code) {
    case officePreviewErrorCodes.FILE_TOO_LARGE:
      return 'agent.preview_pane.excel.errors.file_too_large'
    case officePreviewErrorCodes.FILE_UNAVAILABLE:
      return 'agent.preview_pane.unavailable.description'
    case officePreviewErrorCodes.INVALID_REQUEST:
      return 'agent.preview_pane.excel.errors.invalid_request'
    case officePreviewErrorCodes.PARSE_FAILED:
      return 'agent.preview_pane.excel.errors.parse_failed'
    case officePreviewErrorCodes.UNSUPPORTED_EXTENSION:
      return 'agent.preview_pane.excel.errors.unsupported_extension'
    default:
      return ''
  }
}

function createWorkbook(container: HTMLElement, workbook: UniverWorkbookSnapshot) {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: sheetsCoreLocaleEnUS
    },
    theme: defaultTheme,
    presets: [
      UniverSheetsCorePreset({
        container,
        contextMenu: false,
        disableAutoFocus: true,
        formulaBar: false,
        header: false,
        toolbar: false
      })
    ]
  })

  univerAPI.createWorkbook(workbook as Partial<IWorkbookData>)
  return univer
}

export default function OfficePreviewPanel({ workspacePath, filePath, refreshKey, actions }: OfficePreviewPanelProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [previewState, setPreviewState] = useState<PreviewState>({ status: 'loading' })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let univer: { dispose: () => void } | null = null
    setPreviewState({ status: 'loading' })
    container.replaceChildren()

    void (async () => {
      try {
        const result = await ipcApi.request('office_preview.render', { workspacePath, filePath })
        if (cancelled) return

        univer = createWorkbook(container, result.workbook)
        if (!cancelled) setPreviewState({ status: 'ready' })
      } catch (err) {
        if (cancelled) return
        const error = err instanceof Error ? err : new Error(String(err))
        logger.error('Failed to render Office preview', error)
        setPreviewState({ status: 'error', error })
      }
    })()

    return () => {
      cancelled = true
      univer?.dispose()
      container.replaceChildren()
    }
  }, [filePath, refreshKey, workspacePath])

  const errorDescriptionKey = previewState.status === 'error' ? getErrorDescriptionKey(previewState.error) : undefined
  const errorDescription =
    previewState.status === 'error'
      ? errorDescriptionKey
        ? t(errorDescriptionKey)
        : previewState.error.message
      : undefined

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-card" data-office-preview-panel>
      <div ref={containerRef} className="h-full w-full" data-office-preview-container />
      {actions && previewState.status !== 'error' && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md border border-border-subtle bg-card/95 p-1 shadow-sm">
          {actions}
        </div>
      )}
      {previewState.status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-card">
          <LoadingState label={t('common.loading')} />
        </div>
      )}
      {previewState.status === 'error' && (
        <div className="absolute inset-0 bg-card">
          <EmptyState icon={AlertCircle} title={t('common.error')} description={errorDescription} actions={actions} />
        </div>
      )}
    </div>
  )
}
