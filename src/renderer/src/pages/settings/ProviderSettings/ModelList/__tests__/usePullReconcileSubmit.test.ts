import type { CreateModelsDto } from '@shared/data/api/schemas/models'
import { MODELS_BATCH_MAX_ITEMS } from '@shared/data/api/schemas/models'
import type { Model } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePullReconcileSubmit } from '../usePullReconcileSubmit'

const createModelsMock = vi.fn<(...args: [CreateModelsDto]) => Promise<Model[]>>()
const deleteModelMock = vi.fn()
const refetchModelsMock = vi.fn()

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: () => ({ refetch: refetchModelsMock }),
  useModelMutations: () => ({
    createModels: createModelsMock,
    deleteModel: deleteModelMock,
    isCreating: false,
    isDeleting: false
  })
}))

vi.mock('../modelSync', () => ({
  toCreateModelDto: (providerId: string, model: Model) => ({
    providerId,
    modelId: model.apiModelId ?? model.id.split('::').at(-1) ?? model.id,
    name: model.name,
    group: model.group
  })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key)
  })
}))

describe('usePullReconcileSubmit', () => {
  beforeEach(() => {
    createModelsMock.mockReset()
    deleteModelMock.mockReset()
    refetchModelsMock.mockReset()
    createModelsMock.mockImplementation(async (items) => items as unknown as Model[])
    deleteModelMock.mockResolvedValue(undefined)
    refetchModelsMock.mockResolvedValue(undefined)
    window.toast = {
      success: vi.fn(),
      error: vi.fn()
    } as unknown as typeof window.toast
  })

  it('chunks model creation to respect the DataApi batch limit', async () => {
    const onApplyCommitted = vi.fn()
    const { result } = renderHook(() => usePullReconcileSubmit({ providerId: 'cherryin', onApplyCommitted }))
    const toAdd = Array.from(
      { length: MODELS_BATCH_MAX_ITEMS + 45 },
      (_, index): Model =>
        ({
          id: `cherryin::model-${index}`,
          providerId: 'cherryin',
          apiModelId: `model-${index}`,
          name: `Model ${index}`,
          isEnabled: true,
          isHidden: false
        }) as Model
    )

    await act(async () => {
      await result.current.confirmApply({
        toAdd,
        toRemove: []
      })
    })

    expect(createModelsMock).toHaveBeenCalledTimes(2)
    expect(createModelsMock.mock.calls[0][0]).toHaveLength(MODELS_BATCH_MAX_ITEMS)
    expect(createModelsMock.mock.calls[1][0]).toHaveLength(45)
    expect(onApplyCommitted).toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
