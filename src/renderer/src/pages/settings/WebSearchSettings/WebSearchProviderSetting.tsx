import { Button, Flex, InfoTooltip, Input, RowFlex, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import ApiKeyListPopup from '@renderer/components/Popups/ApiKeyListPopup/popup'
import { getProviderLogo, getProviderWebsites } from '@renderer/config/webSearch'
import { useTimer } from '@renderer/hooks/useTimer'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearch'
import WebSearchService from '@renderer/services/webSearch/WebSearchService'
import { formatApiKeys, hasObjectKey } from '@renderer/utils'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { Check, ExternalLink, Eye, EyeOff, List, Loader2 } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle, SettingTitle } from '..'

const logger = loggerService.withContext('WebSearchProviderSetting')
interface Props {
  providerId: string
}

const WebSearchProviderSetting: FC<Props> = ({ providerId }) => {
  const { provider, updateProvider } = useWebSearchProvider(providerId)
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState('')
  const [apiHost, setApiHost] = useState('')
  const [apiChecking, setApiChecking] = useState(false)
  const [basicAuthUsername, setBasicAuthUsername] = useState('')
  const [basicAuthPassword, setBasicAuthPassword] = useState('')
  const [apiValid, setApiValid] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showBasicAuthPassword, setShowBasicAuthPassword] = useState(false)
  const { setTimeoutTimer } = useTimer()

  // Sync state when provider loads
  useEffect(() => {
    if (provider) {
      setApiKey(provider.apiKey ?? '')
      setApiHost(provider.apiHost ?? '')
      setBasicAuthUsername(provider.basicAuthUsername ?? '')
      setBasicAuthPassword(provider.basicAuthPassword ?? '')
    }
  }, [provider])

  if (!provider) {
    return null
  }

  const websites = getProviderWebsites(provider.id)
  const apiKeyWebsite = websites?.apiKey
  const officialWebsite = websites?.official

  const onUpdateApiKey = () => {
    if (apiKey !== provider.apiKey) {
      updateProvider({ apiKey })
    }
  }

  const onUpdateApiHost = () => {
    let trimmedHost = apiHost?.trim() || ''
    if (trimmedHost.endsWith('/')) {
      trimmedHost = trimmedHost.slice(0, -1)
    }
    if (trimmedHost !== provider.apiHost) {
      updateProvider({ apiHost: trimmedHost })
    } else {
      setApiHost(provider.apiHost || '')
    }
  }

  const onUpdateBasicAuthUsername = () => {
    const currentValue = basicAuthUsername || ''
    const savedValue = provider.basicAuthUsername || ''
    if (currentValue !== savedValue) {
      updateProvider({ basicAuthUsername })
    } else {
      setBasicAuthUsername(provider.basicAuthUsername || '')
    }
  }

  const onUpdateBasicAuthPassword = () => {
    const currentValue = basicAuthPassword || ''
    const savedValue = provider.basicAuthPassword || ''
    if (currentValue !== savedValue) {
      updateProvider({ basicAuthPassword })
    } else {
      setBasicAuthPassword(provider.basicAuthPassword || '')
    }
  }

  const openApiKeyList = async () => {
    await ApiKeyListPopup.show({
      providerId: provider.id,
      title: `${provider.name} ${t('settings.provider.api.key.list.title')}`,
      providerType: 'webSearch'
    })
  }

  async function checkSearch() {
    if (!provider) {
      window.toast.error({
        title: t('settings.no_provider_selected'),
        timeout: 3000
      })
      return
    }

    if (apiKey.includes(',')) {
      await openApiKeyList()
      return
    }

    try {
      setApiChecking(true)
      const { valid, error } = await WebSearchService.checkSearch(provider as unknown as WebSearchProvider)

      const errorMessage = error && error?.message ? ' ' + error?.message : ''
      window.toast[valid ? 'success' : 'error']({
        timeout: valid ? 2000 : 8000,
        title: valid
          ? t('settings.tool.websearch.check_success')
          : t('settings.tool.websearch.check_failed') + errorMessage
      })

      setApiValid(valid)
    } catch (err) {
      logger.error('Check search error:', err as Error)
      setApiValid(false)
      window.toast.error({
        timeout: 8000,
        title: t('settings.tool.websearch.check_failed')
      })
    } finally {
      setApiChecking(false)
      setTimeoutTimer('checkSearch', () => setApiValid(false), 2500)
    }
  }

  const isLocalProvider = provider.id.startsWith('local')

  const openLocalProviderSettings = async () => {
    if (officialWebsite) {
      await window.api.searchService.openSearchWindow(provider.id, true)
      await window.api.searchService.openUrlInSearchWindow(provider.id, officialWebsite)
    }
  }

  const providerLogo = getProviderLogo(provider.id)

  return (
    <>
      <SettingTitle>
        <Flex className="items-center gap-2">
          {providerLogo ? (
            <img src={providerLogo} alt={provider.name} className="h-5 w-5 object-contain" />
          ) : (
            <div className="h-5 w-5 rounded bg-[var(--color-background-soft)]" />
          )}
          <span className="font-medium text-sm">{provider.name}</span>
          {officialWebsite && websites && (
            <a target="_blank" href={websites.official} rel="noopener noreferrer">
              <ExternalLink size={12} className="text-[var(--color-text)]" />
            </a>
          )}
        </Flex>
      </SettingTitle>
      <div className="my-2.5 h-px w-full bg-[var(--color-border)]" />
      {isLocalProvider && (
        <>
          <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
            {t('settings.tool.websearch.local_provider.settings')}
          </SettingSubtitle>
          <Button variant="default" onClick={openLocalProviderSettings}>
            <ExternalLink size={14} />
            {t('settings.tool.websearch.local_provider.open_settings', { provider: provider.name })}
          </Button>
          <SettingHelpTextRow style={{ marginTop: 10 }}>
            <SettingHelpText>{t('settings.tool.websearch.local_provider.hint')}</SettingHelpText>
          </SettingHelpTextRow>
        </>
      )}
      {!isLocalProvider && hasObjectKey(provider, 'apiKey') && (
        <>
          <SettingSubtitle
            style={{
              marginTop: 5,
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
            {t('settings.provider.api_key.label')}
            <Tooltip content={t('settings.provider.api.key.list.open')} delay={500}>
              <Button variant="ghost" size="icon-sm" onClick={openApiKeyList}>
                <List size={14} />
              </Button>
            </Tooltip>
          </SettingSubtitle>
          <Flex className="gap-2">
            <div className="relative flex-1">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                placeholder={t('settings.provider.api_key.label')}
                onChange={(e) => setApiKey(formatApiKeys(e.target.value))}
                onBlur={onUpdateApiKey}
                spellCheck={false}
                autoFocus={apiKey === ''}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="-translate-y-1/2 absolute top-1/2 right-2 text-[var(--color-icon)] hover:text-[var(--color-text)]">
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <Button variant={apiValid ? 'ghost' : 'default'} onClick={checkSearch} disabled={apiChecking}>
              {apiChecking ? (
                <Loader2 size={16} className="animate-spin" />
              ) : apiValid ? (
                <Check size={16} />
              ) : (
                t('settings.tool.websearch.check')
              )}
            </Button>
          </Flex>
          <SettingHelpTextRow style={{ justifyContent: 'space-between', marginTop: 5 }}>
            <RowFlex>
              {apiKeyWebsite && (
                <SettingHelpLink target="_blank" href={apiKeyWebsite}>
                  {t('settings.provider.get_api_key')}
                </SettingHelpLink>
              )}
            </RowFlex>
            <SettingHelpText>{t('settings.provider.api_key.tip')}</SettingHelpText>
          </SettingHelpTextRow>
        </>
      )}
      {!isLocalProvider && hasObjectKey(provider, 'apiHost') && (
        <>
          <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
            {t('settings.provider.api_host')}
          </SettingSubtitle>
          <Flex className="gap-2">
            <Input
              value={apiHost}
              placeholder={t('settings.provider.api_host')}
              onChange={(e) => setApiHost(e.target.value)}
              onBlur={onUpdateApiHost}
            />
          </Flex>
        </>
      )}
      {!isLocalProvider && hasObjectKey(provider, 'basicAuthUsername') && (
        <>
          <SettingDivider style={{ marginTop: 12, marginBottom: 12 }} />
          <SettingSubtitle
            style={{ marginTop: 5, marginBottom: 10, display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
            {t('settings.provider.basic_auth.label')}
            <InfoTooltip
              placement="right"
              content={t('settings.provider.basic_auth.tip')}
              iconProps={{
                size: 16,
                color: 'var(--color-icon)',
                className: 'ml-1 cursor-pointer'
              }}
            />
          </SettingSubtitle>
          <div className="flex w-full flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-[var(--color-text-1)] text-sm">
                {t('settings.provider.basic_auth.user_name.label')}
              </label>
              <Input
                value={basicAuthUsername}
                placeholder={t('settings.provider.basic_auth.user_name.tip')}
                onChange={(e) => setBasicAuthUsername(e.target.value)}
                onBlur={onUpdateBasicAuthUsername}
              />
            </div>
            {basicAuthUsername && (
              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-[var(--color-text-1)] text-sm">
                  {t('settings.provider.basic_auth.password.label')}
                </label>
                <div className="relative">
                  <Input
                    type={showBasicAuthPassword ? 'text' : 'password'}
                    value={basicAuthPassword}
                    placeholder={t('settings.provider.basic_auth.password.tip')}
                    onChange={(e) => setBasicAuthPassword(e.target.value)}
                    onBlur={onUpdateBasicAuthPassword}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowBasicAuthPassword(!showBasicAuthPassword)}
                    className="-translate-y-1/2 absolute top-1/2 right-2 text-[var(--color-icon)] hover:text-[var(--color-text)]">
                    {showBasicAuthPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

export default WebSearchProviderSetting
