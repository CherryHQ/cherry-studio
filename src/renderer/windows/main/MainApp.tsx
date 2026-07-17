import { usePreference } from '@data/hooks/usePreference'
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
import { useStorageMonitorNotification } from '@renderer/hooks/useStorageMonitorNotification'
import { useWindowRuntime } from '@renderer/hooks/useWindowRuntime'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { useEffect } from 'react'

import { useAppUpdateHandler } from './hooks/useAppUpdateHandler'
import { useTopicNamingErrorNotification } from './hooks/useTopicNamingErrorNotification'
import OnboardingPage from './onboarding/OnboardingPage'

const logger = loggerService.withContext('MainApp')

function useMcpStaleToolsWarning(): void {
  useEffect(() => {
    return ipcApi.on('mcp.server.tools_stale', ({ serverId, serverName, toolCount }) => {
      logger.warn('MCP server tools are stale', { serverId, serverName, toolCount })
      toast.warning(i18n.t('mcp.warning.tools_stale', { serverName, toolCount }))
    })
  }, [])
}

// Behavior leaf inside the providers: the shared window runtime plus the main-only
// concerns, then the popup/toast hosts. It sits inside the providers but outside every
// TabRouter/<Activity>, so these window-scoped subscriptions and DOM sync are never
// torn down when a background tab hides.
//
// useAppUpdateHandler / useStorageMonitorNotification / useTopicNamingErrorNotification are
// intentionally main-only (update events only reach the main window; the storage warning and
// topic-naming-failed toast must not duplicate across windows) and intentionally React hooks:
// they depend on React-visible
// cache/toast state and manage their own effect cleanup, and the renderer has no
// service lifecycle container, so a service would only add manual start/stop.
//
// Headless: it runs hooks and renders nothing. The popup/toast hosts are explicit
// siblings in the App JSX below, so a window's host composition is visible there.
function MainWindowRuntime(): null {
  useWindowRuntime()
  useMcpStaleToolsWarning()

  // Main-only: tear down the HTML boot spinner and end the `init` timer. Both are
  // paired with markup only main/index.html creates (`#spinner`, `console.time`), so
  // this must never run in another window.
  useEffect(() => {
    document.getElementById('spinner')?.remove()
    // Paired with `console.time('init')` in index.html's bootstrap script; a DevTools
    // timer for dev DX, not a production log — loggerService is not apt.
    // eslint-disable-next-line no-restricted-syntax
    console.timeEnd('init')
  }, [])

  useAppUpdateHandler()
  useStorageMonitorNotification()
  useTopicNamingErrorNotification()

  return null
}

export function MainWindowContent(): React.ReactElement {
  const [providerSetupStatus, setProviderSetupStatus] = usePreference('app.onboarding.provider_setup.status')

  if (providerSetupStatus === 'pending') {
    return (
      <>
        <OnboardingPage onComplete={setProviderSetupStatus} />
        <MainWindowRuntime />
        <PopupHost />
        <ToastHost />
      </>
    )
  }

  return (
    <TabsProvider>
      <AppShell />
      <MainWindowRuntime />
      <PopupHost />
      <ToastHost />
    </TabsProvider>
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
              <MainWindowContent />
            </CommandProvider>
          </CommandContextKeyProvider>
        </CodeStyleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default MainApp
