import { type Assistant, ASSISTANT_SOURCE_USER } from '@shared/data/types/assistant'
import type { Tag } from '@shared/data/types/tag'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAssistantMutations, useAssistantMutationsById } from '../assistantAdapter'

const createTriggerMock = vi.hoisted(() => vi.fn())
const useMutationMock = vi.hoisted(() => vi.fn())

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: useMutationMock,
  useQuery: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      if (key === 'library.duplicate_name') {
        return `${vars?.name ?? ''} (副本)`
      }
      return key
    }
  })
}))

function createTag(id: string, name: string): Tag {
  return {
    id,
    name,
    color: '#3b82f6',
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z'
  }
}

function createAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'ast-source',
    source: 'user',
    name: '原助手',
    prompt: 'prompt',
    emoji: '💬',
    description: 'desc',
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
      customParameters: []
    },
    modelId: 'openai::gpt-4o',
    orderKey: 'a0',
    mcpServerIds: ['mcp-1'],
    knowledgeBaseIds: ['kb-1'],
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    tags: [],
    modelName: 'GPT-4o',
    ...overrides,
    source: overrides.source ?? ASSISTANT_SOURCE_USER,
    orderKey: overrides.orderKey ?? 'a0'
  }
}

describe('useAssistantMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMutationMock.mockReturnValue({
      trigger: createTriggerMock,
      isLoading: false,
      error: undefined
    })
  })

  it('forwards tag ids to the create endpoint when duplicating an assistant', async () => {
    const created = createAssistant({ id: 'ast-copy', tags: [] })
    createTriggerMock.mockResolvedValue(created)

    const source = createAssistant({
      tags: [createTag('tag-1', '生产力'), createTag('tag-2', '编程')]
    })

    const { result } = renderHook(() => useAssistantMutations())

    await act(async () => {
      await result.current.duplicateAssistant(source)
    })

    // Atomic: one POST /assistants carries the assistant payload AND the tag ids.
    // No follow-up PUT /tags/entities/... means no half-success window where the
    // row exists without its bindings.
    expect(createTriggerMock).toHaveBeenCalledTimes(1)
    expect(createTriggerMock).toHaveBeenCalledWith({
      body: {
        name: '原助手 (副本)',
        prompt: 'prompt',
        emoji: '💬',
        description: 'desc',
        modelId: 'openai::gpt-4o',
        settings: source.settings,
        mcpServerIds: ['mcp-1'],
        knowledgeBaseIds: ['kb-1'],
        tagIds: ['tag-1', 'tag-2']
      }
    })
  })

  it('does not carry preset provenance when duplicating an assistant', async () => {
    const presetSource = '550e8400-e29b-41d4-a716-446655440000'
    const created = createAssistant({ id: 'ast-copy', source: 'user', tags: [] })
    createTriggerMock.mockResolvedValue(created)

    const { result } = renderHook(() => useAssistantMutations())

    await act(async () => {
      await result.current.duplicateAssistant(createAssistant({ source: presetSource }))
    })

    expect(createTriggerMock.mock.calls[0]?.[0].body).not.toHaveProperty('source')
  })
})

describe('useAssistantMutationsById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMutationMock.mockReturnValue({
      trigger: createTriggerMock,
      isLoading: false,
      error: undefined
    })
  })

  it('refreshes assistant list and details after scoped mutations', () => {
    renderHook(() => useAssistantMutationsById('assistant-1'))

    expect(useMutationMock).toHaveBeenCalledWith('PATCH', '/assistants/assistant-1', {
      refresh: ['/assistants', '/assistants/*']
    })
    expect(useMutationMock).toHaveBeenCalledWith('DELETE', '/assistants/assistant-1', {
      refresh: ['/assistants', '/assistants/*']
    })
  })
})
