import { KnowledgeBase, Model, PreprocessProvider } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GeneralSettingsPanel from '../components/KnowledgeSettings/GeneralSettingsPanel'

// Mock dependencies
const mocks = vi.hoisted(() => ({
  t: vi.fn((key: string) => key),
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      models: [
        {
          id: 'text-embedding-3-small',
          provider: 'openai',
          name: 'text-embedding-3-small',
          group: 'embedding'
        }
      ]
    }
  ],
  handlers: {
    handleEmbeddingModelChange: vi.fn(),
    handleDimensionChange: vi.fn(),
    handleRerankModelChange: vi.fn(),
    handleDocPreprocessChange: vi.fn()
  }
}))

// Mock InfoTooltip component
vi.mock('@renderer/components/InfoTooltip', () => ({
  default: ({ title, placement }: { title: string; placement: string }) => (
    <span data-testid="info-tooltip" title={title} data-placement={placement}>
      ℹ️
    </span>
  )
}))

// Mock ModelSelector component
vi.mock('@renderer/components/ModelSelector', () => ({
  default: ({ value, onChange, placeholder, allowClear, providers, predicate }: any) => {
    // Determine if this is for embedding or rerank models based on predicate
    const isEmbedding = predicate?.toString().includes('embedding')
    const isRerank = predicate?.toString().includes('rerank')

    // Use providers parameter to avoid lint error
    const hasProviders = providers && providers.length > 0

    return (
      <select
        data-testid="model-selector"
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value)}
        data-placeholder={placeholder}
        data-allow-clear={allowClear}
        data-model-type={isEmbedding ? 'embedding' : isRerank ? 'rerank' : 'unknown'}
        data-has-providers={hasProviders}>
        <option value="">Select model</option>
        {isEmbedding && (
          <>
            <option value="openai/text-embedding-3-small">text-embedding-3-small</option>
            <option value="openai/text-embedding-ada-002">text-embedding-ada-002</option>
          </>
        )}
        {isRerank && (
          <>
            <option value="openai/rerank-model">rerank-model</option>
            <option value="cohere/rerank-english-v2.0">rerank-english-v2.0</option>
          </>
        )}
      </select>
    )
  }
}))

// Mock InputEmbeddingDimension component
vi.mock('@renderer/components/InputEmbeddingDimension', () => ({
  default: ({ value, onChange, model, disabled }: any) => (
    <input
      data-testid="embedding-dimension-input"
      type="number"
      value={value || ''}
      onChange={(e) => onChange?.(Number(e.target.value))}
      disabled={disabled}
      data-model={model?.id}
    />
  )
}))

// Mock useProviders hook
vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: mocks.providers })
}))

// Mock ModelService
vi.mock('@renderer/services/ModelService', () => ({
  getModelUniqId: (model: Model | undefined) => (model ? `${model.provider}/${model.id}` : undefined)
}))

// Mock model predicates
vi.mock('@renderer/config/models', () => ({
  isEmbeddingModel: (model: Model) => model.group === 'embedding',
  isRerankModel: (model: Model) => model.group === 'rerank'
}))

// Mock constant
vi.mock('@renderer/config/constant', () => ({
  DEFAULT_KNOWLEDGE_DOCUMENT_COUNT: 6
}))

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t })
}))

// Mock antd components
vi.mock('antd', () => ({
  Input: ({ value, onChange, placeholder }: any) => (
    <input data-testid="name-input" value={value} onChange={onChange} placeholder={placeholder} />
  ),
  Select: ({ value, onChange, placeholder, options, allowClear, children }: any) => (
    <select
      data-testid="preprocess-select"
      value={value || ''}
      onChange={(e) => onChange?.(e.target.value)}
      data-placeholder={placeholder}
      data-allow-clear={allowClear}>
      <option value="">Select option</option>
      {options?.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
      {children}
    </select>
  ),
  Segmented: ({ value, onChange, options, style }: any) => (
    <div data-testid="retriever-segmented" style={style}>
      {options?.map((option: any) => (
        <button
          key={option.value}
          type="button"
          data-testid={`segmented-option-${option.value}`}
          onClick={() => onChange?.(option.value)}
          data-active={value === option.value}
          style={{
            backgroundColor: value === option.value ? '#1677ff' : '#fff',
            color: value === option.value ? '#fff' : '#000'
          }}>
          {option.label}
        </button>
      ))}
    </div>
  ),
  Slider: ({ value, onChange, min, max, step, marks, style }: any) => {
    // Determine test ID based on slider characteristics
    const isWeightSlider = min === 0 && max === 1 && step === 0.1
    const testId = isWeightSlider ? 'weight-slider' : 'document-count-slider'

    return (
      <input
        data-testid={testId}
        type="range"
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        style={style}
        data-marks={JSON.stringify(marks)}
      />
    )
  }
}))

/**
 * 创建测试用的 KnowledgeBase 对象
 * @param overrides - 可选的属性覆盖
 * @returns 完整的 KnowledgeBase 对象
 */
function createKnowledgeBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  const defaultModel: Model = {
    id: 'text-embedding-3-small',
    provider: 'openai',
    name: 'text-embedding-3-small',
    group: 'embedding'
  }

  return {
    id: 'test-base-id',
    name: 'Test Knowledge Base',
    model: defaultModel,
    retriever: {
      mode: 'hybrid'
    },
    items: [],
    created_at: Date.now(),
    updated_at: Date.now(),
    version: 1,
    framework: 'langchain',
    ...overrides
  }
}

