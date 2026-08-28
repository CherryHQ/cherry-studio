import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeModelSelect } from '../KnowledgeModelSelect'

const { mockModelSelectorProps, mockModels } = vi.hoisted(() => ({
  mockModelSelectorProps: [] as Array<Record<string, any>>,
  mockModels: { value: [] as Model[] }
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: mockModels.value, isLoading: false, refetch: vi.fn() })
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: (props: Record<string, any>) => {
    mockModelSelectorProps.push(props)
    return (
      <div>
        {props.trigger}
        <button type="button" onClick={() => props.onSelect('local-embedding::qwen3-embedding-0.6b')}>
          select-local-model
        </button>
      </div>
    )
  }
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classNames: Array<string | false | null | undefined>) => classNames.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => {
    const { type = 'button', variant, ...buttonProps } = props
    void variant
    return (
      <button type={type} {...buttonProps}>
        {children}
      </button>
    )
  }
}))

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span>chevron</span>
}))

const makeModel = (id: UniqueModelId, name: string): Model =>
  ({
    id,
    providerId: id.split('::')[0],
    name,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }) as Model

describe('KnowledgeModelSelect', () => {
  beforeEach(() => {
    mockModelSelectorProps.length = 0
    mockModels.value = []
  })

  it('uses the registered model name and reports normal model selection through onChange', () => {
    mockModels.value = [makeModel('local-embedding::qwen3-embedding-0.6b', 'Qwen3 Embedding 0.6B')]
    const onChange = vi.fn()

    render(
      <KnowledgeModelSelect
        aria-label="embedding-model"
        value="local-embedding::qwen3-embedding-0.6b"
        placeholder="not-set"
        filter={() => true}
        onChange={onChange}
      />
    )

    expect(screen.getByText('Qwen3 Embedding 0.6B')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'select-local-model' }))
    expect(onChange).toHaveBeenCalledWith('local-embedding::qwen3-embedding-0.6b')
  })

  it('combines capability and non-Agent visibility rules and renders no external clear button', () => {
    const allowedModel = makeModel('openai::gpt-4o', 'GPT-4o')
    const rejectedModel = makeModel('openai::embedding', 'Embedding')
    const filter = (model: Model) => model.id === allowedModel.id

    render(
      <KnowledgeModelSelect
        aria-label="embedding-model"
        value={null}
        placeholder="not-set"
        noneOptionLabel="no-model"
        filter={filter}
        onChange={vi.fn()}
      />
    )

    const visibleFilter = mockModelSelectorProps.at(-1)?.filter
    const openai = { id: 'openai', authMethods: ['api-key'] } as Provider
    const externalCli = { id: 'claude-code', authMethods: ['external-cli'] } as Provider
    expect(visibleFilter(allowedModel, openai)).toBe(true)
    expect(visibleFilter(rejectedModel, openai)).toBe(false)
    expect(visibleFilter(allowedModel, externalCli)).toBe(false)
    expect(mockModelSelectorProps.at(-1)?.noneOptionLabel).toBe('no-model')
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'embedding-model' })).toBeInTheDocument()
  })
})
