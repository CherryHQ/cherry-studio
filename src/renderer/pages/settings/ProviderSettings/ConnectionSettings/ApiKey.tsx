import { InputGroup, InputGroupAddon, InputGroupInput, Tooltip } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'
import type { ApiKeyConnectivity } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { Activity, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthenticationApiKey } from '../hooks/providerSetting/useAuthenticationApiKey'
import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import ProviderField from '../primitives/ProviderField'
import ProviderSection from '../primitives/ProviderSection'
import { fieldClasses, ProviderHelpLink } from '../primitives/ProviderSettingsPrimitives'
import {
  classifyEnabledApiKeyChange,
  type ConnectionModelDetectionEvent,
  type ConnectionModelDetectionIntent,
  parseEnabledApiKeyInput
} from './connectionModelDetection'
import ProviderApiKeyListDrawer from './ProviderApiKeyListDrawer'

interface ApiKeyProps {
  providerId: string
  apiKeyConnectivity: ApiKeyConnectivity
  onOpenConnectionCheck: () => void
  requiresApiKey?: boolean
  onConnectionModelDetection?: (event: ConnectionModelDetectionEvent) => void
}

export default function ApiKey({
  providerId,
  apiKeyConnectivity,
  onOpenConnectionCheck,
  requiresApiKey = true,
  onConnectionModelDetection
}: ApiKeyProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const meta = useProviderMeta(providerId)
  const { serverApiKey, inputApiKey, setInputApiKey, hasPendingSync, commitInputApiKeyNow } = useAuthenticationApiKey()
  const [showApiKey, setShowApiKey] = useState(false)
  const [keyListOpen, setKeyListOpen] = useState(false)
  const [apiKeyEdited, setApiKeyEdited] = useState(false)
  const editStartKeysRef = useRef<string[] | null>(null)
  const editInvalidatedDetectionRef = useRef(false)

  useEffect(() => {
    setShowApiKey(false)
  }, [provider?.id])

  const handleApiKeyBlur = useCallback(async () => {
    const nextKeys = parseEnabledApiKeyInput(inputApiKey)
    if (!apiKeyEdited && !hasPendingSync) {
      editStartKeysRef.current = null
      editInvalidatedDetectionRef.current = false
      if (nextKeys.length > 0) {
        onConnectionModelDetection?.({ intent: 'detect' })
      }
      return
    }

    try {
      await commitInputApiKeyNow()
      const intent = classifyEnabledApiKeyChange(
        editStartKeysRef.current ?? parseEnabledApiKeyInput(serverApiKey),
        nextKeys
      )
      const detectionWasInvalidated = editInvalidatedDetectionRef.current
      setApiKeyEdited(false)
      editStartKeysRef.current = null
      editInvalidatedDetectionRef.current = false
      if (nextKeys.length > 0) {
        onConnectionModelDetection?.({
          intent: 'detect',
          ...(intent !== null ? { shouldGuideExistingModels: true } : {})
        })
      } else if (intent === 'invalidate' && !detectionWasInvalidated) {
        onConnectionModelDetection?.({ intent })
      }
    } catch {
      // Save failures are surfaced by the API-key hook; keep the edit baseline for a retry.
    }
  }, [apiKeyEdited, commitInputApiKeyNow, hasPendingSync, inputApiKey, onConnectionModelDetection, serverApiKey])

  const handleKeyListChange = useCallback(
    (intent: ConnectionModelDetectionIntent) => {
      onConnectionModelDetection?.({ intent })
    },
    [onConnectionModelDetection]
  )

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
                onFocus={() => {
                  editStartKeysRef.current ??= parseEnabledApiKeyInput(serverApiKey)
                }}
                onChange={(event) => {
                  editStartKeysRef.current ??= parseEnabledApiKeyInput(serverApiKey)
                  if (
                    !editInvalidatedDetectionRef.current &&
                    classifyEnabledApiKeyChange(
                      parseEnabledApiKeyInput(inputApiKey),
                      parseEnabledApiKeyInput(event.target.value)
                    )
                  ) {
                    editInvalidatedDetectionRef.current = true
                    onConnectionModelDetection?.({ intent: 'invalidate' })
                  }
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
                  disabled={
                    provider.id === 'copilot' || (requiresApiKey && !inputApiKey) || apiKeyConnectivity.checking
                  }
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
      <ProviderApiKeyListDrawer
        providerId={providerId}
        open={keyListOpen}
        onClose={() => setKeyListOpen(false)}
        onApiKeyChange={handleKeyListChange}
      />
    </>
  )
}
