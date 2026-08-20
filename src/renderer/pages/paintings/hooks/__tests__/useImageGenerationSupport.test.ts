import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { useImageGenerationSupport } from '../useImageGenerationSupport'

it('revalidates mounted image-generation metadata after a registry snapshot update', () => {
  const refetch = vi.fn().mockResolvedValue(undefined)
  mockUseQuery.mockReturnValue({
    data: { modes: {} },
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch,
    mutate: vi.fn()
  })
  renderHook(() => useImageGenerationSupport('openai', 'gpt-image-1'))

  MockUseDataApiUtils.emitDataChange([{ endpoint: '/providers/:providerId/models/:modelId*/image-generation-support' }])

  expect(refetch).toHaveBeenCalledOnce()
})
