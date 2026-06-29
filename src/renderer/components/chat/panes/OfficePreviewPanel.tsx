import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat'
import { ipcApi } from '@renderer/ipc'
import { IpcError } from '@shared/ipc/errors'
import {
  isOfficePreviewErrorCode,
  type OfficePreviewErrorCode,
  officePreviewErrorCodes
} from '@shared/ipc/errors/officePreview'
import type { OfficePreviewRenderResult } from '@shared/ipc/schemas/officePreview'
import { AlertCircle } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('OfficePreviewPanel')

interface OfficePreviewPanelProps {
  workspacePath: string
  filePath: string
  refreshKey: number
  actions?: ReactNode
}

function getOfficePreviewErrorMessageKey(code: OfficePreviewErrorCode): string {
  switch (code) {
    case officePreviewErrorCodes.CANCELLED:
      return 'agent.preview_pane.office.errors.cancelled'
    case officePreviewErrorCodes.FILE_TOO_LARGE:
      return 'agent.preview_pane.office.errors.file_too_large'
    case officePreviewErrorCodes.FILE_UNAVAILABLE:
      return 'agent.preview_pane.office.errors.file_unavailable'
    case officePreviewErrorCodes.INVALID_REQUEST:
      return 'agent.preview_pane.office.errors.invalid_request'
    case officePreviewErrorCodes.PARSE_FAILED:
      return 'agent.preview_pane.office.errors.parse_failed'
    case officePreviewErrorCodes.PARSE_TIMEOUT:
      return 'agent.preview_pane.office.errors.parse_timeout'
    case officePreviewErrorCodes.UNSUPPORTED_EXTENSION:
      return 'agent.preview_pane.office.errors.unsupported_extension'
  }
}

function createOfficePreviewRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function OfficePreviewPanel({ workspacePath, filePath, refreshKey, actions }: OfficePreviewPanelProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<OfficePreviewRenderResult | null>(null)
  const [errorCode, setErrorCode] = useState<OfficePreviewErrorCode | null>(null)
  const [requestError, setRequestError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    const requestId = createOfficePreviewRequestId()
    setLoading(true)
    setResult(null)
    setErrorCode(null)
    setRequestError(null)

    void (async () => {
      try {
        const preview = await ipcApi.request('office_preview.render', { workspacePath, filePath, requestId })
        if (!cancelled) setResult(preview)
      } catch (error) {
        if (cancelled) return
        if (error instanceof IpcError && isOfficePreviewErrorCode(error.code)) {
          setErrorCode(error.code)
          return
        }
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to render Office preview', normalized)
        setRequestError(normalized)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      ipcApi.request('office_preview.cancel', { requestId }).catch((error) => {
        logger.debug('Failed to cancel Office preview', error instanceof Error ? error : new Error(String(error)))
      })
    }
  }, [filePath, refreshKey, workspacePath])

  const previewDocument = result?.html ?? ''

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <LoadingState label={t('agent.preview_pane.office.loading')} />
      </div>
    )
  }

  if (requestError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={t('agent.preview_pane.office.error_title')}
        description={requestError.message}
        actions={actions}
      />
    )
  }

  if (errorCode) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={t('agent.preview_pane.office.error_title')}
        description={t(getOfficePreviewErrorMessageKey(errorCode))}
        actions={actions}
      />
    )
  }

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-background" data-testid="office-preview-frame">
      {actions ? <div className="absolute top-2 right-2 z-10 flex items-center gap-1">{actions}</div> : null}
      <iframe
        key={`${filePath}-${refreshKey}`}
        title={filePath}
        sandbox="allow-scripts"
        srcDoc={previewDocument}
        className="h-full w-full border-0 bg-background"
      />
    </div>
  )
}
