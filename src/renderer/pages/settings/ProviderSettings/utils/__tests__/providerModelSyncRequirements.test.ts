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
  it('exempts credential-free local providers via the authOptional registry flag', () => {
    // ollama / lmstudio / gpustack / ovms carry authOptional from the registry;
    // a duplicate inherits it through the preset merge, so it holds regardless of id.
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'ollama', authOptional: true }))).toBe(false)
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'lmstudio', authOptional: true }))).toBe(false)
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'gpustack', authOptional: true }))).toBe(false)
    expect(
      providerNeedsApiKeyForModelSync(makeProvider({ id: 'ollama-2', presetProviderId: 'ollama', authOptional: true }))
    ).toBe(false)
  })

  it('exempts copilot (OAuth), matched by preset so duplicates are covered too', () => {
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'copilot' }))).toBe(false)
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'cp-2', presetProviderId: 'copilot' }))).toBe(false)
  })

  it('exempts IAM-authenticated providers', () => {
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'vertexai', authType: 'iam-gcp' }))).toBe(false)
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'aws-bedrock', authType: 'iam-aws' }))).toBe(false)
  })

  // Login-based CLI providers (claude-code, codex, grok-cli) carry no API key and
  // serve models from the shipped registry catalog, so model sync must run
  // without a key — otherwise nothing materializes into user_model after login.
  it('exempts registry-sourced providers (login-based CLI providers)', () => {
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'claude-code', modelListSource: 'registry' }))).toBe(
      false
    )
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'openai-codex', modelListSource: 'registry' }))).toBe(
      false
    )
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'grok-cli', modelListSource: 'registry' }))).toBe(false)
  })

  it('requires an API key for normal cloud providers, including duplicated ones', () => {
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'openai' }))).toBe(true)
    expect(providerNeedsApiKeyForModelSync(makeProvider({ id: 'openai-copy', presetProviderId: 'openai' }))).toBe(true)
  })
})
