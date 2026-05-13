import type { Model } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePullReconcileSubmit } from '../usePullReconcileSubmit'

const { reconcileTriggerMock } = vi.hoisted(() => ({
  reconcileTriggerMock: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: () => ({
    trigger: reconcileTriggerMock,
    isLoading: false
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
    reconcileTriggerMock.mockReset()
    reconcileTriggerMock.mockResolvedValue([])
    window.toast = {
      success: vi.fn(),
      error: vi.fn()
    } as unknown as typeof window.toast
  })

  it('applies pull reconcile through a single reconcile call with the full diff', async () => {
    const onApplyCommitted = vi.fn()
    const { result } = renderHook(() => usePullReconcileSubmit({ providerId: 'cherryin', onApplyCommitted }))
    const toAdd = Array.from(
      { length: 3 },
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

    expect(reconcileTriggerMock).toHaveBeenCalledTimes(1)
    expect(reconcileTriggerMock).toHaveBeenCalledWith({
      params: { providerId: 'cherryin' },
      body: {
        toAdd: [
          { providerId: 'cherryin', modelId: 'model-0', name: 'Model 0', group: undefined },
          { providerId: 'cherryin', modelId: 'model-1', name: 'Model 1', group: undefined },
          { providerId: 'cherryin', modelId: 'model-2', name: 'Model 2', group: undefined }
        ],
        toRemove: ['cherryin::old-model']
      }
    })
    expect(onApplyCommitted).toHaveBeenCalled()
    expect(window.toast.success).toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
  })

  it('surfaces reconcile failure without committing the drawer', async () => {
    reconcileTriggerMock.mockRejectedValueOnce(new Error('reconcile failed'))
    const onApplyCommitted = vi.fn()
    const { result } = renderHook(() => usePullReconcileSubmit({ providerId: 'cherryin', onApplyCommitted }))

    await act(async () => {
      await result.current.confirmApply({
        toAdd: [],
        toRemove: ['cherryin::old-model']
      })
    })

    expect(reconcileTriggerMock).toHaveBeenCalled()
    expect(onApplyCommitted).not.toHaveBeenCalled()
    expect(window.toast.error).toHaveBeenCalledWith('settings.models.manage.sync_pull_failed')
  })
})
