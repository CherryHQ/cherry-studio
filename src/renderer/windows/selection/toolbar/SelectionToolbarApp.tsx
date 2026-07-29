import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { LanguageDirectionProvider } from '@renderer/components/LanguageDirectionProvider'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import { WindowFatalFallback } from '@renderer/components/WindowFatalFallback'
import { useCustomCss } from '@renderer/hooks/useCustomCss'
import type { FC } from 'react'

import SelectionToolbar from './SelectionToolbar'

// Runtime leaf: the same custom CSS used by every regular window.
// No dayjs sync — light window (dayjs lives in useWindowRuntime, main/sub only).
function SelectionToolbarRuntime(): null {
  useCustomCss()
  return null
}

const SelectionToolbarApp: FC = () => {
  return (
    // The boundary must stay the ANCESTOR of the provider so a provider throwing
    // during render falls back instead of white-screening.
    <ErrorBoundary fallbackComponent={WindowFatalFallback}>
      <LanguageDirectionProvider>
        <ThemeProvider>
          <SelectionToolbarRuntime />
          <SelectionToolbar />
        </ThemeProvider>
      </LanguageDirectionProvider>
    </ErrorBoundary>
  )
}

export default SelectionToolbarApp
