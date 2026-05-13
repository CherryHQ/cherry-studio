import { MODELS_BATCH_MAX_ITEMS } from '@shared/data/api/schemas/models'
import type { Model } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePullReconcileSubmit } from '../usePullReconcileSubmit'

const { createModelsMock, deleteModelMock, refetchModelsMock } = vi.hoisted(() => ({
  createModelsMock: vi.fn(),
  deleteModelMock: vi.fn(),
  refetchModelsMock: vi.fn()
}))

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
    createModelsMock.mockResolvedValue([])
    deleteModelMock.mockResolvedValue(undefined)
    refetchModelsMock.mockResolvedValue(undefined)
    window.toast = {
      success: vi.fn(),
      error: vi.fn()
    } as unknown as typeof window.toast
  })

  it('applies pull reconcile through deleteModel plus chunked createModels calls', async () => {
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
        toRemove: ['cherryin::old-model']
      })
    })

    expect(deleteModelMock).toHaveBeenCalledTimes(1)
    expect(deleteModelMock).toHaveBeenCalledWith('cherryin', 'old-model')
    expect(createModelsMock).toHaveBeenCalledTimes(2)
    expect(createModelsMock.mock.calls[0][0]).toHaveLength(MODELS_BATCH_MAX_ITEMS)
    expect(createModelsMock.mock.calls[0][0][0]).toEqual(
      expect.objectContaining({ providerId: 'cherryin', modelId: 'model-0' })
    )
    expect(createModelsMock.mock.calls[1][0]).toHaveLength(45)
    expect(createModelsMock.mock.calls[1][0][44]).toEqual(
      expect.objectContaining({ providerId: 'cherryin', modelId: `model-${MODELS_BATCH_MAX_ITEMS + 44}` })
    )
    expect(onApplyCommitted).toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('surfaces mutation failures without committing the drawer', async () => {
    deleteModelMock.mockRejectedValueOnce(new Error('delete failed'))
    const onApplyCommitted = vi.fn()
    const { result } = renderHook(() => usePullReconcileSubmit({ providerId: 'cherryin', onApplyCommitted }))

    await act(async () => {
      await result.current.confirmApply({
        toAdd: [],
        toRemove: ['cherryin::old-model']
      })
    })

    expect(deleteModelMock).toHaveBeenCalledWith('cherryin', 'old-model')
    expect(createModelsMock).not.toHaveBeenCalled()
    expect(onApplyCommitted).not.toHaveBeenCalled()
    expect(window.toast.error).toHaveBeenCalledWith('settings.models.manage.sync_pull_failed')
  })

  it('logs refetch failures without turning a committed apply into an error state', async () => {
    refetchModelsMock.mockRejectedValueOnce(new Error('refetch failed'))
    const onApplyCommitted = vi.fn()
    const { result } = renderHook(() => usePullReconcileSubmit({ providerId: 'cherryin', onApplyCommitted }))

    await act(async () => {
      await result.current.confirmApply({
        toAdd: [],
        toRemove: []
      })
    })

    await Promise.resolve()

    expect(onApplyCommitted).toHaveBeenCalled()
    expect(window.toast.success).toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })
})
