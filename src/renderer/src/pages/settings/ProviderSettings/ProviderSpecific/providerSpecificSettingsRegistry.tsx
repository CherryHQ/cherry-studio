import {
  isAwsBedrockProvider,
  isProviderSupportAuth,
  isVertexProvider,
  matchesPreset
} from '@renderer/pages/settings/ProviderSettings/utils/provider'
import type { Provider } from '@shared/data/types/provider'
import type { ReactNode } from 'react'

import OpenaiAlert from '../components/OpenaiAlert'
import type { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import AwsBedrockSettings from './AwsBedrockSettings'
import CherryInOauth from './CherryInOauth'
import DmxapiSettings from './DmxapiSettings'
import GithubCopilotSettings from './GithubCopilotSettings'
import GpuStackSettings from './GpuStackSettings'
import LmStudioSettings from './LmStudioSettings'
import OvmsSettings from './OvmsSettings'
import ProviderOauth from './ProviderOauth'
import VertexAiSettings from './VertexAiSettings'

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
      render: (providerId) => <ProviderOauth providerId={providerId} />
    },
    {
      key: 'cherryin-oauth',
      when: ({ meta }) => meta.isCherryIN,
      render: (providerId) => <CherryInOauth providerId={providerId} />
    },
    {
      key: 'openai-alert',
      when: ({ provider }) => matchesPreset(provider, 'openai'),
      render: () => <OpenaiAlert />
    },
    {
      key: 'ovms-settings',
      when: ({ provider }) => matchesPreset(provider, 'ovms'),
      render: () => <OvmsSettings />
    },
    {
      key: 'dmxapi-settings',
      when: ({ meta }) => meta.isDmxapi,
      render: (providerId) => <DmxapiSettings providerId={providerId} />
    }
  ],
  afterAuth: [
    {
      key: 'lmstudio-settings',
      when: ({ provider }) => matchesPreset(provider, 'lmstudio'),
      render: (providerId) => <LmStudioSettings providerId={providerId} />
    },
    {
      key: 'gpustack-settings',
      when: ({ provider }) => matchesPreset(provider, 'gpustack'),
      render: (providerId) => <GpuStackSettings providerId={providerId} />
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
      render: (providerId) => <VertexAiSettings providerId={providerId} />
    }
  ]
}
