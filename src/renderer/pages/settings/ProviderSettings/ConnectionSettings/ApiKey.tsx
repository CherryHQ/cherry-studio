import { InputGroup, InputGroupAddon, InputGroupInput, Tooltip, WarnTooltip } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProviders'
import type { ApiKeyConnectivity } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { Activity, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthenticationApiKey } from '../hooks/providerSetting/useAuthenticationApiKey'
import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import ProviderField from '../primitives/ProviderField'
import ProviderSection from '../primitives/ProviderSection'
import { fieldClasses } from '../primitives/ProviderSettingsPrimitives'
import ProviderApiKeyListDrawer from './ProviderApiKeyListDrawer'

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
  const { inputApiKey, setInputApiKey } = useAuthenticationApiKey()
  const [showApiKey, setShowApiKey] = useState(false)
  const [keyListOpen, setKeyListOpen] = useState(false)

  useEffect(() => {
    setShowApiKey(false)
  }, [provider?.id])

  if (!provider || !meta.isApiKeyFieldVisible) {
    return null
  }

  return (
    <>
      <ProviderSection id={provider.id === 'cherryin' ? 'cherryin-api-key-section' : undefined}>
        <ProviderField
          className="space-y-2"
          title={t('settings.provider.api_key.label')}
          titleClassName="text-foreground">
          <div className={fieldClasses.inputRow}>
            <InputGroup className={fieldClasses.inputGroup}>
              <InputGroupInput
                type={showApiKey ? 'text' : 'password'}
                className={fieldClasses.input}
                value={inputApiKey}
                placeholder={t('settings.provider.api_key.placeholder')}
                onChange={(event) => setInputApiKey(event.target.value)}
                disabled={provider.id === 'copilot'}
              />
              {provider.id !== 'copilot' && (
                <InputGroupAddon align="inline-end" className="pr-1.5 has-[>button]:mr-0">
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
            <Tooltip content={t('settings.provider.api.key.list.title')}>
              <span className="inline-flex shrink-0">
                <button
                  type="button"
                  disabled={provider.id === 'copilot'}
                  className={fieldClasses.inputActionButton}
                  aria-label={t('settings.provider.api.key.list.title')}
                  onClick={() => setKeyListOpen(true)}>
                  <KeyRound size={14} />
                </button>
              </span>
            </Tooltip>
            <Tooltip content={t('settings.provider.check')}>
              <span className="inline-flex shrink-0">
                <button
                  type="button"
                  disabled={provider.id === 'copilot' || !inputApiKey || apiKeyConnectivity.checking}
                  className={fieldClasses.inputActionButton}
                  aria-label={t('settings.provider.check')}
                  onClick={onOpenConnectionCheck}>
                  {apiKeyConnectivity.checking ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Activity size={14} />
                  )}
                </button>
              </span>
            </Tooltip>
          </div>
        </ProviderField>
      </ProviderSection>
      <ProviderApiKeyListDrawer providerId={providerId} open={keyListOpen} onClose={() => setKeyListOpen(false)} />
    </>
  )
}
