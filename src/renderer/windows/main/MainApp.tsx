import { useMultiplePreferences } from '@data/hooks/usePreference'
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
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'
import { useEffect } from 'react'

import { useAppUpdateHandler } from './hooks/useAppUpdateHandler'
import { useTopicNamingErrorNotification } from './hooks/useTopicNamingErrorNotification'
import OnboardingPage from './onboarding/OnboardingPage'
import { PrivacyPolicyUpdateGate } from './privacy/PrivacyPolicyUpdateGate'

const logger = loggerService.withContext('MainApp')
const MAIN_WINDOW_PREFERENCE_KEYS = {
  providerSetupStatus: 'app.onboarding.provider_setup.status',
  dataCollectionEnabled: 'app.privacy.data_collection.enabled',
  policyVersion: 'app.privacy.policy_version'
} as const
const PESSIMISTIC_PREFERENCE_OPTIONS = { optimistic: false } as const

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
  const [{ providerSetupStatus, policyVersion }, updatePreferences] = useMultiplePreferences(
    MAIN_WINDOW_PREFERENCE_KEYS,
    PESSIMISTIC_PREFERENCE_OPTIONS
  )

  if (providerSetupStatus === 'pending') {
    return (
      <>
        <OnboardingPage
          onComplete={(status, onboardingDataCollectionEnabled) =>
            updatePreferences({
              policyVersion: LATEST_PRIVACY_POLICY_VERSION,
              dataCollectionEnabled: onboardingDataCollectionEnabled,
              providerSetupStatus: status
            })
          }
        />
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
      <PrivacyPolicyUpdateGate
        open={policyVersion !== LATEST_PRIVACY_POLICY_VERSION}
        onAcknowledge={() =>
          updatePreferences({
            dataCollectionEnabled: true,
            policyVersion: LATEST_PRIVACY_POLICY_VERSION
          })
        }
      />
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
