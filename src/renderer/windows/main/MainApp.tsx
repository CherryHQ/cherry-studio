import { loggerService } from '@logger'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { AppShell } from '@renderer/components/layout/AppShell'
import { TabsProvider } from '@renderer/components/layout/TabsProvider'
import { PopupHost } from '@renderer/components/PopupHost'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import ToastHost from '@renderer/components/ToastHost'
import { WindowFatalFallback } from '@renderer/components/WindowFatalFallback'
import { useAppInit } from '@renderer/hooks/useAppInit'
import { useStorageMonitorNotification } from '@renderer/hooks/useStorageMonitorNotification'

import { useAppUpdateHandler } from './hooks/useAppUpdateHandler'

const logger = loggerService.withContext('MainApp')

// Behavior leaf inside the providers: runs the shared per-window init plus the
// main-only app-update and storage-monitor hooks, and mounts the popup/toast hosts.
// App-update events only reach the main window and the storage warning must not
// duplicate across windows, so those two hooks live here, not in useAppInit.
//
// REFACTOR(window-runtime-init): the three hooks below are the next refactor target —
// a mix of one-shot bootstrap, main-only event->notification subscribers, and
// genuinely reactive effects, all still expressed as React side-effect hooks. Target:
// move bootstrap to a per-window bootstrap seam, the subscribers to a notification
// layer, and let subsystem-owned hooks keep the rest — leaving this leaf to just
// render the hosts. Grep "window-runtime-init" for the cluster.
function MainWindowRuntime(): React.ReactElement {
  useAppInit()
  useAppUpdateHandler()
  useStorageMonitorNotification()

  return (
    <>
      <PopupHost />
      <ToastHost />
    </>
  )
}

function MainApp(): React.ReactElement {
  logger.info('MainApp initialized')

  return (
    // The boundary must stay the ANCESTOR of every provider so a provider throwing
    // during render (e.g. reading preferences) falls back instead of white-screening.
    <ErrorBoundary fallbackComponent={WindowFatalFallback}>
      <ThemeProvider>
        <CodeStyleProvider>
          <CommandContextKeyProvider>
            <CommandProvider>
              <TabsProvider>
                <AppShell />
                <MainWindowRuntime />
              </TabsProvider>
            </CommandProvider>
          </CommandContextKeyProvider>
        </CodeStyleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default MainApp
