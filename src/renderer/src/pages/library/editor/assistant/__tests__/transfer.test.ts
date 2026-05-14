import type { Assistant } from '@shared/data/types/assistant'
import type { Tag } from '@shared/data/types/tag'
import { describe, expect, it } from 'vitest'

import { AssistantTransferError, parseAssistantImportContent, serializeAssistantForExport } from '../transfer'

function createTag(id: string, name: string, color: string | null = '#3b82f6'): Tag {
  return {
    id,
    name,
    color,
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z'
  }
}

function createAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'ast-1',
    name: '写作助手',
    prompt: 'You are helpful',
    emoji: '✍️',
    description: '擅长写作润色',
    settings: {
      temperature: 1,
      enableTemperature: false,
      topP: 1,
      enableTopP: false,
      maxTokens: 4096,
      enableMaxTokens: false,
      streamOutput: true,
      reasoning_effort: 'default',
      mcpMode: 'auto',
      toolUseMode: 'function',
      maxToolCalls: 20,
      enableMaxToolCalls: true,
      enableWebSearch: false,
      customParameters: []
    },
    modelId: 'openai::gpt-4o',
    orderKey: 'a0',
    mcpServerIds: ['mcp-1'],
    knowledgeBaseIds: ['kb-1'],
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    tags: [createTag('tag-1', '写作')],
    modelName: 'GPT-4o',
    ...overrides
  }
}

describe('assistantTransfer', () => {
  it('serializes assistants using the legacy preset export shape', () => {
    const content = serializeAssistantForExport(
      createAssistant({
        tags: [createTag('tag-1', '写作', '#10b981'), createTag('tag-2', '生产力', null)]
      })
    )

    expect(JSON.parse(content)).toEqual([
      {
        name: '写作助手',
        emoji: '✍️',
        group: ['写作', '生产力'],
        prompt: 'You are helpful',
        description: '擅长写作润色',
        regularPhrases: [],
        type: 'agent'
      }
    ])
  })

  it('parses legacy assistant imports with the original defaults', () => {
    const [draft] = parseAssistantImportContent(
      JSON.stringify({
        name: '旧助手',
        emoji: '🤖',
        prompt: 'legacy prompt',
        description: 'legacy desc',
        group: ['写作', '生产力']
      })
    )

    expect(draft.dto).toMatchObject({
      name: '旧助手',
      emoji: '🤖',
      prompt: 'legacy prompt',
      description: 'legacy desc'
    })
    // modelId is intentionally not part of the DTO — the backend fills it from
    // the `chat.default_model_id` preference during create.
    expect(draft.dto.modelId).toBeUndefined()
    expect(draft.tags).toEqual([
      { name: '写作', color: null },
      { name: '生产力', color: null }
    ])
  })

  it('ignores v2-only fields from imported content and still uses legacy defaults', () => {
    const [draft] = parseAssistantImportContent(
      JSON.stringify({
        name: '新助手',
        prompt: 'still required',
        settings: { temperature: 0.6, enableTemperature: true },
        modelId: 'custom::model',
        mcpServerIds: ['mcp-1'],
        knowledgeBaseIds: ['kb-1'],
        group: ['编程']
      })
    )

    expect(draft.dto).toMatchObject({
      name: '新助手',
      prompt: 'still required'
    })
    // Fields we don't carry across the import boundary.
    expect(draft.dto.modelId).toBeUndefined()
    expect(draft.dto.mcpServerIds).toBeUndefined()
    expect(draft.dto.knowledgeBaseIds).toBeUndefined()
    expect(draft.dto.settings).toMatchObject({
      temperature: 1,
      enableTemperature: false
    })
    expect(draft.tags).toEqual([{ name: '编程', color: null }])
  })

  it('throws invalid_format when required legacy fields are missing', () => {
    expect(() => parseAssistantImportContent('{bad json}')).toThrowError(AssistantTransferError)
    expect(() => parseAssistantImportContent(JSON.stringify({ name: 'missing prompt' }))).toThrowError(
      AssistantTransferError
    )
    expect(() => parseAssistantImportContent(JSON.stringify({ prompt: 'missing name' }))).toThrowError(
      AssistantTransferError
    )
  })
})
