import { CHERRYAI_DEFAULT_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

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
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('AGENT_RUNTIME_CAPABILITIES', () => {
  it('covers every agent runtime and keeps structural invariants explicit', () => {
    expect(Object.keys(AGENT_RUNTIME_CAPABILITIES).sort()).toEqual(['claude-code', 'pi', 'stella'])

    const transports = Object.values(AGENT_RUNTIME_CAPABILITIES).map((caps) => caps.transport)
    expect(new Set(transports).size).toBe(transports.length)

    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].permissionModes).toContain('plan')
    expect(AGENT_RUNTIME_CAPABILITIES.pi.permissionModes).not.toContain('plan')
    expect(AGENT_RUNTIME_CAPABILITIES.stella).toMatchObject({
      requiresModel: false,
      remoteAgentSelection: true,
      prompt: false,
      mcp: false,
      skills: false,
      permissions: false
    })
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
})
