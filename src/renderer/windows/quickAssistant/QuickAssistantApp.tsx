import { PortalContainerProvider } from '@cherrystudio/ui'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { DictationShortcutHost } from '@renderer/components/DictationShortcutHost'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { PopupHost } from '@renderer/components/PopupHost'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import ToastHost from '@renderer/components/ToastHost'
import { VoicePlaybackHost } from '@renderer/components/VoicePlaybackHost'
import { WindowFatalFallback } from '@renderer/components/WindowFatalFallback'
import { useAutoReadPreferenceSync } from '@renderer/hooks/useAutoReadPreferenceSync'
import { useCustomCss } from '@renderer/hooks/useCustomCss'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'

import QuickAssistantView from './QuickAssistantView'

// Headless runtime leaf inside the providers: this window's language + custom-CSS
// owners. No dayjs sync — this light window has no localized-date consumer (dayjs lives
// in useWindowRuntime, main/sub only). It renders nothing; the view and the popup/toast
// hosts are explicit siblings in the App JSX below.
function QuickAssistantRuntime(): null {
  useLanguageSync()
  useAutoReadPreferenceSync()
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
 */
function QuickAssistantApp(): React.ReactElement {
  return (
    // Outer boundary: ancestor of the providers, so a provider throwing during render
    // falls back to the context-free fatal fallback instead of white-screening.
    <ErrorBoundary fallbackComponent={WindowFatalFallback}>
      <ThemeProvider>
        <PortalContainerProvider container={document.body}>
          <CodeStyleProvider>
            <QuickAssistantRuntime />
            {/* Inner boundary wraps ONLY the L3 content: this window renders AI output
              (which can be malformed), so a content render crash shows a themed error
              card while the window runtime and popup/toast hosts (siblings, outside this
              boundary) keep running. This window has no TabRouter, so unlike
              main/subWindow it can't rely on the per-tab RouteErrorFallback here. */}
            <ErrorBoundary>
              {/* The composer's "/" and "@" panels render through this host. */}
              <QuickPanelProvider>
                <QuickAssistantView />
              </QuickPanelProvider>
            </ErrorBoundary>
            <PopupHost />
            <ToastHost />
            <DictationShortcutHost />
            <VoicePlaybackHost />
          </CodeStyleProvider>
        </PortalContainerProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default QuickAssistantApp
