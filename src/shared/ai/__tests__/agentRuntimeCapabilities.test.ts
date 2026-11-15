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
import { normalizePiDisabledToolId } from '../piBuiltinTools'

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
  it.each(['claude-code', 'pi', 'pi-durable'] as const)(
    'projects public MCP tools with native identities for %s',
    (runtime) => {
      const ids = AGENT_RUNTIME_CAPABILITIES[runtime].builtinTools('darwin').map((tool) => tool.id)
      const server = runtime === 'claude-code' ? 'cherry-tools' : 'cherry_tools'
      const memory = runtime === 'claude-code' ? 'mcp__agent-memory__memory' : 'mcp__agent_memory__memory'
      expect(ids.filter((id) => id.startsWith('mcp__'))).toHaveLength(10)
      for (const name of [
        'web_search',
        'web_fetch',
        'kb_search',
        'kb_manage',
        'to_markdown',
        'cron',
        'notify',
        'config',
        'generate_image'
      ]) {
        expect(ids).toContain(`mcp__${server}__${name}`)
      }
      expect(ids).toContain(memory)
      expect(ids).not.toContain(`mcp__${server}__kb_read`)
      expect(ids).toContain(runtime === 'claude-code' ? 'Bash' : 'bash')
      expect(ids.includes('vcc_recall')).toBe(runtime === 'pi')
    }
  )

  it.each([
    ['claude-code', 'mcp__cherry-tools__generate_image', 'mcp__agent-memory__memory'],
    ['pi', 'mcp__cherry_tools__generate_image', 'mcp__agent_memory__memory'],
    ['pi-durable', 'mcp__cherry_tools__generate_image', 'mcp__agent_memory__memory']
  ] as const)('persists literal MCP identities for %s', (runtime, image, memory) => {
    const ids = AGENT_RUNTIME_CAPABILITIES[runtime].builtinTools().map((tool) => tool.id)
    expect(ids).toContain(image)
    expect(ids).toContain(memory)
  })

  it.each(['pi', 'pi-durable'] as const)('offers PowerShell only on Windows for %s', (runtime) => {
    const tools = AGENT_RUNTIME_CAPABILITIES[runtime].builtinTools
    expect(tools('win32').map((tool) => tool.id)).toContain('powershell')
    expect(tools('darwin').map((tool) => tool.id)).not.toContain('powershell')
    expect(tools('linux').map((tool) => tool.id)).not.toContain('powershell')
    expect(normalizePiDisabledToolId('PowerShell')).toBe('powershell')
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
