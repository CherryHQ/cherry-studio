import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Scrollbar } from '@cherrystudio/ui'
import CopyButton from '@renderer/components/CopyButton'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { diagnosticReportUrl } from '@shared/utils/diagnostics'

import { DIAGNOSTIC_STATUS_TRANSLATION_KEYS } from './diagnosticStatusLabels'

const logger = loggerService.withContext('DiagnosticHistoryDialog')
const PAGE_SIZE = 20

interface DiagnosticHistoryDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function DiagnosticHistoryDialog({ open, onOpenChange }: DiagnosticHistoryDialogProps) {
  const { t, i18n } = useTranslation()
  const [page, setPage] = useState(1)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(false)
  const { data, error, isLoading, isRefreshing, refetch } = useQuery('/diagnostic-reports', {
    query: { page, limit: PAGE_SIZE },
    enabled: open
  })
  const reportIdsKey = JSON.stringify(data?.items.map((item) => item.reportId) ?? [])
  const hasReports = (data?.items.length ?? 0) > 0
  const queryBusy = isLoading || isRefreshing

  useDataChange(open ? '/diagnostic-reports' : [], () => void refetch())

  const refreshPage = useCallback(async () => {
    const reportIds = JSON.parse(reportIdsKey) as string[]
    if (reportIds.length === 0) return
    setRefreshing(true)
    setRefreshError(false)
    try {
      const results = await Promise.allSettled(
        reportIds.map((reportId) => ipcApi.request('diagnostics.report.refresh', { reportId }))
      )
      await refetch()
      if (results.some((result) => result.status === 'rejected')) {
        logger.warn('Some diagnostic status lookups failed')
        setRefreshError(true)
      }
    } catch {
      setRefreshError(true)
    } finally {
      setRefreshing(false)
    }
  }, [reportIdsKey, refetch])

  useEffect(() => {
    if (open && hasReports) void refreshPage()
  }, [open, hasReports, reportIdsKey, refreshPage])

  const openReport = async (url: string) => {
    try {
      await ipcApi.request('system.shell.open_website', url)
    } catch {
      logger.warn('Failed to open diagnostic status page')
      toast.error(t('settings.about.diagnostics.report.open_failed'))
    }
  }

  const formatDate = (timestamp: number) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(timestamp)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="flex flex-row items-center justify-between px-6 pt-6 pr-12 pb-4">
          <DialogTitle>{t('settings.about.feedback.history.title')}</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            disabled={refreshing || queryBusy || !hasReports}
            onClick={() => void refreshPage()}>
            <RefreshCw className="size-4" />
          </Button>
        </DialogHeader>
        <Scrollbar className="min-h-0 px-6 py-2">
          {error ? <Alert type="error" showIcon message={t('settings.about.feedback.history.load_failed')} /> : null}
          {refreshError ? (
            <Alert type="warning" showIcon message={t('settings.about.feedback.history.refresh_failed')} />
          ) : null}
          {isLoading ? <p role="status">{t('settings.about.feedback.history.loading')}</p> : null}
          {!isLoading && !error && data?.items.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground text-sm">
              {t('settings.about.feedback.history.empty')}
            </p>
          ) : null}
          <ul className="divide-y divide-border-subtle">
            {data?.items.map((report) => {
              const url = diagnosticReportUrl(report.reportId)
              return (
                <li key={report.reportId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="break-all text-sm">{report.reportId}</code>
                      <Badge variant="secondary">
                        {t(DIAGNOSTIC_STATUS_TRANSLATION_KEYS[report.processingStatus ?? 'unavailable'])}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {formatDate(report.submittedAt)}
                      {report.lastCheckedAt
                        ? ` | ${t('settings.about.feedback.history.checked')} ${formatDate(report.lastCheckedAt)}`
                        : ''}
                    </p>
                  </div>
                  <CopyButton textToCopy={url} aria-label={t('settings.about.diagnostics.report.copy_url')} />
                  <Button variant="link" size="sm" onClick={() => void openReport(url)}>
                    {t('settings.about.feedback.history.open')}
                  </Button>
                </li>
              )
            })}
          </ul>
        </Scrollbar>
        {data && data.total > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-border-subtle px-6 py-3 text-muted-foreground text-sm">
            <span>{`${page} / ${Math.ceil(data.total / PAGE_SIZE)}`}</span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('settings.about.feedback.history.previous')}
                disabled={refreshing || queryBusy || page === 1}
                onClick={() => setPage(page - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('settings.about.feedback.history.next')}
                disabled={refreshing || queryBusy || page * PAGE_SIZE >= data.total}
                onClick={() => setPage(page + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export default DiagnosticHistoryDialog