/**
 * 创建测试用的 PreprocessProvider 对象
 * @param overrides - 可选的属性覆盖
 * @returns 完整的 PreprocessProvider 对象
 */
function createPreprocessProvider(overrides: Partial<PreprocessProvider> = {}): PreprocessProvider {
  return {
    id: 'doc2x',
    name: 'Doc2X',
    apiKey: 'test-api-key',
    ...overrides
  }
}

describe('GeneralSettingsPanel', () => {
  const mockBase = createKnowledgeBase()
  const mockSetNewBase = vi.fn()
  const mockSelectedDocPreprocessProvider = createPreprocessProvider()
  const mockDocPreprocessSelectOptions = [
    { value: 'doc2x', label: 'Doc2X' },
    { value: 'mistral', label: 'Mistral' }
  ]

  // 提取公共渲染函数
  const renderComponent = (props: Partial<any> = {}) => {
    return render(
      <GeneralSettingsPanel
        newBase={mockBase}
        setNewBase={mockSetNewBase}
        selectedDocPreprocessProvider={mockSelectedDocPreprocessProvider}
        docPreprocessSelectOptions={mockDocPreprocessSelectOptions}
        handlers={mocks.handlers}
        {...props}
      />
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('basic rendering', () => {
    it('should match snapshot', () => {
      const { container } = renderComponent()
      expect(container.firstChild).toMatchSnapshot()
    })

    it('should render without selectedDocPreprocessProvider', () => {
      renderComponent({ selectedDocPreprocessProvider: undefined })
      expect(screen.getByTestId('preprocess-select')).toHaveValue('')
    })

    it('should render with empty docPreprocessSelectOptions', () => {
      renderComponent({ docPreprocessSelectOptions: [] })
      const preprocessSelect = screen.getByTestId('preprocess-select')
      expect(preprocessSelect.children).toHaveLength(1)
    })
  })

  describe('functionality', () => {
    const user = userEvent.setup()

    it('should handle name input change', async () => {
      renderComponent()

      const nameInput = screen.getByTestId('name-input')
      await user.type(nameInput, 'New Knowledge Base Name')

      expect(mockSetNewBase).toHaveBeenCalledWith(expect.any(Function))
    })

    it('should handle preprocess provider change', async () => {
      renderComponent()

      const preprocessSelect = screen.getByTestId('preprocess-select')
      await user.selectOptions(preprocessSelect, 'mistral')

      expect(mocks.handlers.handleDocPreprocessChange).toHaveBeenCalledWith('mistral')
    })

    it('should handle model selection changes', async () => {
      renderComponent()

      const modelSelectors = screen.getAllByTestId('model-selector')

      // Test embedding model change
      const embeddingModelSelector = modelSelectors[0]
      await user.selectOptions(embeddingModelSelector, 'openai/text-embedding-ada-002')
      expect(mocks.handlers.handleEmbeddingModelChange).toHaveBeenCalledWith('openai/text-embedding-ada-002')

      // Test rerank model change
      const rerankModelSelector = modelSelectors[1]
      await user.selectOptions(rerankModelSelector, 'openai/rerank-model')
      expect(mocks.handlers.handleRerankModelChange).toHaveBeenCalledWith('openai/rerank-model')
    })

    it('should handle dimension change', async () => {
      renderComponent()

      const dimensionInput = screen.getByTestId('embedding-dimension-input')
      fireEvent.change(dimensionInput, { target: { value: '1536' } })

      expect(mocks.handlers.handleDimensionChange).toHaveBeenCalledWith(1536)
    })

    it('should handle document count change', async () => {
      renderComponent()

      const documentCountSlider = screen.getByTestId('document-count-slider')
      fireEvent.change(documentCountSlider, { target: { value: '10' } })

      expect(mockSetNewBase).toHaveBeenCalledWith(expect.any(Function))
    })

    it('should handle hybrid weight change', async () => {
      renderComponent()

      const weightSlider = screen.getByTestId('weight-slider')
      fireEvent.change(weightSlider, { target: { value: '0.7' } })

      expect(mockSetNewBase).toHaveBeenCalledWith({
        ...mockBase,
        retriever: {
          ...mockBase.retriever,
          mode: 'hybrid',
          weight: 0.7
        }
      })
    })

    it('should handle retriever selection change', async () => {
      renderComponent()

      // Test clicking on hybrid retriever option
      const hybridOption = screen.getByTestId('segmented-option-hybrid')
      await user.click(hybridOption)

      expect(mockSetNewBase).toHaveBeenCalledWith({
        ...mockBase,
        retriever: { mode: 'hybrid' }
      })
    })

    it('should not render retriever segmented when framework is embedjs', () => {
      const baseWithEmbedjs = createKnowledgeBase({ framework: 'embedjs' })
      renderComponent({ newBase: baseWithEmbedjs })

      expect(screen.queryByTestId('retriever-segmented')).not.toBeInTheDocument()
    })

    it('should disable dimension input when no model is selected', () => {
      const baseWithoutModel = createKnowledgeBase({ model: undefined as any })
      renderComponent({ newBase: baseWithoutModel })

      const dimensionInput = screen.getByTestId('embedding-dimension-input')
      expect(dimensionInput).toBeDisabled()
    })
  })
})
