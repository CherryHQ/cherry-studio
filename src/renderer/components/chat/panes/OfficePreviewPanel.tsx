import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat'
import { ipcApi } from '@renderer/ipc'
import type { OfficePreviewRenderResult } from '@shared/ipc/schemas/officePreview'
import { AlertCircle } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('OfficePreviewPanel')

interface OfficePreviewPanelProps {
  workspacePath: string
  filePath: string
  refreshKey: number
  actions?: ReactNode
}

function getOfficePreviewErrorMessageKey(
  code: Extract<OfficePreviewRenderResult, { status: 'error' }>['code']
): string {
  switch (code) {
    case 'file_too_large':
      return 'agent.preview_pane.office.errors.file_too_large'
    case 'file_unavailable':
      return 'agent.preview_pane.office.errors.file_unavailable'
    case 'invalid_request':
      return 'agent.preview_pane.office.errors.invalid_request'
    case 'parse_failed':
      return 'agent.preview_pane.office.errors.parse_failed'
    case 'parse_timeout':
      return 'agent.preview_pane.office.errors.parse_timeout'
    case 'unsupported_extension':
      return 'agent.preview_pane.office.errors.unsupported_extension'
  }
}

export default function OfficePreviewPanel({ workspacePath, filePath, refreshKey, actions }: OfficePreviewPanelProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<OfficePreviewRenderResult | null>(null)
  const [requestError, setRequestError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setResult(null)
    setRequestError(null)

    void (async () => {
      try {
        const preview = await ipcApi.request('office_preview.render', { workspacePath, filePath })
        if (!cancelled) setResult(preview)
      } catch (error) {
        if (cancelled) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to render Office preview', normalized)
        setRequestError(normalized)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [filePath, refreshKey, workspacePath])

  const previewDocument = useMemo(() => {
    if (result?.status !== 'ready') return ''
    return result.html
  }, [result])

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

  if (result?.status === 'error') {
    return (
      <EmptyState
        icon={AlertCircle}
        title={t('agent.preview_pane.office.error_title')}
        description={t(getOfficePreviewErrorMessageKey(result.code))}
        actions={actions}
      />
    )
  }

  return (
    <div
      className="relative h-full min-h-0 w-full overflow-hidden bg-background"
      data-testid="office-preview-frame"
      data-office-preview-type={result?.type}>
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
