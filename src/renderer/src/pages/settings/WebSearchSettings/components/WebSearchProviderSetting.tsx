import { Divider } from '@cherrystudio/ui'
import type { WebSearchProviderId } from '@renderer/types'
import type { FC } from 'react'

import { useWebSearchProviderSetting } from '../hooks/useWebSearchProviderSetting'
import {
  WebSearchLocalProviderSection,
  WebSearchProviderApiHostSection,
  WebSearchProviderApiKeySection,
  WebSearchProviderBasicAuthSection,
  WebSearchProviderHeader
} from './WebSearchProviderSettingSections'
import { WebSearchSettingsSection } from './WebSearchSettingsLayout'

interface Props {
  providerId: WebSearchProviderId
}

const WebSearchProviderSetting: FC<Props> = ({ providerId }) => {
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
    officialWebsite,
    onUpdateApiHost,
    onUpdateApiKey,
    onUpdateBasicAuthPassword,
    onUpdateBasicAuthUsername,
    openApiKeyList,
    openLocalProviderSettings,
    provider,
    providerLogo,
    setApiHost,
    setApiKey,
    setBasicAuthPassword,
    setBasicAuthUsername,
    supportsBasicAuth
  } = useWebSearchProviderSetting(providerId)

  return (
    <WebSearchSettingsSection
      title={<WebSearchProviderHeader logo={providerLogo} name={provider.name} />}
      actions={officialWebsite ? <WebSearchProviderHeader officialWebsite={officialWebsite} /> : null}>
      {isLocalProvider && (
        <WebSearchLocalProviderSection providerName={provider.name} onOpenSettings={openLocalProviderSettings} />
      )}

      {!isLocalProvider && needsApiKey && (
        <>
          <WebSearchProviderApiKeySection
            apiChecking={apiChecking}
            apiKey={apiKey}
            apiKeyWebsite={apiKeyWebsite}
            apiValid={apiValid}
            onCheck={checkSearch}
            onOpenApiKeyList={openApiKeyList}
            onUpdateApiKey={onUpdateApiKey}
            setApiKey={setApiKey}
          />
          <Divider className="my-0" />
        </>
      )}

      {!isLocalProvider && (
        <>
          <WebSearchProviderApiHostSection
            apiHost={apiHost}
            onUpdateApiHost={onUpdateApiHost}
            setApiHost={setApiHost}
          />
          {supportsBasicAuth && <Divider className="my-0" />}
        </>
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
    </WebSearchSettingsSection>
  )
}

export default WebSearchProviderSetting
