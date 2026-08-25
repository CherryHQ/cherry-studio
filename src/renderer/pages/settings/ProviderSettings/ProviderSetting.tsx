import Scrollbar from '@renderer/components/Scrollbar'
import { useProvider } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import { cn } from '@renderer/utils/style'
import { isLoginBasedProvider } from '@shared/utils/provider'
import { useCallback, useState } from 'react'

import ProviderHeader from './components/ProviderHeader'
import AuthenticationSection from './ConnectionSettings/AuthenticationSection'
import { ApiKeyProvider } from './hooks/providerSetting/useAuthenticationApiKey'
import { useProviderApiKey } from './hooks/providerSetting/useProviderApiKey'
import { useProviderOnboardingAutoEnable } from './hooks/providerSetting/useProviderOnboardingAutoEnable'
import { ModelList, ModelListHealthProvider } from './ModelList'
import { providerDetailColumnClasses, ProviderSettingsContainer } from './primitives/ProviderSettingsPrimitives'

interface ProviderSettingProps {
  providerId: string
  isOnboarding?: boolean
}

function ProviderSettingSections({ providerId, isLoginBased }: { providerId: string; isLoginBased: boolean }) {
  const [modelPullGuideVersion, setModelPullGuideVersion] = useState(0)
  const requestModelPullGuide = useCallback(() => {
    setModelPullGuideVersion((version) => version + 1)
  }, [])

  return (
    <Scrollbar className={providerDetailColumnClasses.scrollStrip}>
      <div className={cn(providerDetailColumnClasses.sectionStack, isLoginBased && 'gap-3')}>
        <AuthenticationSection providerId={providerId} onRequestModelPullGuide={requestModelPullGuide} />
        <div className="flex min-h-0 flex-1 flex-col">
          <ModelList providerId={providerId} modelPullGuideVersion={modelPullGuideVersion} />
        </div>
      </div>
    </Scrollbar>
  )
}

function ProviderSettingContent({ providerId, isLoginBased }: { providerId: string; isLoginBased: boolean }) {
  const apiKey = useProviderApiKey(providerId)

  return (
    <ApiKeyProvider value={apiKey}>
      <ModelListHealthProvider providerId={providerId}>
        <ProviderSettingSections providerId={providerId} isLoginBased={isLoginBased} />
      </ModelListHealthProvider>
    </ApiKeyProvider>
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
          <ProviderSettingContent providerId={providerId} isLoginBased={isLoginBasedProvider(provider)} />
        </div>
      </div>
    </ProviderSettingsContainer>
  )
}
