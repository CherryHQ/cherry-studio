import { useProvider, useProviderMutations } from '@renderer/hooks/useProviders'
import type { AuthConfig } from '@shared/data/types/provider'
import { useTranslation } from 'react-i18next'

import AnthropicSettings from '../AnthropicSettings'
import InlineSelector from './InlineSelector'
import ProviderField from './ProviderField'
import ProviderSection from './ProviderSection'

interface AnthropicAuthSectionProps {
  providerId: string
}

export default function AnthropicAuthSection({ providerId }: AnthropicAuthSectionProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { updateProvider } = useProviderMutations(providerId)

  if (!provider) {
    return null
  }

  return (
    <ProviderSection>
      <ProviderField title={t('settings.provider.anthropic.auth_method')}>
        <div className="w-[220px]">
          <InlineSelector
            value={provider.authType || 'api-key'}
            onChange={(value) =>
              void updateProvider({
                authConfig: { type: value as 'api-key' | 'oauth' } as AuthConfig
              })
            }
            options={[
              { value: 'api-key', label: t('settings.provider.anthropic.apikey') },
              { value: 'oauth', label: t('settings.provider.anthropic.oauth') }
            ]}
          />
        </div>
        {provider.authType === 'oauth' && (
          <div className="mt-4">
            <AnthropicSettings />
          </div>
        )}
      </ProviderField>
    </ProviderSection>
  )
}
