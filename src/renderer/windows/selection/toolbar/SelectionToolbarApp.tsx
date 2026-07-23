import { usePreference } from '@data/hooks/usePreference'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import { WindowFatalFallback } from '@renderer/components/WindowFatalFallback'
import { useCustomCssInjection } from '@renderer/hooks/useCustomCss'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'
import type { FC } from 'react'

import SelectionToolbar from './SelectionToolbar'
import { stripBackgroundCss } from './stripBackgroundCss'

// Runtime leaf: language sync + custom CSS with background declarations filtered out
// (the chromeless toolbar's own transparency must win — its custom-CSS variant). No
// dayjs sync — light window (dayjs lives in useWindowRuntime, main/sub only).
function SelectionToolbarRuntime(): null {
  const [customCss] = usePreference('ui.custom_css_v2')
  useLanguageSync()
  useCustomCssInjection(stripBackgroundCss(customCss))
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
