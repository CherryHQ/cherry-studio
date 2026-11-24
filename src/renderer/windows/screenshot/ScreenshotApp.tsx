import type { FC } from 'react'
import { useEffect } from 'react'
import type { FallbackProps } from 'react-error-boundary'

import { loggerService } from '@logger'
import { AppErrorRuntime } from '@renderer/components/AppErrorRuntime'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'
import { ipcApi } from '@renderer/ipc'
import { createAppErrorContext, stringifyThrown } from '@shared/utils/appError'

import CaptureOverlay from './CaptureOverlay'

// Language sync only: a pooled overlay outlives many sessions and would keep its
// creation-time language. No `useCustomCss` on purpose — see windows/README.md.
function ScreenshotRuntime(): null {
  useLanguageSync()
  return null
}

/** Main ends the session before presenting, so the fallback never depends on this renderer surviving. */
export async function dismissScreenshotFault(error: unknown): Promise<void> {
  const context = createAppErrorContext({
    source: 'screenshotWindow',
    operation: 'react.render',
    message: error instanceof Error ? error.message : stringifyThrown(error),
    ...(error instanceof Error ? { name: error.name, ...(error.stack ? { stack: error.stack } : {}) } : {})
  })
  try {
    await ipcApi.request('screenshot.fail', context)
  } catch (failError) {
    loggerService.withContext('ScreenshotApp').error('Failed to report a screenshot error', failError as Error)
  }
}

/**
 * End the session instead of rendering an error card.
 *
 * The shared `WindowFatalFallback` is wrong here: this window covers every display and
 * swallows every click, and its "reload" reloads the main window. Anything it could show
 * would be an opaque full-screen panel with no way out, so the only useful thing a fatal
 * render error can do is get the overlay off the user's screen.
 */
function DismissOnFatalError({ error }: FallbackProps): null {
  useEffect(() => {
    void dismissScreenshotFault(error)
  }, [error])
  return null
}

const ScreenshotApp: FC = () => {
  return (
    // The boundary must stay the ANCESTOR of the provider so a provider throwing
    // during render falls back instead of white-screening.
    <ErrorBoundary fallbackComponent={DismissOnFatalError}>
      <ThemeProvider>
        <AppErrorRuntime mode="handoff" />
        <ScreenshotRuntime />
        <CaptureOverlay />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default ScreenshotApp
