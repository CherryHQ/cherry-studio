import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { PopupHost } from '@renderer/components/PopupHost'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import ToastHost from '@renderer/components/ToastHost'
import { WindowFatalFallback } from '@renderer/components/WindowFatalFallback'
import { useCustomCss } from '@renderer/hooks/useCustomCss'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'
import type { FC } from 'react'

import ActionWindow from './ActionWindow'

// Runtime leaf: this window's language + custom-CSS owners, hoisted above
// ActionWindow's `if (!action) return null` guard so they sync whether or not an
// action is mounted. No dayjs sync — light window (dayjs lives in useWindowRuntime).
function SelectionActionRuntime(): null {
  useLanguageSync()
  useCustomCss()
  return null
}

// <ToastHost/> renders the toast viewport with the current language's labels — this
// window previously used a label-less ToastProvider that always showed English.
const SelectionActionApp: FC = () => {
  return (
    // Outer boundary: ancestor of the providers, so a provider throwing during render
    // falls back to the context-free fatal fallback instead of white-screening.
    <ErrorBoundary fallbackComponent={WindowFatalFallback}>
      <ThemeProvider>
        <CodeStyleProvider>
          <SelectionActionRuntime />
          {/* Inner boundary wraps ONLY the L3 content: this window renders AI output
              (which can be malformed), so a content render crash shows a themed error
              card while the window runtime and popup/toast hosts (siblings, outside this
              boundary) keep running. This window has no TabRouter, so unlike
              main/subWindow it can't rely on the per-tab RouteErrorFallback here. */}
          <ErrorBoundary>
            <ActionWindow />
          </ErrorBoundary>
          <PopupHost />
          <ToastHost />
        </CodeStyleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default SelectionActionApp
