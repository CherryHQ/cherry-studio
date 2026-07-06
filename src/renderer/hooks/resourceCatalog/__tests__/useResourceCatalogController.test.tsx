import type { ResourceItem } from '@renderer/types/resourceCatalog'
import type { UniqueModelId } from '@shared/data/types/model'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useResourceCatalogController } from '../useResourceCatalogController'

type ControllerResourceType = Parameters<typeof useResourceCatalogController>[0]

const controllerMocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  createAssistant: vi.fn(),
  duplicateAssistant: vi.fn(),
  ensureTags: vi.fn(),
  refetch: vi.fn(),
  resourceLibraryOptions: [] as unknown[],
  resourceLibraryState: {
    allResources: [] as ResourceItem[],
    error: undefined as Error | undefined,
    isLoading: false,
    resources: [] as ResourceItem[]
  },
  saveFile: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../useResourceLibrary', () => ({
  useResourceLibrary: (options: unknown) => {
    controllerMocks.resourceLibraryOptions.push(options)
    return {
      allResources: controllerMocks.resourceLibraryState.allResources,
      error: controllerMocks.resourceLibraryState.error,
      isLoading: controllerMocks.resourceLibraryState.isLoading,
      isRefreshing: false,
      refetch: controllerMocks.refetch,
      resources: controllerMocks.resourceLibraryState.resources
    }
  }
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

const assistantResource = {
  id: 'assistant-to-duplicate',
  type: 'assistant',
  name: 'Assistant to duplicate',
  description: '',
  avatar: 'A',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  raw: { id: 'assistant-to-duplicate', name: 'Assistant to duplicate', tags: [] }
} as unknown as ResourceItem

describe('useResourceCatalogController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    controllerMocks.createAssistant.mockResolvedValue({ id: 'assistant-created' })
    controllerMocks.createAgent.mockResolvedValue({ id: 'agent-created' })
    controllerMocks.refetch.mockResolvedValue(undefined)
    controllerMocks.resourceLibraryOptions.length = 0
    controllerMocks.resourceLibraryState.allResources = []
    controllerMocks.resourceLibraryState.error = undefined
    controllerMocks.resourceLibraryState.isLoading = false
    controllerMocks.resourceLibraryState.resources = []
    controllerMocks.saveFile.mockResolvedValue('/tmp/assistant.json')
    Object.assign(window, {
      api: {
        ...window.api,
        file: {
          ...window.api.file,
          save: controllerMocks.saveFile
        }
      },
      toast: { ...window.toast, error: controllerMocks.toastError }
    })
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

  it('reports assistant duplicate failures without refetching', async () => {
    controllerMocks.duplicateAssistant.mockRejectedValueOnce(new Error('duplicate failed'))
    const { result } = renderHook(() => useResourceCatalogController('assistant'))

    await act(async () => {
      await result.current.gridProps.onDuplicate(assistantResource)
    })

    expect(controllerMocks.toastError).toHaveBeenCalledWith('duplicate failed')
    expect(controllerMocks.refetch).not.toHaveBeenCalled()
  })

  it('reports assistant export failures without throwing', async () => {
    controllerMocks.saveFile.mockRejectedValueOnce(new Error('export failed'))
    const { result } = renderHook(() => useResourceCatalogController('assistant'))

    act(() => {
      result.current.gridProps.onExport(assistantResource)
    })

    await waitFor(() => {
      expect(controllerMocks.toastError).toHaveBeenCalledWith('export failed')
    })
  })

  it('clears the active tag when the resource type changes', async () => {
    const { result, rerender } = renderHook(
      ({ resourceType }: { resourceType: ControllerResourceType }) => useResourceCatalogController(resourceType),
      { initialProps: { resourceType: 'assistant' as ControllerResourceType } }
    )

    act(() => {
      result.current.gridProps.onTagFilter('stale-tag')
    })

    await waitFor(() => {
      expect(result.current.gridProps.activeTag).toBe('stale-tag')
    })

    rerender({ resourceType: 'agent' })

    await waitFor(() => {
      expect(result.current.gridProps.activeTag).toBeNull()
    })

    rerender({ resourceType: 'assistant' })

    await waitFor(() => {
      expect(controllerMocks.resourceLibraryOptions.at(-1)).toEqual(
        expect.objectContaining({ activeTag: null, resourceType: 'assistant' })
      )
    })
  })
})
