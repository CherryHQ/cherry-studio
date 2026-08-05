import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import EmbeddingSection from '../EmbeddingSection'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../panelPrimitives', () => ({
  RagFieldLabel: ({ label }: { label: string }) => <span>{label}</span>
}))

vi.mock('../../../components/KnowledgeEmbeddingModelSelect', () => ({
  KnowledgeEmbeddingModelSelect: ({
    value,
    placeholder,
    noneOptionLabel,
    onChange
  }: {
    value: string | null
    placeholder: string
    noneOptionLabel?: string
    onChange: (modelId: string | null) => void
  }) => (
    <div>
      <span>{value ?? placeholder}</span>
      <button type="button" onClick={() => onChange('local-embedding::qwen3-embedding-0.6b')}>
        local-model-option
      </button>
      {noneOptionLabel ? (
        <button type="button" onClick={() => onChange(null)}>
          {noneOptionLabel}
        </button>
      ) : null}
    </div>
  )
}))

describe('EmbeddingSection', () => {
  it('keeps the local model and disabled entries inside the selector', () => {
    const { rerender } = render(<EmbeddingSection embeddingModelId={null} onEmbeddingModelChange={vi.fn()} />)
    const localOption = screen.getByText('local-model-option')

    expect(localOption).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'knowledge.rag.rerank_disabled' })).toBeInTheDocument()
    expect(screen.queryByText('knowledge.not_set')).not.toBeInTheDocument()

    rerender(<EmbeddingSection embeddingModelId="openai::text-embedding-3-small" onEmbeddingModelChange={vi.fn()} />)
    expect(screen.getByText('local-model-option')).toBeInTheDocument()
  })

  it('reports local model selection through the single change callback', () => {
    const onEmbeddingModelChange = vi.fn()
    render(<EmbeddingSection embeddingModelId={null} onEmbeddingModelChange={onEmbeddingModelChange} />)

    fireEvent.click(screen.getByText('local-model-option'))

    expect(onEmbeddingModelChange).toHaveBeenCalledWith('local-embedding::qwen3-embedding-0.6b')
  })

  it('reports the disabled entry through the single change callback', () => {
    const onEmbeddingModelChange = vi.fn()
    render(
      <EmbeddingSection
        embeddingModelId="openai::text-embedding-3-small"
        onEmbeddingModelChange={onEmbeddingModelChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'knowledge.rag.rerank_disabled' }))

    expect(onEmbeddingModelChange).toHaveBeenCalledWith(null)
  })
})
