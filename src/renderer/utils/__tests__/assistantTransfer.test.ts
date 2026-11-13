import { describe, expect, it } from 'vitest'

import type { Assistant } from '@shared/data/types/assistant'
import type { Prompt } from '@shared/data/types/prompt'

import {
  AssistantTransferError,
  parseAssistantImportContent,
  serializeAssistantForExport,
  serializeAssistantsForExport
} from '../assistantTransfer'

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
  it('exports one ordered preset array with grouped and ungrouped assistants and binding-ordered phrases', () => {
    const content = serializeAssistantsForExport([
      {
        assistant: createAssistant({ name: 'First', prompt: 'First role' }),
        groupName: 'Work',
        prompts: [
          createPrompt({ title: 'Z phrase', content: 'Z body', orderKey: 'z9' }),
          createPrompt({ title: 'A phrase', content: 'A body', orderKey: 'a0' })
        ]
      },
      { assistant: createAssistant({ id: 'ast-2', name: 'Second', prompt: 'Second role', groupId: null }), prompts: [] }
    ])
    const records = JSON.parse(content)
    expect(Array.isArray(records)).toBe(true)
    expect(records.map((record: Record<string, unknown>) => Object.keys(record))).toEqual([
      ['name', 'emoji', 'group', 'prompt', 'description', 'regularPhrases', 'type'],
      ['name', 'emoji', 'group', 'prompt', 'description', 'regularPhrases', 'type']
    ])
    expect(records.map((record: { type: string }) => record.type)).toEqual(['agent', 'agent'])
    expect(records[0].regularPhrases.map((phrase: { order: number }) => phrase.order)).toEqual([0, 1])
    const drafts = parseAssistantImportContent(content)
    expect(
      drafts.map(({ dto, groupName }) => ({
        name: dto.name,
        prompt: dto.prompt,
        groupName,
        phrases: dto.regularPhrases
      }))
    ).toEqual([
      {
        name: 'First',
        prompt: 'First role',
        groupName: 'Work',
        phrases: [
          { title: 'Z phrase', content: 'Z body' },
          { title: 'A phrase', content: 'A body' }
        ]
      },
      { name: 'Second', prompt: 'Second role', groupName: undefined, phrases: [] }
    ])
  })

  it('keeps singleton exports byte-compatible and refuses an empty batch', () => {
    const assistant = createAssistant()
    const prompts = [createPrompt()]
    expect(serializeAssistantsForExport([{ assistant, prompts, groupName: 'Work' }])).toBe(
      serializeAssistantForExport(assistant, prompts, 'Work')
    )
    expect(() => serializeAssistantsForExport([])).toThrow(AssistantTransferError)
  })

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

  it('parses legacy assistant imports', () => {
    const [draft] = parseAssistantImportContent(
      JSON.stringify({
        name: '旧助手',
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
    expect(draft.groupName).toBe('写作')
  })

  it('ignores v2-only fields from imported content', () => {
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
