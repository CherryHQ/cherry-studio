import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderModelPullReconcile } from '../useProviderModelPullReconcile'

const fetchPreviewMock = vi.fn()
const resetPreviewMock = vi.fn()
const confirmApplyMock = vi.fn()
const enableProviderWhenModelsAvailableMock = vi.fn()
const updateProviderMock = vi.fn()
const useModelsMock = vi.fn()
const useProviderMock = vi.fn()

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: any[]) => useModelsMock(...args)
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@renderer/pages/settings/ProviderSettings/hooks/useProviderPullReconcile', () => ({
  useProviderPullReconcile: () => ({
    preview: null,
    isPreviewLoading: false,
    fetchPreview: fetchPreviewMock,
    reset: resetPreviewMock
  })
}))

vi.mock('@renderer/pages/settings/ProviderSettings/utils/providerEnablement', () => ({
  enableProviderWhenModelsAvailable: (...args: any[]) => enableProviderWhenModelsAvailableMock(...args)
}))

vi.mock('../usePullReconcileSubmit', () => ({
  usePullReconcileSubmit: () => ({
    confirmApply: confirmApplyMock,
    applyBusy: false
  })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('useProviderModelPullReconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enableProviderWhenModelsAvailableMock.mockResolvedValue(false)
    useModelsMock.mockReturnValue({ models: [{ id: 'cherryin::model-1' }] })
    useProviderMock.mockReturnValue({
      provider: { id: 'cherryin', isEnabled: false },
      updateProvider: updateProviderMock
    })
    window.toast = {
      success: vi.fn(),
      error: vi.fn()
    } as unknown as typeof window.toast
  })

  it('enables the provider when the pull is up to date and local models exist', async () => {
    fetchPreviewMock.mockResolvedValueOnce({ added: [], missing: [] })
    useModelsMock.mockReturnValue({ models: [{ id: 'cherryin::model-1' }, { id: 'cherryin::model-2' }] })
    const { result } = renderHook(() => useProviderModelPullReconcile('cherryin'))

    await act(async () => {
      await result.current.openPullReconcile()
    })

    expect(enableProviderWhenModelsAvailableMock).toHaveBeenCalledWith(
      { id: 'cherryin', isEnabled: false },
      updateProviderMock,
      2,
      'pull_reconcile_up_to_date'
    )
    expect(resetPreviewMock).toHaveBeenCalled()
    expect(result.current.pullReconcileDrawerOpen).toBe(false)
    expect(window.toast.success).toHaveBeenCalled()
  })

  it('passes a zero count when up to date with no local models (helper no-ops)', async () => {
    fetchPreviewMock.mockResolvedValueOnce({ added: [], missing: [] })
    useModelsMock.mockReturnValue({ models: [] })
    const { result } = renderHook(() => useProviderModelPullReconcile('cherryin'))

    await act(async () => {
      await result.current.openPullReconcile()
    })

    expect(enableProviderWhenModelsAvailableMock).toHaveBeenCalledWith(
      { id: 'cherryin', isEnabled: false },
      updateProviderMock,
      0,
      'pull_reconcile_up_to_date'
    )
  })

  it('opens the reconcile drawer without enabling during preview when there is a diff', async () => {
    fetchPreviewMock.mockResolvedValueOnce({
      added: [{ id: 'cherryin::model-1' }],
      missing: []
    })
    const { result } = renderHook(() => useProviderModelPullReconcile('cherryin'))

    await act(async () => {
      await result.current.openPullReconcile()
    })

    expect(enableProviderWhenModelsAvailableMock).not.toHaveBeenCalled()
    expect(resetPreviewMock).not.toHaveBeenCalled()
    expect(result.current.pullReconcileDrawerOpen).toBe(true)
  })
})
