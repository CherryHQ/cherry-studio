import type { FC } from 'react'
import { useEffect } from 'react'

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
function DismissOnFatalError(): null {
  useEffect(() => {
    void ipcApi.request('screenshot.cancel')
  }, [])
  return null
}

const ScreenshotApp: FC = () => {
  return (
    // The boundary must stay the ANCESTOR of the provider so a provider throwing
    // during render falls back instead of white-screening.
    <ErrorBoundary fallbackComponent={DismissOnFatalError}>
      <ThemeProvider>
        <ScreenshotRuntime />
        <CaptureOverlay />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default ScreenshotApp
