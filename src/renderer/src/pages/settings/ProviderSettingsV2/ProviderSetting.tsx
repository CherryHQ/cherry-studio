import { useTheme } from '@renderer/context/ThemeProvider'
import { useProvider } from '@renderer/hooks/useProviders'

import AuthenticationSection from './components/AuthenticationSection'
import ProviderHeader from './components/ProviderHeader'
import { ProviderSettingsContainer } from './components/ProviderSettingsPrimitives'
import { useProviderAutoModelSync } from './hooks/providerSetting/useProviderAutoModelSync'
import { useProviderLegacyWebSearchSync } from './hooks/providerSetting/useProviderLegacyWebSearchSync'
import { useProviderOnboardingAutoEnable } from './hooks/providerSetting/useProviderOnboardingAutoEnable'
import { ModelList } from './ModelList'

interface ProviderSettingProps {
  providerId: string
  isOnboarding?: boolean
}

/**
 * Provider Settings refactors target full domain-cohesive internalization, not partial parameter trimming.
 * Keep ProviderSetting as the shared owner only for true page-level truth and page-level coordination:
 * render shell/layout, read shared page truth such as provider/models/theme,
 * and host a few narrow coordination effect hooks when one effect must observe multiple domains together.
 * Repeated domain reads inside hooks are acceptable; page-level dependency assembly is not.
 * Do not precompute section-local derived values here, do not rebuild a page-level facade/view-model hook,
 * and do not thread domain-local queries, mutations, stores, translations, timers, or bridge logic through
 * the page when a domain hook or section can internalize them itself.
 *
 * Provider Settings hooks follow a domain-cohesive hook rule:
 * a domain-cohesive hook owns one narrow provider-settings domain, consumes its own domain-local dependencies
 * internally, and exposes only the minimal UI-facing state/actions that callers actually need.
 * Preferred external shape is useProviderXxx(providerId) or the smallest possible shared-draft/scalar input.
 * Callers should pass only ids or true shared drafts, never domain-local dependencies that the hook can resolve.
 *
 * Coordination hooks are not domain-cohesive state hooks:
 * they may read across domains, but only to own one cross-domain side effect.
 * They should still minimize inputs, internalize their own cross-domain reads where practical,
 * and must not expand into page-level facades, broad orchestration layers, or wide returned objects.
 */
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
        {/* Scoped mock alignment: tokens in `tailwind-default-scope.css`, compositions in ProviderSettingsPrimitives. */}
        <div
          data-testid="provider-detail-shell"
          className="provider-settings-default-scope flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 px-5 py-3.5">
            <ProviderHeader providerId={providerId} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/20 [&::-webkit-scrollbar]:w-[3px]">
            <div className="flex min-h-full w-full min-w-0 flex-col gap-4">
              <AuthenticationSection providerId={providerId} />
              <ModelList providerId={providerId} />
            </div>
          </div>
        </div>
      </div>
    </ProviderSettingsContainer>
  )
}
