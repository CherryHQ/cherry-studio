import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import { WindowFatalFallback } from '@renderer/components/WindowFatalFallback'
import { useCustomCss } from '@renderer/hooks/useCustomCss'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'
import type { FC } from 'react'

import SelectionToolbar from './SelectionToolbar'

// Runtime leaf: language sync + the same custom CSS used by every regular window.
// No dayjs sync — light window (dayjs lives in useWindowRuntime, main/sub only).
function SelectionToolbarRuntime(): null {
  useLanguageSync()
  useCustomCss()
  return null
}

const SelectionToolbarApp: FC = () => {
  return (
    // The boundary must stay the ANCESTOR of the provider so a provider throwing
    // during render falls back instead of white-screening.
    <ErrorBoundary fallbackComponent={WindowFatalFallback}>
      <ThemeProvider>
        <SelectionToolbarRuntime />
        <SelectionToolbar />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default SelectionToolbarApp
