import { MODALITY } from '@cherrystudio/provider-registry'
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
  it('covers every agent runtime and keeps structural invariants explicit', () => {
    expect(Object.keys(AGENT_RUNTIME_CAPABILITIES).sort()).toEqual(['claude-code', 'dsh', 'pi'])

    const transports = Object.values(AGENT_RUNTIME_CAPABILITIES).map((caps) => caps.transport)
    expect(new Set(transports).size).toBe(transports.length)

    for (const caps of Object.values(AGENT_RUNTIME_CAPABILITIES)) {
      expect(caps.permissionModes.length).toBeGreaterThan(0)
    }

    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].permissionModes).toContain('plan')
    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].permissionModes).toContain('auto')
    expect(AGENT_RUNTIME_CAPABILITIES.pi.permissionModes).not.toContain('plan')
    expect(AGENT_RUNTIME_CAPABILITIES.pi.permissionModes).not.toContain('auto')
    expect(AGENT_RUNTIME_CAPABILITIES.pi.createDefaults.permissionMode).toBe('acceptEdits')
    expect(AGENT_RUNTIME_CAPABILITIES.pi.knowledgeBases).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.pi.mcp).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.dsh.permissionModes).not.toContain('plan')
    expect(AGENT_RUNTIME_CAPABILITIES.dsh.permissionModes).not.toContain('auto')
    expect(AGENT_RUNTIME_CAPABILITIES.dsh.createDefaults.permissionMode).toBe('default')
    expect(AGENT_RUNTIME_CAPABILITIES.dsh.knowledgeBases).toBe(true)
    expect(AGENT_RUNTIME_CAPABILITIES.dsh.mcp).toBe(true)
    // The dsh commands Cherry mounts and dispatches over the bridge `command` frame.
    expect(AGENT_RUNTIME_CAPABILITIES.dsh.slashCommands.map((entry) => entry.command)).toEqual(['/compact', '/goal'])

    const dshTools = AGENT_RUNTIME_CAPABILITIES.dsh.builtinTools()
    expect(dshTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'todo_write', category: 'orchestration' }),
        expect.objectContaining({ id: 'skill', category: 'orchestration' }),
        expect.objectContaining({ id: 'read_image', category: 'file' }),
        expect.objectContaining({ id: 'mcp__cherry-tools__web_search', category: 'context' }),
        expect.objectContaining({ id: 'mcp__agent-memory__memory', category: 'context' })
      ])
    )
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
