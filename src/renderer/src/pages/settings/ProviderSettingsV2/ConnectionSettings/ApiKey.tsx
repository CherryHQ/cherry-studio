import { InputGroup, InputGroupAddon, InputGroupInput, Tooltip, WarnTooltip } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProviders'
import type { ApiKeyConnectivity } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { Activity, Copy, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthenticationApiKey } from '../hooks/providerSetting/useAuthenticationApiKey'
import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import ProviderField from '../shared/primitives/ProviderField'
import ProviderSection from '../shared/primitives/ProviderSection'
import { fieldClasses } from '../shared/primitives/ProviderSettingsPrimitives'

interface ApiKeyProps {
  providerId: string
  apiKeyConnectivity: ApiKeyConnectivity
  onShowApiKeyError: () => void
  onOpenConnectionCheck: () => void
}

export default function ApiKey({
  providerId,
  apiKeyConnectivity,
  onShowApiKeyError,
  onOpenConnectionCheck
}: ApiKeyProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const meta = useProviderMeta(providerId)
  const { inputApiKey, setInputApiKey, serverApiKey } = useAuthenticationApiKey()
  const [showApiKey, setShowApiKey] = useState(false)

  useEffect(() => {
    setShowApiKey(false)
  }, [provider?.id])

  if (!provider || !meta.isApiKeyFieldVisible) {
    return null
  }

  return (
    <ProviderSection id={provider.id === 'cherryin' ? 'cherryin-api-key-section' : undefined}>
      <ProviderField
        className="space-y-2.5"
        title={t('settings.provider.api_key.label')}
        // action={
        //   meta.apiKeyWebsite && !meta.isDmxapi ? (
        //     <a
        //       href={meta.apiKeyWebsite}
        //       target="_blank"
        //       rel="noreferrer"
        //       className="shrink-0 text-(--color-primary) text-[12px] leading-[1.35] hover:underline">
        //       {t('settings.provider.get_api_key')}
        //     </a>
        //   ) : undefined
        // }
      >
        <div className={fieldClasses.inputRow}>
          <InputGroup className={fieldClasses.inputGroup}>
            <InputGroupInput
              type={showApiKey ? 'text' : 'password'}
              className={fieldClasses.input}
              value={inputApiKey}
              placeholder={t('settings.provider.api_key.label')}
              onChange={(event) => setInputApiKey(event.target.value)}
              autoFocus={provider.isEnabled && !serverApiKey}
              disabled={provider.id === 'copilot'}
            />
            {provider.id !== 'copilot' && (
              <InputGroupAddon align="inline-end">
                <Tooltip
                  content={
                    showApiKey ? t('settings.provider.api_key.hide_key') : t('settings.provider.api_key.show_key')
                  }>
                  <button
                    type="button"
                    className={fieldClasses.apiKeyVisibilityToggle}
                    onClick={() => setShowApiKey((v) => !v)}>
                    {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </Tooltip>
              </InputGroupAddon>
            )}
            {apiKeyConnectivity.status === 'failed' && !apiKeyConnectivity.checking && (
              <InputGroupAddon align="inline-end">
                <WarnTooltip
                  content={apiKeyConnectivity.error?.message || t('settings.models.check.failed')}
                  onClick={onShowApiKeyError}
                />
              </InputGroupAddon>
            )}
          </InputGroup>
          <Tooltip content={t('settings.provider.api_key.copy')}>
            <span className="inline-flex">
              <button
                type="button"
                disabled={provider.id === 'copilot' || !inputApiKey}
                className={fieldClasses.iconButton}
                onClick={() => {
                  if (!inputApiKey) {
                    return
                  }
                  void navigator.clipboard.writeText(inputApiKey)
                }}>
                <Copy size={12} />
              </button>
            </span>
          </Tooltip>
          <Tooltip content={t('settings.provider.check')}>
            <span className="inline-flex">
              <button
                type="button"
                disabled={provider.id === 'copilot' || !inputApiKey || apiKeyConnectivity.checking}
                className={fieldClasses.iconButton}
                onClick={onOpenConnectionCheck}>
                {apiKeyConnectivity.checking ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
              </button>
            </span>
          </Tooltip>
        </div>
      </ProviderField>
    </ProviderSection>
  )
}
