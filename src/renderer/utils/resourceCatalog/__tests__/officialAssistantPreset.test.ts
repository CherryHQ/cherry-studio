import { describe, expect, it } from 'vitest'

import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import {
  getOfficialAssistantIconRef,
  type OfficialAssistantModelResolution,
  type OfficialAssistantVendor,
  resolveOfficialAssistantModel
} from '../officialAssistantPreset'

function provider(id: string, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    name: id,
    apiKeys: [{ id: `${id}-key`, isEnabled: true }],
    authType: 'api-key',
    settings: {},
    reportsActualCost: false,
    isEnabled: true,
    ...overrides
  }
}

function model(providerId: string, apiModelId: string, overrides: Partial<Model> = {}): Model {
  return {
    id: `${providerId}::${apiModelId}`,
    providerId,
    apiModelId,
    name: apiModelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  }
}

function resolved(modelId: UniqueModelId): OfficialAssistantModelResolution {
  return { status: 'resolved', modelId }
}

function configurationRequired(providerId: string): OfficialAssistantModelResolution {
  return { status: 'configuration-required', providerId }
}

type ResolutionCase = {
  name: string
  vendor: OfficialAssistantVendor
  providers: Provider[]
  models: Model[]
  defaultModelId?: string | null
  expected: OfficialAssistantModelResolution
}

