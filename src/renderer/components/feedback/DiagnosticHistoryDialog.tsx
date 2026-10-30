import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Item,
  Scrollbar,
  Skeleton,
  Tooltip
} from '@cherrystudio/ui'
import CopyButton from '@renderer/components/CopyButton'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { openExternalWebsite } from '@renderer/services/website'
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
      await openExternalWebsite(url)
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
        aria-describedby={undefined}
        className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="flex-row items-center gap-2 border-b border-border-subtle px-5 py-4 pr-12">
          <DialogTitle>{t('settings.about.feedback.history.title')}</DialogTitle>
        </DialogHeader>
        <Scrollbar className="min-h-0 px-5 py-4">
          <div className="space-y-3">
            {error ? <Alert type="error" showIcon message={t('settings.about.feedback.history.load_failed')} /> : null}
            {refreshError ? (
              <Alert type="warning" showIcon message={t('settings.about.feedback.history.refresh_failed')} />
            ) : null}
            {isLoading ? (
              <div role="status" className="space-y-3">
                <span className="sr-only">{t('settings.about.feedback.history.loading')}</span>
                {[0, 1, 2].map((index) => (
                  <Skeleton key={index} className="h-24 rounded-lg" />
                ))}
              </div>
            ) : null}
            {!isLoading && !error && data?.items.length === 0 ? (
              <EmptyState title={t('settings.about.feedback.history.empty')} className="py-10" />
            ) : null}
            {hasReports ? (
              <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
                {data?.items.map((report) => {
                  const url = diagnosticReportUrl(report.reportId)
                  return (
                    <Item
                      key={report.reportId}
                      asChild
                      className="relative flex-col items-stretch gap-1.5 rounded-none border-0 p-3">
                      <li>
                        <Tooltip
                          asChild
                          isDisabled={!report.lastCheckedAt}
                          content={
                            report.lastCheckedAt
                              ? `${t('settings.about.feedback.history.checked')} ${formatDate(report.lastCheckedAt)}`
                              : undefined
                          }>
                          <button
                            type="button"
                            className="absolute inset-0 cursor-pointer outline-none hover:bg-accent/50 focus-visible:bg-accent"
                            aria-label={`${t('settings.about.feedback.history.open')} ${report.reportId}`}
                            onClick={() => void openReport(url)}
                          />
                        </Tooltip>
                        <div className="pointer-events-none relative flex flex-wrap items-center justify-between gap-2">
                          <time dateTime={new Date(report.submittedAt).toISOString()} className="text-sm font-medium">
                            {formatDate(report.submittedAt)}
                          </time>
                          <Badge
                            variant="outline"
                            className="rounded-md bg-background-subtle font-normal text-muted-foreground">
                            {t(DIAGNOSTIC_STATUS_TRANSLATION_KEYS[report.processingStatus ?? 'unavailable'])}
                          </Badge>
                        </div>
                        <div className="pointer-events-none relative flex min-w-0 items-center gap-1">
                          <code
                            title={report.reportId}
                            className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                            {report.reportId}
                          </code>
                          <div className="pointer-events-auto shrink-0">
                            <Button
                              asChild
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground dark:text-muted-foreground">
                              <CopyButton
                                textToCopy={url}
                                tooltip={t('settings.about.diagnostics.report.copy_url')}
                                successFeedback="icon"
                              />
                            </Button>
                          </div>
                        </div>
                      </li>
                    </Item>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </Scrollbar>
        {data && data.total > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-border-subtle px-5 py-3 text-sm text-muted-foreground">
            <span className="tabular-nums">{`${page} / ${Math.ceil(data.total / PAGE_SIZE)}`}</span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('settings.about.feedback.history.previous')}
                disabled={refreshing || queryBusy || page === 1}
                onClick={() => setPage(page - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
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
