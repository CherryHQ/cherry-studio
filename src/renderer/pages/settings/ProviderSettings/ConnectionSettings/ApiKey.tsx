import { Button, InputGroup, InputGroupAddon, InputGroupInput, Tooltip } from '@cherrystudio/ui'
import { useProvider, useProviderApiKeys } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { maskApiKey } from '@renderer/utils/api'
import { cn } from '@renderer/utils/style'
import { Copy, Edit3, Eye, EyeOff, KeyRound, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthenticationApiKey } from '../hooks/providerSetting/useAuthenticationApiKey'
import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import { ProviderModelCheck } from '../ModelList'
import ProviderField from '../primitives/ProviderField'
import ProviderSection from '../primitives/ProviderSection'
import { apiKeyListClasses, fieldClasses, ProviderHelpLink } from '../primitives/ProviderSettingsPrimitives'
import { copyApiKeyToClipboard } from './copyApiKeyToClipboard'
import ProviderApiKeyListDrawer from './ProviderApiKeyListDrawer'

interface ApiKeyProps {
  providerId: string
  onRequestModelPullGuide?: () => void
  onOpenApiSetup?: () => void
  onContinueApiSetup?: () => void
}

function maskStoredApiKey(key: string) {
  const maskedKey = maskApiKey(key)
  return maskedKey === key ? '••••••••' : maskedKey
}

