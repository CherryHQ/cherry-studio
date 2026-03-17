import { WebSearchProviderIcon } from '@renderer/components/Icons'
import type { WebSearchProviderId } from '@renderer/types'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchProviderSetting } from '../hooks/useWebSearchProviderSetting'
import {
  WebSearchLocalProviderSection,
  WebSearchProviderApiHostSection,
  WebSearchProviderApiKeySection,
  WebSearchProviderBasicAuthSection,
  WebSearchProviderHeader
} from './WebSearchProviderSettingSections'
import { WebSearchSettingsPanelHeader } from './WebSearchSettingsLayout'

interface Props {
  providerId: WebSearchProviderId
}

const WebSearchProviderSetting: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation()
  const {
    apiChecking,
    apiHost,
    apiKey,
    apiKeyWebsite,
    apiValid,
    basicAuthPassword,
    basicAuthUsername,
    checkSearch,
    isLocalProvider,
    needsApiKey,
    onUpdateApiHost,
    onUpdateApiKey,
    onUpdateBasicAuthPassword,
    onUpdateBasicAuthUsername,
    openLocalProviderSettings,
    provider,
    setApiHost,
    setApiKey,
    setBasicAuthPassword,
    setBasicAuthUsername,
    supportsBasicAuth
  } = useWebSearchProviderSetting(providerId)

  return (
    <>
      <WebSearchSettingsPanelHeader
        icon={
          <WebSearchProviderHeader
            logo={<WebSearchProviderIcon pid={provider.id} size={24} />}
            name={provider.name}
            compact
          />
        }
        title={provider.name}
        subtitle={
          isLocalProvider ? t('settings.tool.websearch.local_providers') : t('settings.tool.websearch.api_providers')
        }
      />
      {isLocalProvider && (
        <WebSearchLocalProviderSection providerName={provider.name} onOpenSettings={openLocalProviderSettings} />
      )}

      {!isLocalProvider && needsApiKey && (
        <WebSearchProviderApiKeySection
          apiChecking={apiChecking}
          apiKey={apiKey}
          apiKeyProviderLabel={provider.name}
          apiKeyWebsite={apiKeyWebsite}
          apiValid={apiValid}
          onCheck={checkSearch}
          onUpdateApiKey={onUpdateApiKey}
          setApiKey={setApiKey}
        />
      )}

      {!isLocalProvider && (
        <WebSearchProviderApiHostSection apiHost={apiHost} onUpdateApiHost={onUpdateApiHost} setApiHost={setApiHost} />
      )}

      {!isLocalProvider && supportsBasicAuth && (
        <WebSearchProviderBasicAuthSection
          basicAuthPassword={basicAuthPassword}
          basicAuthUsername={basicAuthUsername}
          onUpdateBasicAuthPassword={onUpdateBasicAuthPassword}
          onUpdateBasicAuthUsername={onUpdateBasicAuthUsername}
          setBasicAuthPassword={setBasicAuthPassword}
          setBasicAuthUsername={setBasicAuthUsername}
        />
      )}
    </>
  )
}

export default WebSearchProviderSetting
