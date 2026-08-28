import Scrollbar from '@renderer/components/Scrollbar'
import { useProvider } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import { cn } from '@renderer/utils/style'
import { isLoginBasedProvider } from '@shared/utils/provider'
import { useCallback, useState } from 'react'

import ProviderHeader from './components/ProviderHeader'
import AuthenticationSection from './ConnectionSettings/AuthenticationSection'
import ProviderApiSetupDialog, { type ProviderApiSetupInitialStep } from './ConnectionSettings/ProviderApiSetupDialog'
import { ApiKeyProvider } from './hooks/providerSetting/useAuthenticationApiKey'
import { useProviderApiKey } from './hooks/providerSetting/useProviderApiKey'
import { ModelList, ModelListHealthProvider } from './ModelList'
import { providerDetailColumnClasses, ProviderSettingsContainer } from './primitives/ProviderSettingsPrimitives'

interface ProviderSettingProps {
  providerId: string
  initialApiSetupStep?: ProviderApiSetupInitialStep
  onApiSetupClosed?: () => void
}

function ProviderSettingSections({
  providerId,
  isLoginBased,
  initialApiSetupStep,
  onApiSetupClosed
}: {
  providerId: string
  isLoginBased: boolean
  initialApiSetupStep?: ProviderApiSetupInitialStep
  onApiSetupClosed?: () => void
}) {
  const [modelPullGuideVersion, setModelPullGuideVersion] = useState(0)
  const [apiSetupStep, setApiSetupStep] = useState<ProviderApiSetupInitialStep | null>(initialApiSetupStep ?? null)
  const requestModelPullGuide = useCallback(() => {
    setModelPullGuideVersion((version) => version + 1)
  }, [])
  const openApiSetup = useCallback((initialStep: ProviderApiSetupInitialStep) => setApiSetupStep(initialStep), [])
  const closeApiSetup = useCallback(() => {
    setApiSetupStep(null)
    onApiSetupClosed?.()
  }, [onApiSetupClosed])

  return (
    <>
      <Scrollbar className={providerDetailColumnClasses.scrollStrip}>
        <div className={cn(providerDetailColumnClasses.sectionStack, isLoginBased && 'gap-3')}>
          <AuthenticationSection
            providerId={providerId}
            onRequestModelPullGuide={requestModelPullGuide}
            onOpenApiSetup={() => openApiSetup('api-key')}
            onContinueApiSetup={() => openApiSetup('models')}
          />
          <div className="flex min-h-0 flex-1 flex-col">
            <ModelList
              providerId={providerId}
              modelPullGuideVersion={modelPullGuideVersion}
              onContinueApiSetup={() => openApiSetup('models')}
            />
          </div>
        </div>
      </Scrollbar>
      {apiSetupStep ? (
        <ProviderApiSetupDialog providerId={providerId} initialStep={apiSetupStep} onClose={closeApiSetup} />
      ) : null}
    </>
  )
}

function ProviderSettingContent({
  providerId,
  isLoginBased,
  initialApiSetupStep,
  onApiSetupClosed
}: {
  providerId: string
  isLoginBased: boolean
  initialApiSetupStep?: ProviderApiSetupInitialStep
  onApiSetupClosed?: () => void
}) {
  const apiKey = useProviderApiKey(providerId)

  return (
    <ApiKeyProvider value={apiKey}>
      <ModelListHealthProvider providerId={providerId}>
        <ProviderSettingSections
          providerId={providerId}
          isLoginBased={isLoginBased}
          initialApiSetupStep={initialApiSetupStep}
          onApiSetupClosed={onApiSetupClosed}
        />
      </ModelListHealthProvider>
    </ApiKeyProvider>
  )
}

export default function ProviderSetting({ providerId, initialApiSetupStep, onApiSetupClosed }: ProviderSettingProps) {
  const { provider } = useProvider(providerId)
  const { theme } = useTheme()

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
          <ProviderSettingContent
            providerId={providerId}
            isLoginBased={isLoginBasedProvider(provider)}
            initialApiSetupStep={initialApiSetupStep}
            onApiSetupClosed={onApiSetupClosed}
          />
        </div>
      </div>
    </ProviderSettingsContainer>
  )
}
