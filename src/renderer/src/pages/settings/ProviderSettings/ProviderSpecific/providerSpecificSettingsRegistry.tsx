import {
  isAwsBedrockProvider,
  isProviderSupportAuth,
  isVertexProvider,
  matchesPreset
} from '@renderer/pages/settings/ProviderSettings/utils/provider'
import type { Provider } from '@shared/data/types/provider'
import type { ReactNode } from 'react'

import OpenAIAlert from '../components/OpenAIAlert'
import type { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import AwsBedrockSettings from './AwsBedrockSettings'
import CherryINOAuth from './CherryINOAuth'
import DMXAPISettings from './DMXAPISettings'
import GithubCopilotSettings from './GithubCopilotSettings'
import GPUStackSettings from './GPUStackSettings'
import LMStudioSettings from './LMStudioSettings'
import OVMSSettings from './OVMSSettings'
import ProviderOAuth from './ProviderOAuth'
import VertexAISettings from './VertexAISettings'

export type ProviderSpecificPlacement = 'beforeAuth' | 'afterAuth'

export type ProviderSpecificContext = {
  provider: Provider
  meta: ReturnType<typeof useProviderMeta>
}

export type ProviderSpecificRegistryEntry = {
  key: string
  when: (context: ProviderSpecificContext) => boolean
  render: (providerId: string) => ReactNode
}

export const PROVIDER_SPECIFIC_SETTINGS_REGISTRY: Record<ProviderSpecificPlacement, ProviderSpecificRegistryEntry[]> = {
  beforeAuth: [
    {
      key: 'oauth',
      when: ({ provider }) => isProviderSupportAuth(provider),
      render: (providerId) => <ProviderOAuth providerId={providerId} />
    },
    {
      key: 'cherryin-oauth',
      when: ({ meta }) => meta.isCherryIN,
      render: (providerId) => <CherryINOAuth providerId={providerId} />
    },
    {
      key: 'openai-alert',
      when: ({ provider }) => matchesPreset(provider, 'openai'),
      render: () => <OpenAIAlert />
    },
    {
      key: 'ovms-settings',
      when: ({ provider }) => matchesPreset(provider, 'ovms'),
      render: () => <OVMSSettings />
    },
    {
      key: 'dmxapi-settings',
      when: ({ meta }) => meta.isDmxapi,
      render: (providerId) => <DMXAPISettings providerId={providerId} />
    }
  ],
  afterAuth: [
    {
      key: 'lmstudio-settings',
      when: ({ provider }) => matchesPreset(provider, 'lmstudio'),
      render: (providerId) => <LMStudioSettings providerId={providerId} />
    },
    {
      key: 'gpustack-settings',
      when: ({ provider }) => matchesPreset(provider, 'gpustack'),
      render: (providerId) => <GPUStackSettings providerId={providerId} />
    },
    {
      key: 'copilot-settings',
      when: ({ provider }) => matchesPreset(provider, 'copilot'),
      render: (providerId) => <GithubCopilotSettings providerId={providerId} />
    },
    {
      key: 'aws-bedrock-settings',
      when: ({ provider }) => isAwsBedrockProvider(provider),
      render: (providerId) => <AwsBedrockSettings providerId={providerId} />
    },
    {
      key: 'vertexai-settings',
      when: ({ provider }) => isVertexProvider(provider),
      render: (providerId) => <VertexAISettings providerId={providerId} />
    }
  ]
}
