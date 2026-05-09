import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useKnowledgeBaseForm } from '../useKnowledgeBaseForm'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] })
}))

vi.mock('@renderer/services/ModelService', () => ({
  getModelUniqId: (model: any) => model?.id || ''
}))

vi.mock('@renderer/config/embedings', () => ({
  getEmbeddingMaxContext: () => undefined
}))

describe('useKnowledgeBaseForm', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('builds knowledge preprocess providers from file processing preferences', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.file_processing.overrides', {
      mistral: {
        apiKeys: ['mistral-key']
      }
    })

    const { result } = renderHook(() => useKnowledgeBaseForm())

    expect(result.current.providerData.docPreprocessSelectOptions).toEqual([
      {
        label: 'settings.tool.file_processing.knowledge.provider',
        title: 'settings.tool.file_processing.knowledge.provider',
        options: [
          {
            value: 'mistral',
            label: 'settings.tool.file_processing.processors.mistral.name'
          },
          {
            value: 'mineru',
            label: 'settings.tool.file_processing.processors.mineru.name'
          },
          {
            value: 'open-mineru',
            label: 'settings.tool.file_processing.processors.open_mineru.name'
          },
          {
            value: 'paddleocr',
            label: 'settings.tool.file_processing.processors.paddleocr.name'
          }
        ]
      }
    ])
  })

  it('stores the selected preprocess provider from file processing preferences', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.file_processing.overrides', {
      doc2x: {
        apiKeys: ['doc2x-key']
      }
    })

    const { result } = renderHook(() => useKnowledgeBaseForm())

    act(() => {
      result.current.handlers.handleDocPreprocessChange('doc2x')
    })

    expect(result.current.newBase.preprocessProvider).toEqual({
      type: 'preprocess',
      provider: {
        id: 'doc2x',
        name: 'settings.tool.file_processing.processors.doc2x.name',
        apiKey: 'doc2x-key',
        apiHost: 'https://v2.doc2x.noedgeai.com',
        model: 'v3-2026',
        options: undefined
      }
    })
  })
})
