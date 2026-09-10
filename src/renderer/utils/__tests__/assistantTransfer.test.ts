import { type Assistant, LEGACY_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { Prompt } from '@shared/data/types/prompt'
import { describe, expect, it } from 'vitest'

import { AssistantTransferError, parseAssistantImportContent, serializeAssistantForExport } from '../assistantTransfer'

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
      maxToolCalls: 20,
      enableMaxToolCalls: true,
      enableWebSearch: false,
      enableGenerateImage: false,
      enableRuntimeContext: false,
      customParameters: []
    },
    modelId: 'openai::gpt-4o',
    groupId: '11111111-1111-4111-8111-111111111111',
    orderKey: 'a0',
    mcpServerIds: ['mcp-1'],
    knowledgeBaseIds: ['kb-1'],
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    modelName: 'GPT-4o',
    ...overrides
  }
}

function createPrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    title: 'Greeting',
    content: 'Hello ${name}',
    visibility: 'restricted',
    orderKey: 'a0',
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides
  }
}

describe('assistantTransfer', () => {
  it('serializes assistants using the legacy preset export shape', () => {
    const content = serializeAssistantForExport(createAssistant(), [createPrompt()], '写作')

    expect(JSON.parse(content)).toEqual([
      {
        name: '写作助手',
        emoji: '✍️',
        group: ['写作'],
        prompt: 'You are helpful',
        description: '擅长写作润色',
        regularPhrases: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Greeting',
            content: 'Hello ${name}',
            createdAt: 1776643200000,
            updatedAt: 1776729600000,
            order: 0
          }
        ],
        type: 'agent'
      }
    ])
  })

  it('round-trips contextual prompts in binding order', () => {
    const prompts = [
      createPrompt({ title: 'Second in catalog, first for target', orderKey: 'z9' }),
      createPrompt({ id: '550e8400-e29b-41d4-a716-446655440001', title: 'Next for target', orderKey: 'a0' })
    ]

    const [draft] = parseAssistantImportContent(serializeAssistantForExport(createAssistant(), prompts))

    expect(draft.dto.regularPhrases).toEqual([
      { title: 'Second in catalog, first for target', content: 'Hello ${name}' },
      { title: 'Next for target', content: 'Hello ${name}' }
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
    expect(draft.dto).not.toHaveProperty('modelId')
    expect(draft.dto.settings).toEqual(LEGACY_ASSISTANT_SETTINGS)
    expect(draft.groupName).toBe('写作')
  })

  it('uses the default emoji when a legacy import contains an empty emoji', () => {
    const [draft] = parseAssistantImportContent(
      JSON.stringify({
        name: '无图标助手',
        emoji: '',
        prompt: 'legacy prompt'
      })
    )

    expect(draft.dto.emoji).toBe('🤖')
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
    expect(draft.dto).not.toHaveProperty('modelId')
    expect(draft.dto).not.toHaveProperty('mcpServerIds')
    expect(draft.dto).not.toHaveProperty('knowledgeBaseIds')
    expect(draft.dto.settings).toMatchObject({
      temperature: 1,
      enableTemperature: false
    })
    expect(draft.groupName).toBe('编程')
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
