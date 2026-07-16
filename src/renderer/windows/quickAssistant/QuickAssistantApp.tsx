import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { PopupHost } from '@renderer/components/PopupHost'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import ToastHost from '@renderer/components/ToastHost'
import { WindowFatalFallback } from '@renderer/components/WindowFatalFallback'
import { useCustomCss } from '@renderer/hooks/useCustomCss'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'

import HomeWindow from './home/HomeWindow'

// Headless runtime leaf inside the providers: this window's language + custom-CSS
// owners (moved out of HomeWindow's business logic). No dayjs sync — this light window
// has no localized-date consumer (dayjs lives in useWindowRuntime, main/sub only). It
// renders nothing; HomeWindow and the popup/toast hosts are explicit siblings in the
// App JSX below. The <ToastHost/> there renders the toast viewport this window
// previously lacked (the toast black hole), so translate/copy toasts are visible.
function QuickAssistantRuntime(): null {
  useLanguageSync()
  useCustomCss()

  return null
}

/**
 * No Redux `<Provider>` — the quick-assistant window intentionally stays
 * Redux-Provider-free (continuation of b5343606a). Downstream assistant/model
 * data now comes from the v2 Preference + DataApi layer (`usePreference`,
 * `useQuery('/models/:id')` via assistant hooks / `useDefaultModel`), so
 * there is no dependency on Redux rehydration and no `<PersistGate>` is needed.
 *
 * Why not migrate further to DataApi `useQuery('/assistants/:id')`: see the
 * design note above `currentAssistant` in HomeWindow.
 */
function QuickAssistantApp(): React.ReactElement {
  return (
    // Outer boundary: ancestor of the providers, so a provider throwing during render
    // falls back to the context-free fatal fallback instead of white-screening.
    <ErrorBoundary fallbackComponent={WindowFatalFallback}>
      <ThemeProvider>
        <CodeStyleProvider>
          <QuickAssistantRuntime />
          {/* Inner boundary wraps ONLY the L3 content: this window renders AI output
              (which can be malformed), so a content render crash shows a themed error
              card while the window runtime and popup/toast hosts (siblings, outside this
              boundary) keep running. This window has no TabRouter, so unlike
              main/subWindow it can't rely on the per-tab RouteErrorFallback here. */}
          <ErrorBoundary>
            <HomeWindow showRestoreMain />
          </ErrorBoundary>
          <PopupHost />
          <ToastHost />
        </CodeStyleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default QuickAssistantApp
