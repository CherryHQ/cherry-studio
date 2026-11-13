import { describe, expect, it } from 'vitest'

import type { ResourceCreateValues } from '@renderer/types/resourceCatalog'
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
