import { describe, expect, it } from 'vitest'

import {
  CHERRY_CLOUD_MODEL_GROUP,
  CHERRY_CLOUD_PROVIDER_ID,
  CHERRYAI_DEFAULT_MODEL_ID,
  CHERRYAI_PROVIDER_ID
} from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { AGENT_RUNTIME_CAPABILITIES } from '../agentRuntimeCapabilities'

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    id: 'p',
    name: 'P',
    defaultChatEndpoint: 'anthropic-messages',
    endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic' } },
    ...overrides
  } as Provider
}

function makeModel(overrides: Partial<Model>): Model {
  return {
    id: 'p::m',
    providerId: 'p',
    name: 'M',
    capabilities: [],
    contextWindow: 128_000,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  }
}

describe('AGENT_RUNTIME_CAPABILITIES', () => {
  it('keeps permission choices aligned with each runtime approval implementation', () => {
    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].permissionModes).toContain('plan')
    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].permissionModes).toContain('auto')
    expect(AGENT_RUNTIME_CAPABILITIES.pi.permissionModes).not.toContain('plan')
    // pi implements `auto` itself in the approval extension, so it offers it.
    expect(AGENT_RUNTIME_CAPABILITIES.pi.permissionModes).toContain('auto')
    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].createDefaults.permissionMode).toBe('auto')
    expect(AGENT_RUNTIME_CAPABILITIES.pi.createDefaults.permissionMode).toBe('auto')
  })

  describe('isModelCompatible — managed CherryAI default model', () => {
    const piIsCompatible = AGENT_RUNTIME_CAPABILITIES.pi.isModelCompatible
    const claudeIsCompatible = AGENT_RUNTIME_CAPABILITIES['claude-code'].isModelCompatible

    // A CherryAI provider whose endpoint pi can drive, hosting the managed free-quota default model.
    const cherryProvider = makeProvider({ id: CHERRYAI_PROVIDER_ID })
    const managedDefaultModel = makeModel({
      providerId: CHERRYAI_PROVIDER_ID,
      apiModelId: CHERRYAI_DEFAULT_MODEL_ID
    })

    it('pi rejects the managed CherryAI default model even though the provider is drivable', () => {
      expect(piIsCompatible(cherryProvider, managedDefaultModel)).toBe(false)
    })

    it('pi still accepts a normal pi-compatible model', () => {
      const provider = makeProvider({})
      expect(piIsCompatible(provider, makeModel({}))).toBe(true)
    })

    it('claude behavior is unchanged: it also bars the managed default and accepts a normal model', () => {
      expect(claudeIsCompatible(cherryProvider, managedDefaultModel)).toBe(false)
      expect(claudeIsCompatible(makeProvider({}), makeModel({}))).toBe(true)
    })
  })

  it('offers synchronized Cherry Cloud models to every Work runtime', () => {
    const provider = makeProvider({ id: CHERRY_CLOUD_PROVIDER_ID })
    const cloudModel = makeModel({
      id: `${CHERRY_CLOUD_PROVIDER_ID}::deepseek-free`,
      providerId: CHERRY_CLOUD_PROVIDER_ID,
      apiModelId: 'deepseek-free',
      group: CHERRY_CLOUD_MODEL_GROUP,
      contextWindow: 128_000,
      maxOutputTokens: 8_192
    })

    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].isModelCompatible(provider, cloudModel)).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.pi.isModelCompatible(provider, cloudModel)).toBe(true)
  })

  it('does not grant Cloud compatibility from the display group alone', () => {
    const provider = makeProvider({ id: CHERRYAI_PROVIDER_ID, authMethods: ['external-cli'] })
    const model = makeModel({
      providerId: CHERRYAI_PROVIDER_ID,
      group: CHERRY_CLOUD_MODEL_GROUP,
      capabilities: ['embedding']
    })

    expect(AGENT_RUNTIME_CAPABILITIES.pi.isModelCompatible(provider, model)).toBe(false)
  })
})
