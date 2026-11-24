import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { mockPreferenceService } from '@test-mocks/renderer/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceService } from '@data/PreferenceService'
import type { Model } from '@shared/data/types/model'

import { readDefaultModel, readQuickModel, readTranslateModel } from '../resolve'

const defaultModel: Model = {
  id: 'openai::gpt-4o',
  providerId: 'openai',
  name: 'GPT 4o',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}

beforeEach(() => {
  mockPreferenceService._resetMockState()
  vi.clearAllMocks()
  mockDataApiService.get.mockReset().mockResolvedValue(defaultModel)
})

describe('one-shot preferred model reads', () => {
  it.each(['gpt-4o', '::gpt-4o', 'openai::', 'openai::gpt-4o?other=1', 'openai::gpt-4o#fragment'])(
    'does not query or rewrite malformed saved IDs: %s',
    async (id) => {
      await preferenceService.set('chat.default_model_id', id)
      await preferenceService.set('feature.quick_assistant.model_id', id)
      await preferenceService.set('feature.translate.model_id', id)

      expect(await Promise.all([readDefaultModel(), readQuickModel(), readTranslateModel()])).toEqual([
        undefined,
        undefined,
        undefined
      ])
      expect(mockDataApiService.get).not.toHaveBeenCalled()
      expect(await preferenceService.get('chat.default_model_id')).toBe(id)
      expect(await preferenceService.get('feature.quick_assistant.model_id')).toBe(id)
      expect(await preferenceService.get('feature.translate.model_id')).toBe(id)
    }
  )

  it('returns the selected model and inherits unset quick and translation preferences', async () => {
    await preferenceService.set('chat.default_model_id', defaultModel.id)

    expect(await Promise.all([readDefaultModel(), readQuickModel(), readTranslateModel()])).toEqual([
      defaultModel,
      defaultModel,
      defaultModel
    ])
    expect(mockDataApiService.get.mock.calls.map(([path]) => path)).toEqual([
      '/models/openai::gpt-4o',
      '/models/openai::gpt-4o',
      '/models/openai::gpt-4o'
    ])
  })

  it('does not replace an invalid dedicated selection with the default', async () => {
    await preferenceService.set('chat.default_model_id', defaultModel.id)
    await preferenceService.set('feature.quick_assistant.model_id', 'broken-id')
    await preferenceService.set('feature.translate.model_id', 'broken-id')

    expect(await readQuickModel()).toBeUndefined()
    expect(await readTranslateModel()).toBeUndefined()
    expect(mockDataApiService.get).not.toHaveBeenCalled()
  })

  it('returns no model without a saved selection', async () => {
    expect(await readDefaultModel()).toBeUndefined()
    expect(mockDataApiService.get).not.toHaveBeenCalled()
  })

  it('returns no model for a missing record and preserves request failures', async () => {
    await preferenceService.set('chat.default_model_id', defaultModel.id)
    mockDataApiService.get.mockResolvedValueOnce(undefined)
    expect(await readDefaultModel()).toBeUndefined()

    const failure = new Error('model read failed')
    mockDataApiService.get.mockRejectedValueOnce(failure)
    await expect(readDefaultModel()).rejects.toBe(failure)
  })
})
