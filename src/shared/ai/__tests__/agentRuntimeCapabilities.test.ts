import { CHERRYAI_DEFAULT_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
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
    expect(Object.keys(AGENT_RUNTIME_CAPABILITIES).sort()).toEqual(['ai-sdk', 'claude-code', 'pi'])

    const transports = Object.values(AGENT_RUNTIME_CAPABILITIES).map((caps) => caps.transport)
    expect(new Set(transports).size).toBe(transports.length)

    for (const caps of Object.values(AGENT_RUNTIME_CAPABILITIES)) {
      expect(caps.permissionModes.length).toBeGreaterThan(0)
    }

    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].permissionModes).toContain('plan')
    expect(AGENT_RUNTIME_CAPABILITIES.pi.permissionModes).not.toContain('plan')
    expect(AGENT_RUNTIME_CAPABILITIES['ai-sdk'].permissionModes).not.toContain('plan')
  })

  it('ai-sdk executes unsandboxed main-process tools, so it must default to the gated mode', () => {
    expect(AGENT_RUNTIME_CAPABILITIES['ai-sdk'].createDefaults.permissionMode).toBe('default')
    expect(AGENT_RUNTIME_CAPABILITIES['ai-sdk'].modelTiers).toBe(false)
    expect(AGENT_RUNTIME_CAPABILITIES['ai-sdk'].heartbeat).toBe(false)
    expect(AGENT_RUNTIME_CAPABILITIES['ai-sdk'].claudeRegistryTools).toBe(false)
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

    it('ai-sdk delegates to the shared fail-closed predicate: managed default barred, tool-calling model accepted', () => {
      const aiSdkIsCompatible = AGENT_RUNTIME_CAPABILITIES['ai-sdk'].isModelCompatible
      const toolCallingModel = makeModel({ capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] })
      expect(aiSdkIsCompatible(cherryProvider, managedDefaultModel)).toBe(false)
      expect(aiSdkIsCompatible(undefined, toolCallingModel)).toBe(false)
      expect(aiSdkIsCompatible(makeProvider({}), toolCallingModel)).toBe(true)
    })
  })
})
