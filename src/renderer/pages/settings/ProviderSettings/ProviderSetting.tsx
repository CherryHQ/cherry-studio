import Scrollbar from '@renderer/components/Scrollbar'
import { useProvider } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import { cn } from '@renderer/utils/style'
import { isLoginBasedProvider } from '@shared/utils/provider'
import { useCallback, useState } from 'react'

import ProviderHeader from './components/ProviderHeader'
import AuthenticationSection from './ConnectionSettings/AuthenticationSection'
import { useProviderOnboardingAutoEnable } from './hooks/providerSetting/useProviderOnboardingAutoEnable'
import { ModelList, ModelListHealthProvider, useModelListHealth } from './ModelList'
import { providerDetailColumnClasses, ProviderSettingsContainer } from './primitives/ProviderSettingsPrimitives'

interface ProviderSettingProps {
  providerId: string
  isOnboarding?: boolean
}

function ProviderSettingSections({
  providerId,
  isLoginBased,
  allowManualModelAdd
}: {
  providerId: string
  isLoginBased: boolean
  allowManualModelAdd: boolean
}) {
  const health = useModelListHealth()
  const [modelPullGuideVersion, setModelPullGuideVersion] = useState(0)
  const requestModelPullGuide = useCallback(() => {
    setModelPullGuideVersion((version) => version + 1)
  }, [])

  const authenticationSection = (
    <AuthenticationSection
      providerId={providerId}
      onOpenModelHealthCheck={health.openHealthCheck}
      onRequestModelPullGuide={requestModelPullGuide}
    />
  )

  return (
    <Scrollbar className={providerDetailColumnClasses.scrollStrip}>
      <div className={cn(providerDetailColumnClasses.sectionStack, isLoginBased && 'gap-3')}>
        {authenticationSection}
        <div className="flex min-h-0 flex-1 flex-col">
          <ModelList
            providerId={providerId}
            modelPullGuideVersion={modelPullGuideVersion}
            allowManualModelAdd={allowManualModelAdd}
          />
        </div>
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
            <ProviderSettingSections
              providerId={providerId}
              isLoginBased={isLoginBasedProvider(provider)}
              allowManualModelAdd={provider.id !== 'cherryin'}
            />
          </ModelListHealthProvider>
        </div>
      </div>
    </ProviderSettingsContainer>
  )
}
