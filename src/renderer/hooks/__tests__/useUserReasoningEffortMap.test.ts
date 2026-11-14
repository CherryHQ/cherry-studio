import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Model } from '@shared/data/types/model'

import { useUserReasoningEffortMap } from '../useUserReasoningEffortMap'

const model = {
  id: 'openai::gpt-5',
  providerId: 'openai',
  family: 'gpt-5',
  reasoning: { selectableEfforts: ['low', 'medium', 'high'] }
} as unknown as Model

describe('useUserReasoningEffortMap', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('resolves the provider scope over the global scope for the model', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.reasoning.effort_mappings', {
      global: { low: 'medium' },
      providers: { openai: { default: { low: 'high' } } }
    })

    const { result } = renderHook(() => useUserReasoningEffortMap(model))

    expect(result.current).toMatchObject({ low: 'high' })
  })

  it('returns an empty map when there is no model', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.reasoning.effort_mappings', { global: { low: 'high' } })

    const { result } = renderHook(() => useUserReasoningEffortMap(undefined))

    expect(result.current).toEqual({})
  })
})
