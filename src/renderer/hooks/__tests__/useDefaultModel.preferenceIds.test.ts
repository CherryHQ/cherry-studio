import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useDefaultModel } from '../useModel'

const activeQueryPaths = () =>
  new Set(mockUseQuery.mock.calls.filter(([, options]) => options?.enabled !== false).map(([path]) => path))

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
  MockUsePreferenceUtils.resetMocks()
})

afterEach(cleanup)

describe('model preference lookup boundary', () => {
  it.each(['gpt-4o', '::gpt-4o', 'openai::', 'openai::gpt-4o?other=1', 'openai::gpt-4o#fragment'])(
    'does not query malformed saved IDs or rewrite the preference: %s',
    (id) => {
      MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', id)
      MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.model_id', id)
      MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_id', id)
      MockUsePreferenceUtils.setPreferenceValue('feature.paintings.default_model_id', id)

      renderHook(() => useDefaultModel())

      expect(activeQueryPaths()).toEqual(new Set())
      expect(MockUsePreferenceUtils.getPreferenceValue('chat.default_model_id')).toBe(id)
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.quick_assistant.model_id')).toBe(id)
    }
  )

  it('inherits an unset quick/translate selection while leaving painting unselected', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'openai::gpt-4o')

    const { result } = renderHook(() => useDefaultModel())

    expect(activeQueryPaths()).toEqual(new Set(['/models/openai::gpt-4o']))
    expect(result.current.defaultModel).toBeDefined()
    expect(result.current.quickModel).toEqual(result.current.defaultModel)
    expect(result.current.translateModel).toEqual(result.current.defaultModel)
    expect(result.current.paintingModel).toBeUndefined()
  })

  it('does not replace a malformed dedicated selection with the default model', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'openai::gpt-4o')
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.model_id', 'broken-id')
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.model_id', 'anthropic::claude')

    const { result } = renderHook(() => useDefaultModel())

    expect(activeQueryPaths()).toEqual(new Set(['/models/openai::gpt-4o', '/models/anthropic::claude']))
    expect(result.current.quickModel).toBeUndefined()
    expect(result.current.translateModel).toBeDefined()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.quick_assistant.model_id')).toBe('broken-id')
  })

  it('keeps valid saved selections inactive when model reads are disabled', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'openai::gpt-4o')
    MockUsePreferenceUtils.setPreferenceValue('feature.paintings.default_model_id', 'openai::dall-e-3')

    renderHook(() => useDefaultModel({ enabled: false }))

    expect(activeQueryPaths()).toEqual(new Set())
  })
})
