import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ModelTagsWithLabel, { type ModelTagsWithLabelModel } from '../ModelTagsWithLabel'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

describe('ProviderSettings ModelTagsWithLabel', () => {
  it('renders embedding, rerank, and free tags as icons', () => {
    const { container } = render(
      <ModelTagsWithLabel
        model={
          {
            id: 'cherryin::baai/bge-m3(free)',
            providerId: 'cherryin',
            name: 'BGE M3',
            capabilities: [MODEL_CAPABILITY.EMBEDDING, MODEL_CAPABILITY.RERANK],
            endpointTypes: []
          } satisfies ModelTagsWithLabelModel
        }
        showTooltip={false}
      />
    )

    expect(screen.queryByText('models.type.embedding')).not.toBeInTheDocument()
    expect(screen.queryByText('models.type.rerank')).not.toBeInTheDocument()
    expect(screen.queryByText('models.type.free')).not.toBeInTheDocument()
    expect(container.querySelectorAll('svg')).toHaveLength(3)
  })
})
