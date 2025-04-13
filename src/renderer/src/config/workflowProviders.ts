import DifyProviderLogo from '@renderer/assets/images/providers/dify.png'

const FLOW_ENGINE_PROVIDER_LOGO_MAP = {
  dify: DifyProviderLogo
} as const

export function getFlowEngineProviderLogo(providerId: string) {
  return FLOW_ENGINE_PROVIDER_LOGO_MAP[providerId as keyof typeof FLOW_ENGINE_PROVIDER_LOGO_MAP]
}

export const FLOW_ENGINE_PROVIDER_CONFIG = {
  dify: {
    websites: {
      official: 'https://dify.ai/'
    }
  }
}
