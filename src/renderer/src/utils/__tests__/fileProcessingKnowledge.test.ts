import { describe, expect, it } from 'vitest'

import {
  getKnowledgePreprocessProviders,
  isSelectableKnowledgePreprocessProvider,
  refreshKnowledgePreprocessProvider
} from '../fileProcessingKnowledge'

describe('fileProcessingKnowledge', () => {
  it('maps document file processor settings to legacy preprocess providers', () => {
    const providers = getKnowledgePreprocessProviders({
      mistral: {
        apiKeys: [' key-1 ', 'key-2'],
        capabilities: {
          document_to_markdown: {
            apiHost: 'https://mistral.example.com',
            modelId: 'mistral-custom'
          }
        },
        options: {
          timeout: 30
        }
      }
    })

    expect(providers).toContainEqual({
      id: 'mistral',
      name: 'Mistral',
      apiKey: 'key-1',
      apiHost: 'https://mistral.example.com',
      model: 'mistral-custom',
      options: {
        timeout: 30
      }
    })
    expect(providers.map((provider) => provider.id)).toEqual(['mistral', 'mineru', 'doc2x', 'open-mineru', 'paddleocr'])
  })

  it('uses translated provider names when a translator is supplied', () => {
    const providers = getKnowledgePreprocessProviders({}, (key) => `translated:${key}`)

    expect(providers.find((provider) => provider.id === 'open-mineru')?.name).toBe(
      'translated:settings.tool.file_processing.processors.open_mineru.name'
    )
  })

  it('keeps legacy visibility rules for processors that can run without a cloud API key', () => {
    const providers = getKnowledgePreprocessProviders({})
    const selectableProviderIds = providers
      .filter(isSelectableKnowledgePreprocessProvider)
      .map((provider) => provider.id)

    expect(selectableProviderIds).toEqual(['mineru', 'open-mineru', 'paddleocr'])
  })

  it('refreshes a selected knowledge preprocess provider from current file processing overrides', () => {
    const refreshed = refreshKnowledgePreprocessProvider(
      {
        type: 'preprocess',
        provider: {
          id: 'doc2x',
          name: 'Doc2x',
          apiKey: 'old-key',
          apiHost: 'https://old.example.com'
        }
      },
      {
        doc2x: {
          apiKeys: ['new-key'],
          capabilities: {
            document_to_markdown: {
              apiHost: 'https://doc2x.example.com'
            }
          }
        }
      }
    )

    expect(refreshed).toEqual({
      type: 'preprocess',
      provider: {
        id: 'doc2x',
        name: 'Doc2x',
        apiKey: 'new-key',
        apiHost: 'https://doc2x.example.com',
        model: 'v3-2026',
        options: undefined
      }
    })
  })
})
