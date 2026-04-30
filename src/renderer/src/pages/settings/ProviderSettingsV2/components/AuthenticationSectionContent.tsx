import { useProviderConnectionCheck } from '../hooks/providerSetting/useProviderConnectionCheck'
import ApiHost from './ApiHost'
import ApiKey from './ApiKey'
import ProviderConnectionCheckDrawer from './ProviderConnectionCheckDrawer'

export interface AuthenticationSectionContentProps {
  providerId: string
}

export function AuthenticationSectionContent({ providerId }: AuthenticationSectionContentProps) {
  const connectionCheck = useProviderConnectionCheck(providerId)

  return (
    <>
      <ApiKey
        providerId={providerId}
        apiKeyConnectivity={connectionCheck.apiKeyConnectivity}
        onShowApiKeyError={connectionCheck.showApiKeyError}
        onOpenConnectionCheck={connectionCheck.openConnectionCheck}
      />
      <ApiHost providerId={providerId} />
      <ProviderConnectionCheckDrawer
        open={connectionCheck.connectionCheckOpen}
        models={connectionCheck.checkableModels}
        apiKeys={connectionCheck.checkableApiKeys}
        isSubmitting={connectionCheck.apiKeyConnectivity.checking ?? false}
        onClose={connectionCheck.closeConnectionCheck}
        onStart={connectionCheck.startConnectionCheck}
      />
    </>
  )
}
