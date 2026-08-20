import { useProvider } from '@renderer/hooks/useProvider'
import { isLoginBasedProvider } from '@shared/utils/provider'

import ApiHost from './ApiHost'
import ApiKey from './ApiKey'

export interface AuthenticationSectionContentProps {
  providerId: string
  onRequestModelPullGuide?: () => void
}

export function AuthenticationSectionContent({
  providerId,
  onRequestModelPullGuide
}: AuthenticationSectionContentProps) {
  const { provider } = useProvider(providerId)

  // Login-based providers (claude-code CLI login, codex/grok OAuth) accept no API
  // key — their sign-in panels render through the provider-specific registry, so
  // suppress the generic api-key/host UI. Derived from registry `authMethods`.
  if (provider && isLoginBasedProvider(provider)) {
    return null
  }

  return (
    <>
      <ApiKey providerId={providerId} onRequestModelPullGuide={onRequestModelPullGuide} />
      <ApiHost providerId={providerId} onRequestModelPullGuide={onRequestModelPullGuide} />
    </>
  )
}
