import type { FC } from 'react'
import { useEffect } from 'react'
import type { FallbackProps } from 'react-error-boundary'

import { loggerService } from '@logger'
import { AppErrorRuntime } from '@renderer/components/AppErrorRuntime'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'
import { ipcApi } from '@renderer/ipc'

import CaptureOverlay from './CaptureOverlay'

// Language sync only: a pooled overlay outlives many sessions and would keep its
// creation-time language. No `useCustomCss` on purpose — see windows/README.md.
function ScreenshotRuntime(): null {
  useLanguageSync()
  return null
}

/**
 * End the session instead of rendering an error card.
 *
 * The shared `WindowFatalFallback` is wrong here: this window covers every display and
 * swallows every click, and its "reload" reloads the main window. Anything it could show
 * would be an opaque full-screen panel with no way out, so the only useful thing a fatal
 * render error can do is get the overlay off the user's screen.
 */
/** Hand the fault to main and release the overlay before any native support dialog. */
export async function dismissScreenshotFault(error: unknown): Promise<void> {
  const logger = loggerService.withContext('ScreenshotApp')
  const message = error instanceof Error ? error.message : String(error)
  const context = {
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    source: 'screenshotWindow',
    operation: 'react.render',
    message,
    ...(error instanceof Error ? { name: error.name, ...(error.stack ? { stack: error.stack } : {}) } : {})
  }
  let handoffFailed = false
  try {
    await ipcApi.request('app.error.handoff', context)
  } catch (handoffError) {
    handoffFailed = true
    logger.error('Failed to hand off a screenshot error', handoffError as Error)
  }
  try {
    await ipcApi.request('screenshot.cancel')
  } catch (cancelError) {
    logger.error('Failed to dismiss the screenshot overlay', cancelError as Error)
  }
  if (!handoffFailed) return
  try {
    await ipcApi.request('app.error.degraded', context)
  } catch (degradedError) {
    logger.error('Failed to present a screenshot error locally', degradedError as Error)
  }
}

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
