import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import { WindowFatalFallback } from '@renderer/components/WindowFatalFallback'
import type { FC } from 'react'

import SelectionToolbar from './SelectionToolbar'

const SelectionToolbarApp: FC = () => {
  return (
    // The boundary must stay the ANCESTOR of the provider so a provider throwing
    // during render falls back instead of white-screening.
    <ErrorBoundary fallbackComponent={WindowFatalFallback}>
      <ThemeProvider>
        <SelectionToolbar />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default SelectionToolbarApp
