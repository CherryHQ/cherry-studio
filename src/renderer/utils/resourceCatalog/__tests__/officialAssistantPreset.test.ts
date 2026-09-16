import { describe, expect, it } from 'vitest'

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import {
  getOfficialAssistantIconRef,
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

const preferredTierCases: Array<{
  vendor: OfficialAssistantVendor
  providers: Provider[]
  models: Model[]
  expectedModelId: string
}> = [
  {
    vendor: 'anthropic',
    providers: [provider('anthropic')],
    models: [model('anthropic', 'claude-opus-4-1'), model('anthropic', 'claude-sonnet-4-6')],
    expectedModelId: 'anthropic::claude-sonnet-4-6'
  },
  {
    vendor: 'openai',
    providers: [provider('openai')],
    models: [model('openai', 'gpt-4o'), model('openai', 'gpt-5.2'), model('openai', 'gpt-5-mini')],
    expectedModelId: 'openai::gpt-5.2'
  },
  {
    vendor: 'gemini',
    providers: [provider('gemini')],
    models: [model('gemini', 'gemini-2.5-flash'), model('gemini', 'gemini-3.1-pro-preview')],
    expectedModelId: 'gemini::gemini-3.1-pro-preview'
  },
  {
    vendor: 'deepseek',
    providers: [provider('deepseek')],
    models: [model('deepseek', 'deepseek-reasoner'), model('deepseek', 'deepseek-chat')],
    expectedModelId: 'deepseek::deepseek-chat'
  },
  {
    vendor: 'kimi',
    providers: [provider('moonshot')],
    models: [model('moonshot', 'moonshot-v1-128k'), model('moonshot', 'kimi-k2.5')],
    expectedModelId: 'moonshot::kimi-k2.5'
  },
  {
    vendor: 'doubao',
    providers: [provider('doubao')],
    models: [model('doubao', 'ep-first'), model('doubao', 'doubao-second')],
    expectedModelId: 'doubao::ep-first'
  }
]

describe('official assistant model resolution', () => {
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

  it.each(preferredTierCases)(
    'selects the preferred $vendor chat tier',
    ({ vendor, providers, models, expectedModelId }) => {
      expect(resolveOfficialAssistantModel({ vendor, providers, models, defaultModelId: null })).toEqual({
        status: 'resolved',
        modelId: expectedModelId
      })
    }
  )

  it('selects a dated GPT-5 chat snapshot as the preferred OpenAI tier', () => {
    expect(
      resolveOfficialAssistantModel({
        vendor: 'openai',
        providers: [provider('openai')],
        models: [model('openai', 'gpt-4o'), model('openai', 'gpt-5.2-2025-12-11-chat-latest')],
        defaultModelId: null
      })
    ).toEqual({ status: 'resolved', modelId: 'openai::gpt-5.2-2025-12-11-chat-latest' })
  })

  it('uses an explicit same-vendor default before the preferred tier', () => {
    const providers = [provider('anthropic')]
    const models = [model('anthropic', 'claude-sonnet-4-6'), model('anthropic', 'claude-opus-4-1')]

    expect(
      resolveOfficialAssistantModel({
        vendor: 'anthropic',
        providers,
        models,
        defaultModelId: 'anthropic::claude-opus-4-1'
      })
    ).toEqual({ status: 'resolved', modelId: 'anthropic::claude-opus-4-1' })
  })

  it('ignores a default from another vendor instead of silently crossing vendors', () => {
    expect(
      resolveOfficialAssistantModel({
        vendor: 'anthropic',
        providers: [provider('openai')],
        models: [model('openai', 'gpt-5.2')],
        defaultModelId: 'openai::gpt-5.2'
      })
    ).toEqual({ status: 'configuration-required', providerId: 'anthropic' })
  })

  it.each([
    ['api-key', 'gemini', 'gemini-3.1-pro-preview', 'gemini'],
    ['api-key-aws', 'anthropic', 'global.anthropic.claude-sonnet-4-6-v1:0', 'anthropic'],
    ['iam-azure', 'openai', 'gpt-5-2', 'openai']
  ] as const)('requires credentials for a %s provider', (authType, vendor, apiModelId, officialProviderId) => {
    expect(
      resolveOfficialAssistantModel({
        vendor,
        providers: [provider('configured-provider', { apiKeys: [], authType })],
        models: [model('configured-provider', apiModelId)],
        defaultModelId: null
      })
    ).toEqual({ status: 'configuration-required', providerId: officialProviderId })
  })

  it('resolves a signed-in OAuth provider without API keys', () => {
    expect(
      resolveOfficialAssistantModel({
        vendor: 'openai',
        providers: [provider('openai-codex', { apiKeys: [], authMethods: ['oauth'], authType: 'oauth' })],
        models: [model('openai-codex', 'gpt-5-2')],
        defaultModelId: null
      })
    ).toEqual({ status: 'resolved', modelId: 'openai-codex::gpt-5-2' })
  })

  it('does not treat a logged-out OAuth provider as configured', () => {
    expect(
      resolveOfficialAssistantModel({
        vendor: 'openai',
        providers: [provider('openai-codex', { apiKeys: [], authMethods: ['oauth'], authType: 'api-key' })],
        models: [model('openai-codex', 'gpt-5-2')],
        defaultModelId: null
      })
    ).toEqual({ status: 'configuration-required', providerId: 'openai' })
  })

  it('resolves AWS IAM and normalizes Bedrock model ids before matching vendor and tier', () => {
    expect(
      resolveOfficialAssistantModel({
        vendor: 'anthropic',
        providers: [provider('aws-bedrock', { apiKeys: [], authType: 'iam-aws' })],
        models: [
          model('aws-bedrock', 'global.anthropic.claude-opus-4-1-v1:0'),
          model('aws-bedrock', 'global.anthropic.claude-sonnet-4-6-v1:0')
        ],
        defaultModelId: null
      })
    ).toEqual({ status: 'resolved', modelId: 'aws-bedrock::global.anthropic.claude-sonnet-4-6-v1:0' })
  })

  it('resolves a GCP IAM provider without API keys', () => {
    expect(
      resolveOfficialAssistantModel({
        vendor: 'gemini',
        providers: [provider('vertex-ai', { apiKeys: [], authType: 'iam-gcp' })],
        models: [model('vertex-ai', 'gemini-3.1-pro-preview')],
        defaultModelId: null
      })
    ).toEqual({ status: 'resolved', modelId: 'vertex-ai::gemini-3.1-pro-preview' })
  })

  it('normalizes a vendor-qualified raw Kimi model id before selecting its tier', () => {
    expect(
      resolveOfficialAssistantModel({
        vendor: 'kimi',
        providers: [provider('aggregator')],
        models: [model('aggregator', 'moonshot-v1-128k'), model('aggregator', 'moonshotai.kimi-k2.5')],
        defaultModelId: null
      })
    ).toEqual({ status: 'resolved', modelId: 'aggregator::moonshotai.kimi-k2.5' })
  })

  it('uses a canonical Kimi preset model link for vendor matching and tier selection', () => {
    expect(
      resolveOfficialAssistantModel({
        vendor: 'kimi',
        providers: [provider('aggregator')],
        models: [
          model('aggregator', 'moonshot-v1-128k'),
          model('aggregator', 'deployment-42', { presetModelId: 'kimi-k2-5' })
        ],
        defaultModelId: null
      })
    ).toEqual({ status: 'resolved', modelId: 'aggregator::deployment-42' })
  })

  it('excludes external-CLI providers even when authentication is optional', () => {
    expect(
      resolveOfficialAssistantModel({
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
        defaultModelId: null
      })
    ).toEqual({ status: 'configuration-required', providerId: 'anthropic' })
  })

  it('requires configuration when the provider has no enabled vendor model', () => {
    expect(
      resolveOfficialAssistantModel({
        vendor: 'deepseek',
        providers: [provider('deepseek')],
        models: [model('deepseek', 'deepseek-chat', { isEnabled: false }), model('deepseek', 'text-embedding-3-large')],
        defaultModelId: null
      })
    ).toEqual({ status: 'configuration-required', providerId: 'deepseek' })
  })
})
