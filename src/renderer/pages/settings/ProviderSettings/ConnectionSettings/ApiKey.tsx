import { InputGroup, InputGroupAddon, InputGroupInput, Tooltip } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'
import type { ApiKeyConnectivity } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { Activity, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthenticationApiKey } from '../hooks/providerSetting/useAuthenticationApiKey'
import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import ProviderField from '../primitives/ProviderField'
import ProviderSection from '../primitives/ProviderSection'
import { fieldClasses, ProviderHelpLink } from '../primitives/ProviderSettingsPrimitives'
import ProviderApiKeyListDrawer from './ProviderApiKeyListDrawer'

interface ApiKeyProps {
  providerId: string
  apiKeyConnectivity: ApiKeyConnectivity
  onOpenConnectionCheck: () => void
  onRequestModelPullGuide?: () => void
}

export default function ApiKey({
  providerId,
  apiKeyConnectivity,
  onOpenConnectionCheck,
  onRequestModelPullGuide
}: ApiKeyProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const meta = useProviderMeta(providerId)
  const { inputApiKey, setInputApiKey, hasPendingSync, commitInputApiKeyNow } = useAuthenticationApiKey()
  const [showApiKey, setShowApiKey] = useState(false)
  const [keyListOpen, setKeyListOpen] = useState(false)
  const [apiKeyEdited, setApiKeyEdited] = useState(false)

  useEffect(() => {
    setShowApiKey(false)
  }, [provider?.id])

  const handleApiKeyBlur = useCallback(async () => {
    if (!apiKeyEdited && !hasPendingSync) {
      return
    }

    try {
      await commitInputApiKeyNow()
      setApiKeyEdited(false)
      onRequestModelPullGuide?.()
    } catch {
      // Save failures are surfaced by the API-key hook; do not show the model-pull hint.
    }
  }, [apiKeyEdited, commitInputApiKeyNow, hasPendingSync, onRequestModelPullGuide])

  if (!provider || !meta.isApiKeyFieldVisible) {
    return null
  }

  return (
    <>
      <ProviderSection id={provider.id === 'cherryin' ? 'cherryin-api-key-section' : undefined}>
        <ProviderField
          className="space-y-2"
          title={
            <div className={fieldClasses.titleWithHelp}>
              <span className="font-semibold">{t('settings.provider.api_key.label')}</span>
              {meta.apiKeyWebsite && !meta.isDmxapi ? (
                <ProviderHelpLink
                  target="_blank"
                  rel="noreferrer"
                  href={meta.apiKeyWebsite}
                  className={fieldClasses.titleHelpLink}>
                  {t('settings.provider.get_api_key')}
                </ProviderHelpLink>
              ) : null}
            </div>
          }
          titleClassName="text-foreground">
          <div className={fieldClasses.inputRow}>
            <InputGroup className={fieldClasses.inputGroup}>
              <InputGroupInput
                type={showApiKey ? 'text' : 'password'}
                className={fieldClasses.input}
                value={inputApiKey}
                placeholder={t('settings.provider.api_key.placeholder')}
                onChange={(event) => {
                  setApiKeyEdited(true)
                  setInputApiKey(event.target.value)
                }}
                onBlur={() => void handleApiKeyBlur()}
                disabled={provider.id === 'copilot'}
              />
              {provider.id !== 'copilot' && (
                <InputGroupAddon align="inline-end" className="-mr-0.5 pr-0">
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
