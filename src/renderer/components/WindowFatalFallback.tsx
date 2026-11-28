import { AlertCircle, ChevronRight, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FallbackProps } from 'react-error-boundary'

import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { getAppEdition } from '@renderer/utils/appEdition'
import { formatErrorDetails } from '@renderer/utils/errorDetails'
import { isDev } from '@renderer/utils/platform'
import { createAppErrorContext, stringifyThrown } from '@shared/utils/appErrorSnapshot'
import { FEEDBACK_MAILTO, officialDownloadUrl } from '@shared/utils/officialLinks'

/**
 * Fallback for the top-level ErrorBoundary that wraps each window's provider stack.
 *
 * It renders after a provider crashed, so no React context exists here: translations
 * must go through the global i18n singleton (never `useTranslation`), and styling can
 * only rely on the unconditional `:root` token defaults — the fallback stays in the
 * light palette because ThemeProvider never got to apply the `dark` class.
 * Doctor analysis is unavailable on this side of the provider boundary.
 */
export const WindowFatalFallback = ({ error }: FallbackProps) => {
  const [actionError, setActionError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // Imported from the snapshot module: `@shared/utils/appError` would pull zod into every window.
  const [fault] = useState(() =>
    createAppErrorContext({
      source: 'renderer',
      operation: 'react.render',
      message: error instanceof Error ? error.message : stringifyThrown(error),
      ...(error instanceof Error ? { name: error.name, ...(error.stack ? { stack: error.stack } : {}) } : {})
    })
  )
  // The main window's boot spinner is normally removed by the main-only ready effect
  // in MainWindowRuntime, a leaf inside the provider stack; when a provider throws it
  // never runs, and the leftover fixed full-viewport overlay would block clicks here.
  useEffect(() => {
    document.getElementById('spinner')?.remove()
  }, [])

  const run = (action: () => Promise<unknown>, onSuccess?: () => void) => {
    setActionError(null)
    setCopied(false)
    void action().then(onSuccess, () => {
      setActionError(i18n.t('error.boundary.action_failed'))
    })
  }

  // No toast: the providers that host one may be the ones that crashed.
  const copyError = () =>
    run(
      async () => navigator.clipboard.writeText(formatErrorDetails(error)),
      () => setCopied(true)
    )

  const exportLogs = () => {
    setExporting(true)
    setActionError(null)
    setCopied(false)
    void ipcApi
      .request('diagnostics.bundle.export', {
        includeChatRecords: false,
        includeLogs: true,
        includeTraces: false,
        range: '24h',
        errorContext: fault
      })
      .then((result) => {
        if (result.status === 'busy') setActionError(i18n.t('error.boundary.export_busy'))
      })
      .catch(() => setActionError(i18n.t('error.boundary.action_failed')))
      .finally(() => setExporting(false))
  }

  const links = [
    { label: i18n.t('error.boundary.copy'), onClick: copyError },
    {
      label: i18n.t('error.boundary.feedback'),
      onClick: () => run(() => ipcApi.request('system.shell.open_external_website', FEEDBACK_MAILTO))
    },
    { label: i18n.t('error.boundary.export'), onClick: exportLogs, disabled: exporting },
    {
      label: i18n.t('error.update_banner.open_releases'),
      onClick: () =>
        run(() => ipcApi.request('system.shell.open_external_website', officialDownloadUrl(getAppEdition())))
    },
    ...(isDev
      ? [
          {
            label: i18n.t('error.boundary.default.devtools'),
            onClick: () => run(() => ipcApi.request('system.toggle_dev_tools'))
          }
        ]
      : [])
  ]

  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-auto bg-card p-3">
      <div
        role="alert"
        className="group grid w-full max-w-xl grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 rounded-lg border border-border-subtle bg-background-subtle px-3 py-2.5 text-foreground">
        <AlertCircle size={14} className="mt-[3px] text-error" />
        <div className="font-medium text-[13px] leading-5">{i18n.t('error.boundary.default.title')}</div>
        <div className="col-start-2 text-muted-foreground text-xs leading-[18px]">
          {i18n.t('error.boundary.default.info')}
        </div>
        <div className="col-start-2 mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-[5px] text-muted-foreground hover:border-border-strong hover:bg-accent hover:text-foreground"
            onClick={() => run(() => ipcApi.request('window.main.reload'))}>
            <RefreshCw size={13} />
            {i18n.t('error.boundary.default.reload')}
          </Button>
          <button
            type="button"
            aria-expanded={expanded}
            className="ml-auto inline-flex cursor-pointer items-center gap-0.5 text-foreground-tertiary text-xs hover:text-foreground group-hover:text-foreground"
            onClick={() => setExpanded((open) => !open)}>
            {i18n.t('common.detail')}
            <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} aria-hidden />
          </button>
        </div>
        {expanded ? (
          <div className="col-start-2 mt-2 flex flex-col gap-1.5 border-border-subtle border-t pt-2">
            <p className="line-clamp-3 select-text break-all font-mono text-[11px] text-muted-foreground leading-4">
              {error instanceof Error ? `${error.name}: ${error.message}` : stringifyThrown(error)}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-foreground-tertiary text-xs">
              {links.map((link) => (
                <button
                  key={link.label}
                  type="button"
                  disabled={link.disabled}
                  className="cursor-pointer hover:text-foreground disabled:cursor-default disabled:opacity-50"
                  onClick={link.onClick}>
                  {link.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {actionError ? (
          <p role="alert" className="col-start-2 mt-1 text-error text-xs">
            {actionError}
          </p>
        ) : null}
        {copied ? (
          <p role="status" className="col-start-2 mt-1 text-muted-foreground text-xs">
            {i18n.t('common.copied')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
