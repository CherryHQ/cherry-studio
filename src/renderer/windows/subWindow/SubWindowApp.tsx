import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { TabsProvider } from '@renderer/components/layout/TabsProvider'
import { PopupHost } from '@renderer/components/PopupHost'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import ToastHost from '@renderer/components/ToastHost'
import { WindowFatalFallback } from '@renderer/components/WindowFatalFallback'
import { useAppInit } from '@renderer/hooks/useAppInit'
import { SubWindowAppShell } from '@renderer/windows/subWindow/SubWindowAppShell'

// Behavior leaf inside the providers: runs the shared per-window init and mounts
// the popup/toast hosts. The subWindow has no window-specific init hooks.
function SubWindowRuntime(): React.ReactElement {
  useAppInit()

  return (
    <>
      <PopupHost />
      <ToastHost />
    </>
  )
}

function SubWindowApp(): React.ReactElement {
  return (
    // The boundary must stay the ANCESTOR of every provider so a provider throwing
    // during render falls back instead of white-screening.
    <ErrorBoundary fallbackComponent={WindowFatalFallback}>
      <ThemeProvider>
        <CodeStyleProvider>
          <CommandContextKeyProvider>
            <CommandProvider>
              <TabsProvider initialDefaultTab={null} includePinnedTabs={false}>
                <SubWindowAppShell />
                <SubWindowRuntime />
              </TabsProvider>
            </CommandProvider>
          </CommandContextKeyProvider>
        </CodeStyleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default SubWindowApp
