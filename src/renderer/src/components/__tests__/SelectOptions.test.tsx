import { describe, expect, it, vi } from 'vitest'

// Mock the imported modules
vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: ({ model, size }: any) => (
    <div data-testid="model-avatar" style={{ width: size, height: size }}>
      {model.name.charAt(0)}
    </div>
  )
}))

vi.mock('@renderer/services/ModelService', () => ({
  getModelUniqId: (model: any) => `${model.provider}-${model.id}`
}))

vi.mock('@renderer/utils', () => ({
  matchKeywordsInString: (input: string, target: string) => target.toLowerCase().includes(input.toLowerCase())
}))

vi.mock('@renderer/utils/naming', () => ({
  getFancyProviderName: (provider: any) => provider.name
}))

// Import after mocking
import { Provider } from '@renderer/types'

import { modelSelectFilter, modelSelectOptions } from '../SelectOptions'

describe('SelectOptions', () => {
  const mockProviders: Provider[] = [
    {
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      apiKey: '123',
      apiHost: 'https://api.openai.com',
      models: [
        { id: 'text-embedding-ada-002', name: 'text-embedding-ada-002', provider: 'openai', group: 'embedding' },
        { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', group: 'chat' }
      ]
    },
    {
      id: 'cohere',
      name: 'Cohere',
      type: 'openai',
      apiKey: '123',
      apiHost: 'https://api.cohere.com',
      models: [
        { id: 'embed-english-v3.0', name: 'embed-english-v3.0', provider: 'cohere', group: 'embedding' },
        { id: 'rerank-english-v2.0', name: 'rerank-english-v2.0', provider: 'cohere', group: 'rerank' }
      ]
    }
  ]

  describe('modelSelectOptions', () => {
    it('should generate grouped options for embedding models', () => {
      const options = modelSelectOptions(mockProviders as any, (model) => model.group === 'embedding')

      expect(options).toHaveLength(2)
      expect(options[0].label).toBe('OpenAI')
      expect(options[0].options).toHaveLength(1)
      expect(options[0].options[0].value).toBe('openai-text-embedding-ada-002')
      expect(options[0].options[0].title).toBe('text-embedding-ada-002 | OpenAI')

      expect(options[1].label).toBe('Cohere')
      expect(options[1].options).toHaveLength(1)
      expect(options[1].options[0].value).toBe('cohere-embed-english-v3.0')
      expect(options[1].options[0].title).toBe('embed-english-v3.0 | Cohere')
    })

    it('should return empty array when no models match predicate', () => {
      const options = modelSelectOptions(mockProviders as any, (model) => model.group === 'nonexistent')
      expect(options).toHaveLength(0)
    })
  })

  describe('modelSelectFilter', () => {
    const mockOptions = modelSelectOptions(mockProviders as any)

    it('should filter by provider name', () => {
      const result = modelSelectFilter('openai', mockOptions[0].options[0])
      expect(result).toBe(true)
    })

    it('should filter by partial match', () => {
      const result = modelSelectFilter('embed', mockOptions[1].options[0])
      expect(result).toBe(true)
    })

    it('should return false for no match', () => {
      const result = modelSelectFilter('nonexistent', mockOptions[0].options[0])
      expect(result).toBe(false)
    })
  })

  describe('integration', () => {
    it('should work together in a Select component scenario', () => {
      const embeddingOptions = modelSelectOptions(mockProviders as any, (model) => model.group === 'embedding')

      const searchTerm = 'english'
      const filteredOptions = embeddingOptions
        .map((group) => ({
          ...group,
          options: group.options.filter((option) => modelSelectFilter(searchTerm, option))
        }))
        .filter((group) => group.options.length > 0)

      expect(filteredOptions).toHaveLength(1)
      expect(filteredOptions[0].label).toBe('Cohere')
      expect(filteredOptions[0].options[0].title).toContain('english')
    })
  })
})
