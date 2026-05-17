import { loggerService } from '@logger'
import { useProvider, useProviderMutations } from '@renderer/hooks/useProvider'
import type { AuthConfig } from '@shared/data/types/provider'
import { useTranslation } from 'react-i18next'

import InlineSelector from '../primitives/InlineSelector'
import ProviderField from '../primitives/ProviderField'
import ProviderSection from '../primitives/ProviderSection'
import AnthropicSettings from '../ProviderSpecific/AnthropicSettings'

interface AnthropicAuthSectionProps {
  providerId: string
}

const logger = loggerService.withContext('AnthropicAuthSection')

function buildAnthropicAuthConfig(type: 'api-key' | 'oauth'): AuthConfig {
  if (type === 'oauth') {
    return {
      type: 'oauth',
      clientId: ''
    }
  }

  return {
    type: 'api-key'
  }
}

export default function AnthropicAuthSection({ providerId }: AnthropicAuthSectionProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { updateAuthConfig } = useProviderMutations(providerId)

  if (!provider) {
    return null
  }

  return (
    <ProviderSection>
      <ProviderField title={t('settings.provider.anthropic.auth_method')}>
        <div className="w-[220px]">
          <InlineSelector
            value={provider.authType || 'api-key'}
            onChange={(value) => {
              void updateAuthConfig(buildAnthropicAuthConfig(value as 'api-key' | 'oauth')).catch((error) => {
                logger.error('Failed to update Anthropic auth config', { providerId, error })
                window.toast.error(t('settings.provider.save_failed'))
              })
            }}
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
