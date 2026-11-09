import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useScopedKnowledgeToolSignals } from '../useScopedKnowledgeToolSignals'

describe('useScopedKnowledgeToolSignals', () => {
  it.each([
    [[], 1, false],
    [['kb-1'], 1, true],
    [['kb-1'], 0, false],
    [['kb-1'], undefined, true]
  ])('predicts scope %j and total %s as %s', (ids, total, expected) => {
    mockUseQuery.mockReturnValue({ data: total === undefined ? undefined : { total } } as never)
    const { result } = renderHook(() => useScopedKnowledgeToolSignals(ids))
    expect(result.current).toBe(expected)
    expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-bases', {
      query: { limit: 1 },
      enabled: ids.length > 0,
      swrOptions: { keepPreviousData: false }
    })
  })
})
