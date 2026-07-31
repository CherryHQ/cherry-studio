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
    onChange
  }: {
    value: string | null
    placeholder: string
    onChange: (modelId: string | null) => void
  }) => (
    <div>
      <span>{value ?? placeholder}</span>
      <button type="button" onClick={() => onChange('local-embedding::qwen3-embedding-0.6b')}>
        local-model-option
      </button>
    </div>
  )
}))

describe('EmbeddingSection', () => {
  it('keeps the local model entry inside the selector for empty and configured values', () => {
    const { rerender } = render(<EmbeddingSection embeddingModelId={null} onEmbeddingModelChange={vi.fn()} />)
    const localOption = screen.getByText('local-model-option')
    const modelSelect = screen.getByText('knowledge.not_set')

    expect(localOption).toBeInTheDocument()
    expect(modelSelect).toBeInTheDocument()

    rerender(<EmbeddingSection embeddingModelId="openai::text-embedding-3-small" onEmbeddingModelChange={vi.fn()} />)
    expect(screen.getByText('local-model-option')).toBeInTheDocument()
  })

  it('reports local model selection through the single change callback', () => {
    const onEmbeddingModelChange = vi.fn()
    render(<EmbeddingSection embeddingModelId={null} onEmbeddingModelChange={onEmbeddingModelChange} />)

    fireEvent.click(screen.getByText('local-model-option'))

    expect(onEmbeddingModelChange).toHaveBeenCalledWith('local-embedding::qwen3-embedding-0.6b')
  })
})
