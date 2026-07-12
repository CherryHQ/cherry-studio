import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { PopupHost } from '@renderer/components/PopupHost'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import ToastHost from '@renderer/components/ToastHost'
import { WindowFatalFallback } from '@renderer/components/WindowFatalFallback'
import type { FC } from 'react'

import ActionWindow from './ActionWindow'

// <ToastHost/> renders the toast viewport with the current language's labels — this
// window previously used a label-less ToastProvider that always showed English.
const SelectionActionApp: FC = () => {
  return (
    // The boundary must stay the ANCESTOR of every provider so a provider throwing
    // during render falls back instead of white-screening.
    <ErrorBoundary fallbackComponent={WindowFatalFallback}>
      <ThemeProvider>
        <CodeStyleProvider>
          <ActionWindow />
          <PopupHost />
          <ToastHost />
        </CodeStyleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default SelectionActionApp