export default function ApiKey({
  providerId,
  onRequestModelPullGuide,
  onOpenApiSetup,
  onContinueApiSetup
}: ApiKeyProps) {
  const { t } = useTranslation()
  const { provider, deleteApiKey, isDeletingApiKey } = useProvider(providerId)
  const meta = useProviderMeta(providerId)
  const { inputApiKey, setInputApiKey, hasPendingSync, commitInputApiKeyNow } = useAuthenticationApiKey()
  const { data: apiKeysData, isLoading: isLoadingApiKeys } = useProviderApiKeys(providerId)
  const [showApiKey, setShowApiKey] = useState(false)
  const [keyListOpen, setKeyListOpen] = useState(false)
  const [apiKeyEdited, setApiKeyEdited] = useState(false)
  const apiKeys = apiKeysData?.keys ?? []

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

  const handleDeleteApiKey = useCallback(
    async (keyId: string) => {
      try {
        await deleteApiKey(keyId)
      } catch {
        toast.error(t('settings.provider.api_key.save_failed'))
      }
    },
    [deleteApiKey, t]
  )

  if (!provider || !meta.isApiKeyFieldVisible) {
    return null
  }

  const primaryApiKey = apiKeys.find((entry) => entry.isEnabled) ?? apiKeys[0]
  const requiresApiKey = provider.authOptional !== true

  return (
    <>
      <ProviderSection id={provider.id === 'cherryin' ? 'cherryin-api-key-section' : undefined}>
        <ProviderField
          className="space-y-2"
          title={
            <div className={fieldClasses.titleWithHelp}>
              <span>{t('settings.provider.api_key.label')}</span>
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
          {requiresApiKey ? (
            isLoadingApiKeys ? (
              <div className={fieldClasses.inputGroupBlock} aria-label={t('common.loading')}>
                <span className="text-muted-foreground text-sm">{t('common.loading')}</span>
              </div>
            ) : primaryApiKey ? (
              <div className={fieldClasses.inputRow}>
                <div
                  className={cn(
                    fieldClasses.inputGroup,
                    'group/api-key transition-colors focus-within:border-ring focus-within:bg-accent/40 hover:border-border-strong hover:bg-accent/40'
                  )}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                    aria-label={t('settings.provider.api.key.list.title')}
                    aria-haspopup="dialog"
                    aria-expanded={keyListOpen}
                    onClick={() => setKeyListOpen(true)}>
                    <span className="min-w-0 truncate font-mono text-foreground text-sm">
                      {showApiKey ? primaryApiKey.key : maskStoredApiKey(primaryApiKey.key)}
                    </span>
                    {apiKeys.length > 1 ? (
                      <span className="shrink-0 text-muted-foreground text-xs">+{apiKeys.length - 1}</span>
                    ) : null}
                  </button>
                  <div className="pointer-events-none flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/api-key:pointer-events-auto group-focus-within/api-key:opacity-100 group-hover/api-key:pointer-events-auto group-hover/api-key:opacity-100">
                    <Tooltip content={t('settings.provider.api_key.copy')}>
                      <button
                        type="button"
                        className={apiKeyListClasses.keyIconButton}
                        aria-label={t('settings.provider.api_key.copy')}
                        onClick={() => void copyApiKeyToClipboard(primaryApiKey.key, t)}>
                        <Copy />
                      </button>
                    </Tooltip>
                    <Tooltip content={t('common.edit')}>
                      <button
                        type="button"
                        className={apiKeyListClasses.keyIconButton}
                        aria-label={t('common.edit')}
                        onClick={onOpenApiSetup}>
                        <Edit3 />
                      </button>
                    </Tooltip>
                    {apiKeys.length === 1 ? (
                      <Tooltip content={t('common.delete')}>
                        <button
                          type="button"
                          className={apiKeyListClasses.keyDestructiveIconButton}
                          aria-label={t('common.delete')}
                          disabled={isDeletingApiKey}
                          onClick={() => void handleDeleteApiKey(primaryApiKey.id)}>
                          <Trash2 />
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                  <Tooltip
                    content={
                      showApiKey ? t('settings.provider.api_key.hide_key') : t('settings.provider.api_key.show_key')
                    }>
                    <button
                      type="button"
                      className={fieldClasses.apiKeyVisibilityToggle}
                      aria-label={
                        showApiKey ? t('settings.provider.api_key.hide_key') : t('settings.provider.api_key.show_key')
                      }
                      onClick={() => setShowApiKey((value) => !value)}>
                      {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </Tooltip>
                </div>
                <Tooltip content={t('settings.provider.api.key.list.title')}>
                  <span className="inline-flex shrink-0">
                    <button
                      type="button"
                      className={fieldClasses.inputActionButton}
                      aria-label={t('settings.provider.api.key.list.title')}
                      aria-haspopup="dialog"
                      aria-expanded={keyListOpen}
                      onClick={() => setKeyListOpen(true)}>
                      <KeyRound size={14} />
                    </button>
                  </span>
                </Tooltip>
                <ProviderModelCheck onAddModels={onContinueApiSetup} />
              </div>
            ) : (
              <div className={fieldClasses.inputRow}>
                <Button type="button" variant="outline" className="h-8 flex-1 bg-muted/30" onClick={onOpenApiSetup}>
                  <KeyRound size={14} />
                  {t('settings.provider.api_setup.add_key')}
                </Button>
                <Tooltip content={t('settings.provider.api.key.list.title')}>
                  <span className="inline-flex shrink-0">
                    <button
                      type="button"
                      className={fieldClasses.inputActionButton}
                      aria-label={t('settings.provider.api.key.list.title')}
                      aria-haspopup="dialog"
                      aria-expanded={keyListOpen}
                      onClick={() => setKeyListOpen(true)}>
                      <KeyRound size={14} />
                    </button>
                  </span>
                </Tooltip>
              </div>
            )
          ) : (
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
                />
                <InputGroupAddon align="inline-end" className="-mr-0.5 pr-0">
                  <Tooltip
                    content={
                      showApiKey ? t('settings.provider.api_key.hide_key') : t('settings.provider.api_key.show_key')
                    }>
                    <button
                      type="button"
                      className={fieldClasses.apiKeyVisibilityToggle}
                      aria-label={
                        showApiKey ? t('settings.provider.api_key.hide_key') : t('settings.provider.api_key.show_key')
                      }
                      onClick={() => setShowApiKey((v) => !v)}>
                      {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </Tooltip>
                </InputGroupAddon>
              </InputGroup>
              <Tooltip content={t('settings.provider.api.key.list.title')}>
                <span className="inline-flex shrink-0">
                  <button
                    type="button"
                    className={fieldClasses.inputActionButton}
                    aria-label={t('settings.provider.api.key.list.title')}
                    onClick={() => setKeyListOpen(true)}>
                    <KeyRound size={14} />
                  </button>
                </span>
              </Tooltip>
              <ProviderModelCheck />
            </div>
          )}
        </ProviderField>
      </ProviderSection>
      <ProviderApiKeyListDrawer providerId={providerId} open={keyListOpen} onClose={() => setKeyListOpen(false)} />
    </>
  )
}
