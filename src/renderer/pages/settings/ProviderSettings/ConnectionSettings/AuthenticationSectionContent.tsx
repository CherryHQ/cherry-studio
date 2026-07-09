import { useProvider } from '@renderer/hooks/useProvider'
import { isLoginBasedProvider } from '@shared/utils/provider'

import { useProviderConnectionCheck } from '../hooks/providerSetting/useProviderConnectionCheck'
import ApiHost from './ApiHost'
import ApiKey from './ApiKey'
import ProviderConnectionCheckDrawer from './ProviderConnectionCheckDrawer'

export interface AuthenticationSectionContentProps {
  providerId: string
  onOpenModelHealthCheck?: () => void
  onRequestModelPullGuide?: () => void
}

export function AuthenticationSectionContent({
  providerId,
  onOpenModelHealthCheck,
  onRequestModelPullGuide
}: AuthenticationSectionContentProps) {
  const connectionCheck = useProviderConnectionCheck(providerId)
  const { provider } = useProvider(providerId)

  // Login-based providers (claude-code CLI login, codex/grok OAuth) accept no API
  // key — their sign-in panels render through the provider-specific registry, so
  // suppress the generic api-key/host UI. Derived from registry `authMethods`.
  if (provider && isLoginBasedProvider(provider)) {
    return null
  }

  return (
    <>
      <ApiKey
        providerId={providerId}
        apiKeyConnectivity={connectionCheck.apiKeyConnectivity}
        onOpenConnectionCheck={connectionCheck.openConnectionCheck}
        onRequestModelPullGuide={onRequestModelPullGuide}
      />
      <ApiHost providerId={providerId} onRequestModelPullGuide={onRequestModelPullGuide} />
      <ProviderConnectionCheckDrawer
        open={connectionCheck.connectionCheckOpen}
        models={connectionCheck.checkableModels}
        apiKeys={connectionCheck.checkableApiKeys}
        connectionError={connectionCheck.apiKeyConnectivity.error}
        isSubmitting={connectionCheck.apiKeyConnectivity.checking ?? false}
        onClose={connectionCheck.closeConnectionCheck}
        onStart={connectionCheck.startConnectionCheck}
        onOpenModelHealthCheck={onOpenModelHealthCheck}
      />
    </>
  )
}
