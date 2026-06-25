import { isLoginBasedProviderId } from '@shared/utils/provider'

import { useProviderConnectionCheck } from '../hooks/providerSetting/useProviderConnectionCheck'
import ApiHost from './ApiHost'
import ApiKey from './ApiKey'
import ProviderConnectionCheckDrawer from './ProviderConnectionCheckDrawer'

export interface AuthenticationSectionContentProps {
  providerId: string
  onOpenModelHealthCheck?: () => void
}

export function AuthenticationSectionContent({
  providerId,
  onOpenModelHealthCheck
}: AuthenticationSectionContentProps) {
  const connectionCheck = useProviderConnectionCheck(providerId)

  // claude-code (CLI login), openai-codex (ChatGPT OAuth) and grok-cli (xAI
  // OAuth) authenticate via a login, not an API key — their sign-in panels
  // render through the provider-specific registry instead.
  if (isLoginBasedProviderId(providerId)) {
    return null
  }

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
        onOpenModelHealthCheck={onOpenModelHealthCheck}
      />
    </>
  )
}
