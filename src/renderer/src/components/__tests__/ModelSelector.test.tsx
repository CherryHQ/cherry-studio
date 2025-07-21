import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

import ModelSelector, { modelSelectFilter } from '../ModelSelector'

describe('ModelSelector', () => {
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
    },
    {
      id: 'empty-provider',
      name: 'EmptyProvider',
      type: 'openai',
      apiKey: '123',
      apiHost: 'https://api.cohere.com',
      models: []
    }
  ]

  describe('grouped mode (grouped=true)', () => {
    it('should render grouped options and apply predicate', () => {
      render(
        <ModelSelector
          providers={mockProviders}
          predicate={(model) => model.group === 'embedding'}
          open // Keep dropdown open for testing
        />
      )

      // Check for group labels
      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('Cohere')).toBeInTheDocument()
      expect(screen.queryByText('EmptyProvider')).not.toBeInTheDocument()

      // Check for correct models
      const ada = screen.getByText('text-embedding-ada-002')
      const cohere = screen.getByText('embed-english-v3.0')
      expect(ada).toBeInTheDocument()
      expect(cohere).toBeInTheDocument()
      // Check suffix is present by default
      expect(ada.textContent).toContain(' | OpenAI')
      expect(cohere.textContent).toContain(' | Cohere')

      // Check that filtered models are not present
      expect(screen.queryByText('GPT-4.1')).not.toBeInTheDocument()
      expect(screen.queryByText('rerank-english-v2.0')).not.toBeInTheDocument()
    })

    it('should hide suffix when showSuffix is false', () => {
      render(
        <ModelSelector
          providers={mockProviders}
          predicate={(model) => model.group === 'embedding'}
          showSuffix={false}
          open
        />
      )

      const ada = screen.getByText('text-embedding-ada-002')
      expect(ada.textContent).toBe('text-embedding-ada-002')
      expect(ada.textContent).not.toContain(' | OpenAI')
    })

    it('should hide avatar when showAvatar is false', () => {
      render(<ModelSelector providers={mockProviders} showAvatar={false} open />)
      expect(screen.queryByTestId('model-avatar')).not.toBeInTheDocument()
    })

    it('should show avatar when showAvatar is true', () => {
      render(<ModelSelector providers={mockProviders} showAvatar={true} open />)
      // 4 models in total from mockProviders
      expect(screen.getAllByTestId('model-avatar')).toHaveLength(4)
    })
  })

  describe('flat mode (grouped=false)', () => {
    it('should render flat options and apply predicate', () => {
      render(
        <ModelSelector
          providers={mockProviders}
          predicate={(model) => model.group === 'embedding'}
          grouped={false}
          open
        />
      )

      // In flat mode, there are no group labels in the dropdown structure
      expect(document.querySelector('.ant-select-item-option-group')).toBeNull()

      // Check for correct models
      const ada = screen.getByText('text-embedding-ada-002')
      const cohere = screen.getByText('embed-english-v3.0')
      expect(ada).toBeInTheDocument()
      expect(cohere).toBeInTheDocument()
      // Check suffix is present by default
      expect(ada.textContent).toContain(' | OpenAI')
      expect(cohere.textContent).toContain(' | Cohere')

      // Check that filtered models are not present
      expect(screen.queryByText('GPT-4.1')).not.toBeInTheDocument()
      expect(screen.queryByText('rerank-english-v2.0')).not.toBeInTheDocument()
    })

    it('should hide suffix when showSuffix is false', () => {
      render(<ModelSelector providers={mockProviders} grouped={false} showSuffix={false} open />)

      const gpt4 = screen.getByText('GPT-4.1')
      expect(gpt4.textContent).toBe('GPT-4.1')
      expect(gpt4.textContent).not.toContain(' | OpenAI')
    })
  })

  describe('edge cases', () => {
    it('should handle empty providers array', () => {
      render(<ModelSelector providers={[]} open />)
      expect(document.querySelector('.ant-select-item-option')).toBeNull()
    })

    it('should handle undefined providers', () => {
      render(<ModelSelector providers={undefined} open />)
      expect(document.querySelector('.ant-select-item-option')).toBeNull()
    })
  })

  describe('modelSelectFilter function', () => {
    it('should filter by provider name in title', () => {
      const mockOption = {
        title: 'GPT-4.1 | OpenAI',
        value: 'openai-gpt-4.1'
      }
      expect(modelSelectFilter('openai', mockOption)).toBe(true)
    })

    it('should filter by model name in title', () => {
      const mockOption = {
        title: 'embed-english-v3.0 | Cohere',
        value: 'cohere-embed-english-v3.0'
      }
      expect(modelSelectFilter('english', mockOption)).toBe(true)
    })

    it('should filter by value if title is not present', () => {
      const mockOption = {
        value: 'openai-gpt-4.1'
      }
      expect(modelSelectFilter('gpt', mockOption)).toBe(true)
    })

    it('should return false for no match', () => {
      const mockOption = {
        title: 'GPT-4.1 | OpenAI',
        value: 'openai-gpt-4.1'
      }
      expect(modelSelectFilter('nonexistent', mockOption)).toBe(false)
    })
  })

  describe('integration', () => {
    it('should filter options correctly when user types in search input', async () => {
      const user = userEvent.setup()
      render(<ModelSelector providers={mockProviders} open />)

      // Find the search input field, which is a combobox
      const searchInput = screen.getByRole('combobox')
      await user.type(searchInput, 'embed')

      // After filtering, only embedding models should be visible
      expect(screen.getByText('text-embedding-ada-002')).toBeInTheDocument()
      expect(screen.getByText('embed-english-v3.0')).toBeInTheDocument()

      // Other models should not be visible
      expect(screen.queryByText('GPT-4.1')).not.toBeInTheDocument()
      expect(screen.queryByText('rerank-english-v2.0')).not.toBeInTheDocument()

      // The group titles for visible items should still be there
      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('Cohere')).toBeInTheDocument()
    })
  })
})
