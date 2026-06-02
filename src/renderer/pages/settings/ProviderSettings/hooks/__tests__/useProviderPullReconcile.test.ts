import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderPullReconcile } from '../useProviderPullReconcile'

const { buildPreviewMock, useProviderMock, useProviderApiKeysMock } = vi.hoisted(() => ({
  buildPreviewMock: vi.fn(),
  useProviderMock: vi.fn(),
  useProviderApiKeysMock: vi.fn()
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...a: any[]) => useProviderMock(...a),
  useProviderApiKeys: (...a: any[]) => useProviderApiKeysMock(...a)
}))

vi.mock('../../ModelList/buildModelListSyncPreview', () => ({
  buildModelListSyncPreview: (...a: any[]) => buildPreviewMock(...a)
}))

vi.mock('../../ModelList/modelSync', () => ({
  ModelSyncError: class ModelSyncError extends Error {
    code: string
    constructor(code: string) {
      super(code)
      this.code = code
    }
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (k: string) => k })
}))

const keys = (...values: string[]) => ({
  data: { keys: values.map((key) => ({ key, isEnabled: true })) }
})

const deferred = <T>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('useProviderPullReconcile — C3 single-flight by api-key signature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({ provider: { id: 'openai' } })
    window.toast = { success: vi.fn(), error: vi.fn() } as any
  })

  it('dedupes concurrent calls for the same key onto one upstream fetch', async () => {
    useProviderApiKeysMock.mockReturnValue(keys('sk-1'))
    const d = deferred<any>()
    buildPreviewMock.mockReturnValue(d.promise)

    const { result } = renderHook(() => useProviderPullReconcile('openai'))

    let p1: Promise<any>
    let p2: Promise<any>
    act(() => {
      p1 = result.current.fetchPreview()
      p2 = result.current.fetchPreview()
    })

    expect(buildPreviewMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      d.resolve({ added: [], missing: [] })
      await Promise.all([p1, p2])
    })
  })

  it('does not return the stale promise when the key changes mid-flight; latest key wins', async () => {
    useProviderApiKeysMock.mockReturnValue(keys('sk-1'))
    const d1 = deferred<any>()
    const d2 = deferred<any>()
    buildPreviewMock.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise)

    const { result, rerender } = renderHook(() => useProviderPullReconcile('openai'))

    let p1: Promise<any>
    act(() => {
      p1 = result.current.fetchPreview()
    })

    // User replaces the key before the first request returns.
    useProviderApiKeysMock.mockReturnValue(keys('sk-2'))
    rerender()

    let p2: Promise<any>
    act(() => {
      p2 = result.current.fetchPreview()
    })

    // K2 must trigger its own fetch — not be deduped onto K1's promise.
    expect(buildPreviewMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      // Stale K1 resolves last; its result must NOT overwrite K2's preview.
      d2.resolve({ added: [{ id: 'k2' }], missing: [] })
      d1.resolve({ added: [{ id: 'k1' }], missing: [] })
      await Promise.all([p1, p2])
    })

    expect(result.current.preview).toEqual({ added: [{ id: 'k2' }], missing: [] })
  })
})
