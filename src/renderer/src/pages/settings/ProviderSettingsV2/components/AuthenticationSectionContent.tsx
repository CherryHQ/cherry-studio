import { useOpenApiKeyList } from '../hooks/providerSetting/useOpenApiKeyList'
import { useProviderConnectionCheck } from '../hooks/providerSetting/useProviderConnectionCheck'
// import ApiActions from './ApiActions'
import ApiHost from './ApiHost'
import ApiKey from './ApiKey'
import { LlmApiKeyList } from './ApiKeyList/list'
import ProviderConnectionCheckDrawer from './ProviderConnectionCheckDrawer'
import ProviderSettingsDrawer from './ProviderSettingsDrawer'

export interface AuthenticationSectionContentProps {
  providerId: string
}

export function AuthenticationSectionContent({ providerId }: AuthenticationSectionContentProps) {
  const connectionCheck = useProviderConnectionCheck(providerId)
  const apiKeyList = useOpenApiKeyList(providerId)

  return (
    <>
      <ApiKey
        providerId={providerId}
        apiKeyConnectivity={connectionCheck.apiKeyConnectivity}
        onShowApiKeyError={connectionCheck.showApiKeyError}
        onOpenConnectionCheck={connectionCheck.openConnectionCheck}
      />
      <ApiHost providerId={providerId} />
      {/* <ApiActions providerId={providerId} onOpenApiKeyList={() => void apiKeyList.openApiKeyList()} /> */}
      <ProviderConnectionCheckDrawer
        open={connectionCheck.connectionCheckOpen}
        models={connectionCheck.checkableModels}
        apiKeys={connectionCheck.checkableApiKeys}
        isSubmitting={connectionCheck.apiKeyConnectivity.checking ?? false}
        onClose={connectionCheck.closeConnectionCheck}
        onStart={connectionCheck.startConnectionCheck}
      />
      <ProviderSettingsDrawer
        open={apiKeyList.apiKeyListOpen}
        onClose={apiKeyList.closeApiKeyList}
        title={apiKeyList.title}>
        <LlmApiKeyList providerId={providerId} />
      </ProviderSettingsDrawer>
    </>
  )
}
