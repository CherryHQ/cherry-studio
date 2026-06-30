import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import EmbeddingSection from '../EmbeddingSection'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../panelPrimitives', () => ({
  RagFieldLabel: ({ label }: { label: string }) => <span>{label}</span>
}))

vi.mock('../../../components/KnowledgeModelSelect', () => ({
  isEmbeddingModel: () => true,
  KnowledgeModelSelect: ({ value, placeholder }: { value: string | null; placeholder: string }) => (
    <span>{value ?? placeholder}</span>
  )
}))

vi.mock('../LocalEmbeddingDownloadButton', () => ({
  default: ({ onSelected }: { onSelected: (id: string) => void }) => (
    <button type="button" onClick={() => onSelected('local-embedding::qwen3-embedding-0.6b')}>
      local-download
    </button>
  )
}))

describe('EmbeddingSection', () => {
  it('shows the local download entry only when no embedding model is set', () => {
    const { rerender } = render(<EmbeddingSection embeddingModelId={null} onEmbeddingModelChange={vi.fn()} />)
    expect(screen.getByText('local-download')).toBeInTheDocument()

    rerender(<EmbeddingSection embeddingModelId="openai::text-embedding-3-small" onEmbeddingModelChange={vi.fn()} />)
    expect(screen.queryByText('local-download')).not.toBeInTheDocument()
  })

  it('selects the downloaded local model in the parent form', () => {
    const onEmbeddingModelChange = vi.fn()
    render(<EmbeddingSection embeddingModelId={null} onEmbeddingModelChange={onEmbeddingModelChange} />)

    fireEvent.click(screen.getByText('local-download'))

    expect(onEmbeddingModelChange).toHaveBeenCalledWith('local-embedding::qwen3-embedding-0.6b')
  })
})
