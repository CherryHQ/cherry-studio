import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProviderListNotReadyForReorderError, useMoveProviderToFirst } from '../useMoveProviderToFirst'

const readCacheMock = vi.fn()
const moveMock = vi.fn()

vi.mock('@data/hooks/useDataApi', () => ({
  useReadCache: () => readCacheMock
}))

vi.mock('@data/hooks/useReorder', () => ({
  useReorder: () => ({
    move: moveMock,
    applyReorderedList: vi.fn(),
    isPending: false
  })
}))

describe('useMoveProviderToFirst', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    moveMock.mockResolvedValue(undefined)
  })

  it('throws before moving when the provider list cache is not ready', async () => {
    readCacheMock.mockReturnValue(undefined)

    const { result } = renderHook(() => useMoveProviderToFirst())

    expect(() => result.current.assertCanMoveProviderToFirst()).toThrow(ProviderListNotReadyForReorderError)
    await expect(result.current.moveProviderToFirst('cherryin')).rejects.toThrow(ProviderListNotReadyForReorderError)
    expect(moveMock).not.toHaveBeenCalled()
  })

  it('moves a provider to the first position when the provider list cache is ready', async () => {
    readCacheMock.mockReturnValue([{ id: 'openai' }, { id: 'cherryin' }])

    const { result } = renderHook(() => useMoveProviderToFirst())

    expect(() => result.current.assertCanMoveProviderToFirst()).not.toThrow()
    await result.current.moveProviderToFirst('cherryin')

    expect(moveMock).toHaveBeenCalledWith('cherryin', { position: 'first' })
  })
})
