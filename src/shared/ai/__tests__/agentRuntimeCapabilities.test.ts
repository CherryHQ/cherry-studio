import { MODALITY } from '@cherrystudio/provider-registry'
import { getDshRuntimeBuiltinTools } from '@shared/ai/dshBuiltinTools'
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
    contextWindow: 128_000,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('AGENT_RUNTIME_CAPABILITIES', () => {
  it('projects the stable shell toggle to pwsh only on Windows', () => {
    expect(getDshRuntimeBuiltinTools('darwin').map((tool) => tool.name)).toContain('bash')
    expect(getDshRuntimeBuiltinTools('win32').map((tool) => tool.name)).toContain('pwsh')
    expect(getDshRuntimeBuiltinTools('win32').map((tool) => tool.name)).not.toContain('bash')
  })

  it('keeps permission choices aligned with each runtime approval implementation', () => {
    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].permissionModes).toContain('plan')
    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].permissionModes).toContain('auto')
    expect(AGENT_RUNTIME_CAPABILITIES.pi.permissionModes).not.toContain('plan')
    // pi implements `auto` itself in the approval extension, so it offers it.
    expect(AGENT_RUNTIME_CAPABILITIES.pi.permissionModes).toContain('auto')
    // dsh plan mode is enforced by the bridge policy (its own plan mode is guidance-only).
    expect(AGENT_RUNTIME_CAPABILITIES.dsh.permissionModes).toContain('plan')
    expect(AGENT_RUNTIME_CAPABILITIES.dsh.permissionModes).not.toContain('auto')
    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].createDefaults.permissionMode).toBe('auto')
    expect(AGENT_RUNTIME_CAPABILITIES.pi.createDefaults.permissionMode).toBe('auto')
    expect(AGENT_RUNTIME_CAPABILITIES.dsh.createDefaults.permissionMode).toBe('acceptEdits')
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

    it('dsh rejects the managed CherryAI default model and accepts a normal compatible model', () => {
      const dshIsCompatible = AGENT_RUNTIME_CAPABILITIES.dsh.isModelCompatible
      expect(dshIsCompatible(cherryProvider, managedDefaultModel)).toBe(false)
      expect(dshIsCompatible(makeProvider({}), makeModel({}))).toBe(true)
    })
  })

  describe('dsh model input compatibility', () => {
    const isCompatible = AGENT_RUNTIME_CAPABILITIES.dsh.isModelCompatible
    const provider = makeProvider({})

    it('accepts undeclared and text-capable multimodal inputs', () => {
      expect(isCompatible(provider, makeModel({}))).toBe(true)
      expect(isCompatible(provider, makeModel({ inputModalities: [MODALITY.TEXT, MODALITY.AUDIO] }))).toBe(true)
      expect(isCompatible(provider, makeModel({ inputModalities: [MODALITY.TEXT, MODALITY.VIDEO] }))).toBe(true)
    })

    it('rejects models that explicitly cannot accept text', () => {
      expect(isCompatible(provider, makeModel({ inputModalities: [] }))).toBe(false)
      expect(isCompatible(provider, makeModel({ inputModalities: [MODALITY.AUDIO] }))).toBe(false)
      expect(isCompatible(provider, makeModel({ inputModalities: [MODALITY.VIDEO] }))).toBe(false)
    })
  })
})
