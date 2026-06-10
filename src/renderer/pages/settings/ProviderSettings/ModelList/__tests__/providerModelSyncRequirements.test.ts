import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { providerNeedsApiKeyForModelSync } from '../providerModelSyncRequirements'

const makeProvider = (overrides: Partial<Provider>): Provider =>
  ({
    id: 'custom',
    name: 'Custom',
    apiKeys: [],
    authType: 'api-key',
    apiFeatures: {} as Provider['apiFeatures'],
    settings: {} as Provider['settings'],
    isEnabled: false,
    ...overrides
  }) as Provider

describe('providerNeedsApiKeyForModelSync', () => {
  it('exempts canonical local providers matched by id', () => {
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'ollama' }))).toBe(false)
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'lmstudio' }))).toBe(false)
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'copilot' }))).toBe(false)
  })

  it('exempts duplicated local providers that keep presetProviderId but get a new id', () => {
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'ollama-copy', presetProviderId: 'ollama' }))).toBe(false)
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'lm-2', presetProviderId: 'lmstudio' }))).toBe(false)
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'cp-2', presetProviderId: 'copilot' }))).toBe(false)
  })

  it('exempts an Ollama provider identified only by its endpoint', () => {
    expect(
      providerNeedsApiKeyForModelSync(makeProvider({ id: 'local', defaultChatEndpoint: ENDPOINT_TYPE.OLLAMA_CHAT }))
    ).toBe(false)
  })

  it('exempts IAM-authenticated providers', () => {
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'vertexai', authType: 'iam-gcp' }))).toBe(false)
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'aws-bedrock', authType: 'iam-aws' }))).toBe(false)
  })

  it('requires an API key for normal cloud providers, including duplicated ones', () => {
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'openai' }))).toBe(true)
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'openai-copy', presetProviderId: 'openai' }))).toBe(true)
  })
})
