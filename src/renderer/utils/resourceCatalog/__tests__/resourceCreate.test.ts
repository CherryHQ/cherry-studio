import { describe, expect, it } from 'vitest'

import type { AgentCreateSettings, ResourceCreateValues } from '@renderer/types/resourceCatalog'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { buildCreateAgentCommand, buildCreateAssistantDto } from '../resourceCreate'

const values: ResourceCreateValues = {
  agentType: 'claude-code',
  permissionMode: 'auto',
  avatar: '🤖',
  name: 'Researcher',
  modelId: 'provider::model',
  description: 'Investigates a topic',
  prompt: 'Use cited sources',
  knowledgeBaseIds: ['kb-1'],
  skillIds: ['skill-1']
}

const defaultSettings: AgentCreateSettings = {
  languageMode: 'inherit',
  languageCustom: '',
  heartbeatEnabled: false,
  heartbeatInterval: 30,
  heartbeatTimeoutMinutes: 2,
  envVarsText: ''
}

describe('resource create DTO mapping', () => {
  it('maps every assistant-specific field', () => {
    expect(buildCreateAssistantDto(values)).toEqual({
      name: 'Researcher',
      emoji: '🤖',
      modelId: 'provider::model',
      description: 'Investigates a topic',
      prompt: 'Use cited sources',
      knowledgeBaseIds: ['kb-1']
    })
  })

  it('links auto-selected MCP servers and enables web search on a new assistant', () => {
    const dto = buildCreateAssistantDto({ ...values, mcpServerIds: ['mcp-1'], enableWebSearch: true })

    expect(dto.mcpServerIds).toEqual(['mcp-1'])
    expect(dto.settings).toEqual({ ...DEFAULT_ASSISTANT_SETTINGS, enableWebSearch: true })
  })

  it('keeps assistant settings at their defaults when web search is not selected', () => {
    expect(buildCreateAssistantDto({ ...values, enableWebSearch: false })).not.toHaveProperty('settings')
  })

  it.each(['claude-code', 'pi', 'pi-durable'] as const)(
    'sends auto-selected MCP servers to a %s agent only when its runtime supports MCP',
    (agentType) => {
      const command = buildCreateAgentCommand({ ...values, agentType, mcpServerIds: ['mcp-1'] })

      if (AGENT_RUNTIME_CAPABILITIES[agentType].mcp) expect(command.mcps).toEqual(['mcp-1'])
      else expect(command).not.toHaveProperty('mcps')
    }
  )

  it('maps every agent-specific field', () => {
    expect(buildCreateAgentCommand(values)).toEqual({
      type: 'claude-code',
      name: 'Researcher',
      model: 'provider::model',
      planModel: 'provider::model',
      smallModel: 'provider::model',
      description: 'Investigates a topic',
      instructions: 'Use cited sources',
      knowledgeBaseIds: ['kb-1'],
      skillIds: ['skill-1'],
      configuration: {
        avatar: '🤖',
        permission_mode: 'auto'
      }
    })
  })

  it('sends switched-off tools and the advanced settings under the configuration keys the edit dialog saves', () => {
    const command = buildCreateAgentCommand({
      ...values,
      agentType: 'pi-durable',
      disabledTools: ['write', 'bash'],
      agentSettings: {
        languageMode: 'custom',
        languageCustom: '日本語',
        heartbeatEnabled: true,
        heartbeatInterval: 45,
        heartbeatTimeoutMinutes: 10,
        envVarsText: 'API_KEY=secret\n\nQUERY=a=b'
      }
    })

    expect(command.disabledTools).toEqual(['write', 'bash'])
    expect(command.configuration).toEqual({
      avatar: '🤖',
      permission_mode: 'auto',
      language: '日本語',
      heartbeat_enabled: true,
      heartbeat_interval: 45,
      heartbeat_timeout_minutes: 10,
      env_vars: { API_KEY: 'secret', QUERY: 'a=b' }
    })
  })

  it('stores "no language constraint" as null, unlike following the global language', () => {
    const command = buildCreateAgentCommand({
      ...values,
      agentSettings: { ...defaultSettings, languageMode: 'off' }
    })

    expect(command.configuration).toHaveProperty('language', null)
  })

  it('leaves the configuration and tools untouched when every advanced setting is at its default', () => {
    const command = buildCreateAgentCommand({ ...values, disabledTools: [], agentSettings: defaultSettings })

    expect(command.configuration).toEqual({ avatar: '🤖', permission_mode: 'auto' })
    expect(command).not.toHaveProperty('disabledTools')
  })

  it('uses pi runtime defaults and omits unsupported model tiers', () => {
    expect(buildCreateAgentCommand({ ...values, agentType: 'pi', permissionMode: 'acceptEdits' })).toEqual({
      type: 'pi',
      name: 'Researcher',
      model: 'provider::model',
      description: 'Investigates a topic',
      instructions: 'Use cited sources',
      knowledgeBaseIds: ['kb-1'],
      skillIds: ['skill-1'],
      configuration: { avatar: '🤖', permission_mode: 'acceptEdits' }
    })
  })
})
