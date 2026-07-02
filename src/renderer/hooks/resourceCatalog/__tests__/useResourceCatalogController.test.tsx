import type { UniqueModelId } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useResourceCatalogController } from '../useResourceCatalogController'

const controllerMocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  createAssistant: vi.fn(),
  duplicateAssistant: vi.fn(),
  ensureTags: vi.fn(),
  refetch: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../useResourceLibrary', () => ({
  useResourceLibrary: () => ({
    allResources: [],
    error: undefined,
    isLoading: false,
    isRefreshing: false,
    refetch: controllerMocks.refetch,
    resources: []
  })
}))

vi.mock('../assistantAdapter', () => ({
  useAssistantMutations: () => ({
    createAssistant: controllerMocks.createAssistant,
    duplicateAssistant: controllerMocks.duplicateAssistant
  })
}))

vi.mock('../agentAdapter', () => ({
  useAgentMutations: () => ({
    createAgent: controllerMocks.createAgent
  })
}))

vi.mock('@renderer/hooks/useTags', () => ({
  useEnsureTags: () => ({ ensureTags: controllerMocks.ensureTags }),
  useTagList: () => ({ tags: [] })
}))

const createValues = {
  avatar: 'A',
  description: 'A focused helper',
  knowledgeBaseIds: ['kb-1'],
  modelId: 'provider:model' as UniqueModelId,
  name: 'New resource',
  prompt: 'Stay focused',
  skillIds: ['skill-1']
}

describe('useResourceCatalogController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    controllerMocks.createAssistant.mockResolvedValue({ id: 'assistant-created' })
    controllerMocks.createAgent.mockResolvedValue({ id: 'agent-created' })
    controllerMocks.refetch.mockResolvedValue(undefined)
  })

  it('creates an assistant and refetches the resource list', async () => {
    const { result } = renderHook(() => useResourceCatalogController('assistant'))

    act(() => {
      result.current.gridProps.onCreate('assistant')
    })

    await act(async () => {
      await result.current.dialogs.handleSubmitCreateResource(createValues)
    })

    expect(controllerMocks.createAssistant).toHaveBeenCalledWith({
      description: createValues.description,
      emoji: createValues.avatar,
      knowledgeBaseIds: createValues.knowledgeBaseIds,
      modelId: createValues.modelId,
      name: createValues.name,
      prompt: createValues.prompt
    })
    expect(controllerMocks.refetch).toHaveBeenCalledOnce()
    expect(result.current.dialogs.createDialogOpen).toBe(false)
  })

  it('creates an agent and refetches the resource list', async () => {
    const { result } = renderHook(() => useResourceCatalogController('agent'))

    act(() => {
      result.current.gridProps.onCreate('agent')
    })

    await act(async () => {
      await result.current.dialogs.handleSubmitCreateResource(createValues)
    })

    expect(controllerMocks.createAgent).toHaveBeenCalledWith({
      configuration: {
        avatar: createValues.avatar,
        permission_mode: 'bypassPermissions',
        soul_enabled: true
      },
      description: createValues.description,
      instructions: createValues.prompt,
      model: createValues.modelId,
      name: createValues.name,
      planModel: createValues.modelId,
      skillIds: createValues.skillIds,
      smallModel: createValues.modelId,
      type: 'claude-code'
    })
    expect(controllerMocks.refetch).toHaveBeenCalledOnce()
    expect(result.current.dialogs.createDialogOpen).toBe(false)
  })
})
