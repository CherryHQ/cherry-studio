import { describe, expect, it } from 'vitest'

import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { type AssistantCreateValues, buildCreateAssistantDto } from '../assistantCreateDto'

const values: AssistantCreateValues = {
  avatar: '🤖',
  name: 'Researcher',
  modelId: 'provider::model',
  description: 'Investigates a topic',
  prompt: 'Use cited sources',
  knowledgeBaseIds: ['kb-1']
}

describe('buildCreateAssistantDto', () => {
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

  it('stores a chosen reply language in the settings', () => {
    const dto = buildCreateAssistantDto({ ...values, replyLanguage: { mode: 'custom', language: 'English' } })

    expect(dto.settings).toEqual({
      ...DEFAULT_ASSISTANT_SETTINGS,
      replyLanguage: { mode: 'custom', language: 'English' }
    })
  })
})
