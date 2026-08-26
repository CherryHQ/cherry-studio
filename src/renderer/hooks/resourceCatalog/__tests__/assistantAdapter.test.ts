import type { Assistant } from '@shared/data/types/assistant'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useImportAssistantMutation } from '../assistantAdapter'

const importTriggerMock = vi.hoisted(() => vi.fn())
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

function createAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'ast-source',
    orderKey: 'a0',
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
      enableGenerateImage: false,
      enableRuntimeContext: false,
      customParameters: []
    },
    modelId: 'openai::gpt-4o',
    groupId: null,
    mcpServerIds: ['mcp-1'],
    knowledgeBaseIds: ['kb-1'],
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    modelName: 'GPT-4o',
    ...overrides
  }
}

describe('useImportAssistantMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('imports an assistant through the atomic import endpoint and refreshes groups', async () => {
    const imported = createAssistant({ id: 'ast-imported', groupId: '11111111-1111-4111-8111-111111111111' })
    importTriggerMock.mockResolvedValue(imported)
    useMutationMock.mockReturnValue({
      trigger: importTriggerMock,
      isLoading: false,
      error: undefined
    })

    const { result } = renderHook(() => useImportAssistantMutation())

    await act(async () => {
      await result.current.importAssistant({ name: 'Imported', prompt: 'prompt', groupName: 'work' })
    })

    expect(useMutationMock).toHaveBeenCalledWith('POST', '/assistants:import', {
      refresh: ['/assistants', '/groups']
    })
    expect(importTriggerMock).toHaveBeenCalledWith({
      body: { name: 'Imported', prompt: 'prompt', groupName: 'work' }
    })
  })
})