const resolutionCases: ResolutionCase[] = [
  {
    name: 'selects the preferred Anthropic chat tier',
    vendor: 'anthropic',
    providers: [provider('anthropic')],
    models: [model('anthropic', 'claude-opus-4-1'), model('anthropic', 'claude-sonnet-4-6')],
    expected: resolved('anthropic::claude-sonnet-4-6')
  },
  {
    name: 'selects the preferred OpenAI chat tier',
    vendor: 'openai',
    providers: [provider('openai')],
    models: [model('openai', 'gpt-4o'), model('openai', 'gpt-5.2'), model('openai', 'gpt-5-mini')],
    expected: resolved('openai::gpt-5.2')
  },
  {
    name: 'selects the preferred Gemini chat tier',
    vendor: 'gemini',
    providers: [provider('gemini')],
    models: [model('gemini', 'gemini-2.5-flash'), model('gemini', 'gemini-3.1-pro-preview')],
    expected: resolved('gemini::gemini-3.1-pro-preview')
  },
  {
    name: 'selects the preferred DeepSeek chat tier',
    vendor: 'deepseek',
    providers: [provider('deepseek')],
    models: [model('deepseek', 'deepseek-reasoner'), model('deepseek', 'deepseek-v4-flash')],
    expected: resolved('deepseek::deepseek-v4-flash')
  },
  {
    name: 'selects the preferred Kimi chat tier',
    vendor: 'kimi',
    providers: [provider('moonshot')],
    models: [model('moonshot', 'moonshot-v1-128k'), model('moonshot', 'kimi-k2.5')],
    expected: resolved('moonshot::kimi-k2.5')
  },
  {
    name: 'keeps the first Doubao endpoint',
    vendor: 'doubao',
    providers: [provider('doubao')],
    models: [model('doubao', 'ep-first'), model('doubao', 'doubao-second')],
    expected: resolved('doubao::ep-first')
  },
  {
    name: 'selects a dated GPT-5 chat snapshot',
    vendor: 'openai',
    providers: [provider('openai')],
    models: [model('openai', 'gpt-4o'), model('openai', 'gpt-5.2-2025-12-11-chat-latest')],
    expected: resolved('openai::gpt-5.2-2025-12-11-chat-latest')
  },
  {
    name: 'prefers current DeepSeek Flash over a legacy chat alias',
    vendor: 'deepseek',
    providers: [provider('openrouter'), provider('cherryin')],
    models: [model('openrouter', 'deepseek-chat'), model('cherryin', 'deepseek-v4-flash')],
    expected: resolved('cherryin::deepseek-v4-flash')
  },
  {
    name: 'uses the declared DeepSeek family before the model id',
    vendor: 'deepseek',
    providers: [provider('cherryin'), provider('openrouter')],
    models: [
      model('cherryin', 'deepseek-v4-flash', { family: 'deepseek-thinking' }),
      model('openrouter', 'deepseek-chat', { family: 'deepseek-flash' })
    ],
    expected: resolved('openrouter::deepseek-chat')
  },
  {
    name: 'treats non-Flash DeepSeek models as one fallback tier',
    vendor: 'deepseek',
    providers: [provider('openrouter'), provider('cherryin')],
    models: [model('openrouter', 'deepseek-v3.2'), model('cherryin', 'deepseek-chat')],
    expected: resolved('cherryin::deepseek-chat')
  },
  {
    name: 'treats non-thinking K2 variants as one preferred tier',
    vendor: 'kimi',
    providers: [provider('openrouter'), provider('cherryin')],
    models: [model('openrouter', 'kimi-k2.5'), model('cherryin', 'kimi-k2-instruct')],
    expected: resolved('cherryin::kimi-k2-instruct')
  },
  {
    name: 'prefers CherryIN for otherwise equivalent candidates',
    vendor: 'deepseek',
    providers: [provider('openrouter'), provider('cherryin')],
    models: [model('openrouter', 'deepseek-v4-flash'), model('cherryin', 'deepseek-v4-flash')],
    expected: resolved('cherryin::deepseek-v4-flash')
  },
  {
    name: 'uses an explicit same-vendor default before the preferred tier',
    vendor: 'anthropic',
    providers: [provider('anthropic')],
    models: [model('anthropic', 'claude-sonnet-4-6'), model('anthropic', 'claude-opus-4-1')],
    defaultModelId: 'anthropic::claude-opus-4-1',
    expected: resolved('anthropic::claude-opus-4-1')
  },
  {
    name: 'does not cross vendors for the global default',
    vendor: 'anthropic',
    providers: [provider('openai')],
    models: [model('openai', 'gpt-5.2')],
    defaultModelId: 'openai::gpt-5.2',
    expected: configurationRequired('anthropic')
  },
  ...(
    [
      ['api-key', 'gemini', 'gemini-3.1-pro-preview', 'gemini'],
      ['api-key-aws', 'anthropic', 'global.anthropic.claude-sonnet-4-6-v1:0', 'anthropic'],
      ['iam-azure', 'openai', 'gpt-5-2', 'openai']
    ] as const
  ).map(([authType, vendor, apiModelId, officialProviderId]) => ({
    name: `requires credentials for a ${authType} provider`,
    vendor,
    providers: [provider('configured-provider', { apiKeys: [], authType })],
    models: [model('configured-provider', apiModelId)],
    expected: configurationRequired(officialProviderId)
  })),
  {
    name: 'resolves a signed-in OAuth provider without API keys',
    vendor: 'openai',
    providers: [provider('openai-codex', { apiKeys: [], authMethods: ['oauth'], authType: 'oauth' })],
    models: [model('openai-codex', 'gpt-5-2')],
    expected: resolved('openai-codex::gpt-5-2')
  },
  {
    name: 'does not treat a logged-out OAuth provider as configured',
    vendor: 'openai',
    providers: [provider('openai-codex', { apiKeys: [], authMethods: ['oauth'], authType: 'api-key' })],
    models: [model('openai-codex', 'gpt-5-2')],
    expected: configurationRequired('openai')
  },
  {
    name: 'normalizes Bedrock model ids for AWS IAM',
    vendor: 'anthropic',
    providers: [provider('aws-bedrock', { apiKeys: [], authType: 'iam-aws' })],
    models: [
      model('aws-bedrock', 'global.anthropic.claude-opus-4-1-v1:0'),
      model('aws-bedrock', 'global.anthropic.claude-sonnet-4-6-v1:0')
    ],
    expected: resolved('aws-bedrock::global.anthropic.claude-sonnet-4-6-v1:0')
  },
  {
    name: 'resolves a GCP IAM provider without API keys',
    vendor: 'gemini',
    providers: [provider('vertex-ai', { apiKeys: [], authType: 'iam-gcp' })],
    models: [model('vertex-ai', 'gemini-3.1-pro-preview')],
    expected: resolved('vertex-ai::gemini-3.1-pro-preview')
  },
  {
    name: 'normalizes a vendor-qualified raw Kimi model id',
    vendor: 'kimi',
    providers: [provider('aggregator')],
    models: [model('aggregator', 'moonshot-v1-128k'), model('aggregator', 'moonshotai.kimi-k2.5')],
    expected: resolved('aggregator::moonshotai.kimi-k2.5')
  },
  {
    name: 'uses a canonical Kimi preset model link',
    vendor: 'kimi',
    providers: [provider('aggregator')],
    models: [
      model('aggregator', 'moonshot-v1-128k'),
      model('aggregator', 'deployment-42', { presetModelId: 'kimi-k2-5' })
    ],
    expected: resolved('aggregator::deployment-42')
  },
  {
    name: 'excludes external-CLI providers even when authentication is optional',
    vendor: 'anthropic',
    providers: [
      provider('claude-code', {
        apiKeys: [],
        authMethods: ['external-cli'],
        authOptional: true,
        authType: 'oauth'
      })
    ],
    models: [model('claude-code', 'claude-sonnet-4-6')],
    expected: configurationRequired('anthropic')
  },
  {
    name: 'requires configuration without an enabled vendor model',
    vendor: 'deepseek',
    providers: [provider('deepseek')],
    models: [model('deepseek', 'deepseek-chat', { isEnabled: false }), model('deepseek', 'text-embedding-3-large')],
    expected: configurationRequired('deepseek')
  }
]

describe('official assistant preset', () => {
  it.each([
    ['anthropic', 'claude'],
    ['openai', 'openai'],
    ['gemini', 'gemini'],
    ['deepseek', 'deepseek'],
    ['kimi', 'kimi'],
    ['doubao', 'doubao']
  ] as const)('maps %s to its brand icon', (vendor, iconKey) => {
    expect(getOfficialAssistantIconRef(vendor)).toEqual(expect.objectContaining({ key: iconKey }))
  })

  it.each(resolutionCases)('$name', ({ vendor, providers, models, defaultModelId = null, expected }) => {
    expect(resolveOfficialAssistantModel({ vendor, providers, models, defaultModelId })).toEqual(expected)
  })
})
