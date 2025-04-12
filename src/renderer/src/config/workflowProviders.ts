import DifyProviderLogo from '@renderer/assets/images/providers/dify.png'

const WORKFLOW_PROVIDER_LOGO_MAP = {
  dify: DifyProviderLogo
} as const

export function getWorkflowProviderLogo(providerId: string) {
  return WORKFLOW_PROVIDER_LOGO_MAP[providerId as keyof typeof WORKFLOW_PROVIDER_LOGO_MAP]
}

export const WORKFLOW_PROVIDER_CONFIG = {
  dify: {
    websites: {
      official: 'https://dify.ai/'
    }
  }
}
