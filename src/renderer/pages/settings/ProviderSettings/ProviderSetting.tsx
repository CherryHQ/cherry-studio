import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useProvider } from '@renderer/hooks/useProvider'

import ProviderHeader from './components/ProviderHeader'
import AuthenticationSection from './ConnectionSettings/AuthenticationSection'
import { useProviderAutoModelSync } from './hooks/providerSetting/useProviderAutoModelSync'
import { useProviderLegacyWebSearchSync } from './hooks/providerSetting/useProviderLegacyWebSearchSync'
import { useProviderOnboardingAutoEnable } from './hooks/providerSetting/useProviderOnboardingAutoEnable'
import { ModelList } from './ModelList'
import { providerDetailColumnClasses, ProviderSettingsContainer } from './primitives/ProviderSettingsPrimitives'

interface ProviderSettingProps {
  providerId: string
  isOnboarding?: boolean
}

export default function ProviderSetting({ providerId, isOnboarding = false }: ProviderSettingProps) {
  const { provider } = useProvider(providerId)
  const { theme } = useTheme()

  useProviderAutoModelSync(providerId)
  useProviderOnboardingAutoEnable({
    providerId,
    isOnboarding
  })
  useProviderLegacyWebSearchSync(providerId)

  if (!provider) {
    return null
  }

  return (
    <ProviderSettingsContainer theme={theme}>
      <div className="flex h-full min-h-0 w-full flex-col">
        {/* Scoped mock alignment: tokens in `provider-settings-scoped-theme.css`, compositions in ProviderSettingsPrimitives. */}
        <div
          data-testid="provider-detail-shell"
          className="provider-settings-default-scope flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className={providerDetailColumnClasses.headerPad}>
            <ProviderHeader providerId={providerId} />
          </div>
          <Scrollbar className={providerDetailColumnClasses.scrollStrip}>
            <div className={providerDetailColumnClasses.sectionStack}>
              <AuthenticationSection providerId={providerId} />
              <ModelList providerId={providerId} />
            </div>
          </Scrollbar>
        </div>
      </div>
    </ProviderSettingsContainer>
  )
}
