import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../types'

const mocks = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  classifyErrorByAI: vi.fn()
}))

vi.mock('@data/CacheService', () => ({
  cacheService: {
    deleteCasual: vi.fn((key: string) => mocks.cache.delete(key)),
    getCasual: vi.fn((key: string) => mocks.cache.get(key)),
    setCasual: vi.fn((key: string, value: unknown) => {
      mocks.cache.set(key, value)
      return true
    })
  }
}))

vi.mock('@renderer/services/ErrorDiagnosisService', () => ({
  classifyErrorByAI: mocks.classifyErrorByAI
}))

vi.mock('@renderer/components/ErrorDetailModal', () => ({
  showErrorDetailPopup: vi.fn()
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn()
}))

const { cacheService } = await import('@data/CacheService')
const { useMessageErrorActions } = await import('../useMessageErrorActions')

describe('useMessageErrorActions', () => {
  beforeEach(() => {
    mocks.cache.clear()
    vi.clearAllMocks()
  })

  it('evicts failed AI diagnosis promises so transient failures can retry', async () => {
    const error = { message: 'provider unavailable', name: 'ProviderError', stack: '' }
    const message = {
      id: 'message-1',
      role: 'assistant',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'error'
    } satisfies MessageListItem
    mocks.classifyErrorByAI.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('retry succeeded')

    const { result } = renderHook(() => useMessageErrorActions())

    await expect(
      result.current.diagnoseMessageError?.({ message, partId: 'part-1', error, language: 'en-US' })
    ).rejects.toThrow('network')

    expect(cacheService.deleteCasual).toHaveBeenCalledWith('error.classify.provider unavailable:en-US')
    await expect(
      result.current.diagnoseMessageError?.({ message, partId: 'part-1', error, language: 'en-US' })
    ).resolves.toBe('retry succeeded')
    expect(mocks.classifyErrorByAI).toHaveBeenCalledTimes(2)
  })
})
