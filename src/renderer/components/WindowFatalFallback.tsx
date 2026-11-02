import { useEffect, useRef, useState } from 'react'
import type { FallbackProps } from 'react-error-boundary'

import { Alert, Button } from '@cherrystudio/ui'
import { ErrorFallbackDetails } from '@renderer/components/ErrorFallbackDetails'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { formatErrorDetails } from '@renderer/utils/errorDetails'

const RELEASES_URL = 'https://github.com/CherryHQ/cherry-studio/releases'
const FEEDBACK_URL = 'mailto:support@cherry-ai.com?subject=Cherry%20Studio%20Feedback'

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
  const [exporting, setExporting] = useState(false)
  const faultRef = useRef({
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    source: 'renderer',
    operation: 'react.render',
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error ? { name: error.name, ...(error.stack ? { stack: error.stack } : {}) } : {})
  })
  // The main window's boot spinner is normally removed by the main-only ready effect
  // in MainWindowRuntime, a leaf inside the provider stack; when a provider throws it
  // never runs, and the leftover fixed full-viewport overlay would block clicks here.
  useEffect(() => {
    document.getElementById('spinner')?.remove()
  }, [])

  const run = (action: () => Promise<unknown>) => {
    void action().catch(() => {
      setActionError(i18n.t('error.boundary.action_failed'))
    })
  }

  const copyError = () => {
    const text = formatErrorDetails(error)
    const write = navigator.clipboard?.writeText(text)
    if (!write) {
      setActionError(i18n.t('error.boundary.action_failed'))
      return
    }
    run(() => write)
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 p-4">
      <Alert
        type="error"
        message={i18n.t('error.boundary.default.message')}
        description={<ErrorFallbackDetails error={error} />}
        className="max-w-xl"
      />
      <p className="max-w-xl text-center text-sm text-muted-foreground">
        {i18n.t('error.boundary.analysis_unavailable')}
      </p>
      {actionError ? (
        <p role="alert" className="max-w-xl text-center text-sm text-destructive">
          {actionError}
        </p>
      ) : null}
      <div className="flex max-w-xl flex-wrap items-center justify-center gap-2">
        <Button size="sm" onClick={copyError}>
          {i18n.t('error.boundary.copy')}
        </Button>
        <Button
          size="sm"
          disabled={exporting}
          onClick={() => {
            setExporting(true)
            setActionError(null)
            void ipcApi
              .request('diagnostics.bundle.export', {
                includeChatRecords: false,
                includeLogs: true,
                includeTraces: false,
                range: '24h',
                errorContext: faultRef.current
              })
              .then((result) => {
                if (result.status === 'busy') setActionError(i18n.t('error.boundary.export_busy'))
              })
              .catch(() => setActionError(i18n.t('error.boundary.action_failed')))
              .finally(() => setExporting(false))
          }}>
          {i18n.t('error.boundary.export')}
        </Button>
        <Button size="sm" onClick={() => run(() => ipcApi.request('system.shell.open_external_website', FEEDBACK_URL))}>
          {i18n.t('error.boundary.feedback')}
        </Button>
        <Button size="sm" onClick={() => run(() => ipcApi.request('system.shell.open_external_website', RELEASES_URL))}>
          {i18n.t('error.boundary.releases')}
        </Button>
        <Button size="sm" onClick={() => run(() => ipcApi.request('system.toggle_dev_tools'))}>
          {i18n.t('error.boundary.default.devtools')}
        </Button>
        <Button size="sm" onClick={() => run(() => ipcApi.request('window.main.reload'))}>
          {i18n.t('error.boundary.default.reload')}
        </Button>
      </div>
    </div>
  )
}
