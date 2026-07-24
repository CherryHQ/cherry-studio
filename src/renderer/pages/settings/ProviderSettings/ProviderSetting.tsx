import Scrollbar from '@renderer/components/Scrollbar'
import { useProvider } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import { useCallback, useState } from 'react'

import ProviderHeader from './components/ProviderHeader'
import AuthenticationSection from './ConnectionSettings/AuthenticationSection'
import type {
  ConnectionModelDetectionEvent,
  ConnectionModelDetectionSignal
} from './ConnectionSettings/connectionModelDetection'
import { useProviderOnboardingAutoEnable } from './hooks/providerSetting/useProviderOnboardingAutoEnable'
import { ModelList, ModelListHealthProvider, useModelListHealth } from './ModelList'
import { providerDetailColumnClasses, ProviderSettingsContainer } from './primitives/ProviderSettingsPrimitives'

interface ProviderSettingProps {
  providerId: string
  isOnboarding?: boolean
}

function ProviderSettingSections({ providerId }: { providerId: string }) {
  const health = useModelListHealth()
  const [connectionModelDetectionSignal, setConnectionModelDetectionSignal] =
    useState<ConnectionModelDetectionSignal | null>(null)
  const handleConnectionModelDetection = useCallback((event: ConnectionModelDetectionEvent) => {
    setConnectionModelDetectionSignal((current) => ({ ...event, version: (current?.version ?? 0) + 1 }))
  }, [])

  return (
    <Scrollbar className={providerDetailColumnClasses.scrollStrip}>
      <div className={providerDetailColumnClasses.sectionStack}>
        <AuthenticationSection
          providerId={providerId}
          onOpenModelHealthCheck={health.openHealthCheck}
          onConnectionModelDetection={handleConnectionModelDetection}
        />
        <ModelList providerId={providerId} connectionModelDetectionSignal={connectionModelDetectionSignal} />
      </div>
    </Scrollbar>
  )
}

export default function ProviderSetting({ providerId, isOnboarding = false }: ProviderSettingProps) {
  const { provider } = useProvider(providerId)
  const { theme } = useTheme()

  useProviderOnboardingAutoEnable({
    providerId,
    isOnboarding
  })

  if (!provider) {
    return null
  }

  return (
    <ProviderSettingsContainer theme={theme}>
      <div className="flex h-full min-h-0 w-full flex-col">
        <div data-testid="provider-detail-shell" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className={providerDetailColumnClasses.headerPad}>
            <div className={providerDetailColumnClasses.headerContentMaxWidth}>
              <ProviderHeader providerId={providerId} />
            </div>
          </div>
          <ModelListHealthProvider providerId={providerId}>
            <ProviderSettingSections providerId={providerId} />
          </ModelListHealthProvider>
        </div>
      </div>
    </ProviderSettingsContainer>
  )
}
