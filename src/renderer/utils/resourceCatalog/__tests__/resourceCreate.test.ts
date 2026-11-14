import { describe, expect, it } from 'vitest'

import type { ResourceCreateValues } from '@renderer/types/resourceCatalog'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { buildCreateAssistantDto } from '../resourceCreate'

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
})
