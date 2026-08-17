import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import { WindowFatalFallback } from '@renderer/components/WindowFatalFallback'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'
import type { FC } from 'react'

import CaptureOverlay from './CaptureOverlay'

// Language sync only: a pooled overlay outlives many sessions and would keep its
// creation-time language. No `useCustomCss` on purpose — see windows/README.md.
function ScreenshotRuntime(): null {
  useLanguageSync()
  return null
}

const ScreenshotApp: FC = () => {
  return (
    // The boundary must stay the ANCESTOR of the provider so a provider throwing
    // during render falls back instead of white-screening.
    <ErrorBoundary fallbackComponent={WindowFatalFallback}>
      <ThemeProvider>
        <ScreenshotRuntime />
        <CaptureOverlay />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default ScreenshotApp
