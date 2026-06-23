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

  it('renders the vision tag for an i2v video-gen model (IMAGE input modality, no IMAGE_RECOGNITION capability)', () => {
    const { container } = render(
      <ModelTagsWithLabel
        model={
          {
            id: 'gemini::veo-3-1-generate-preview',
            providerId: 'gemini',
            name: 'Veo 3.1',
            capabilities: [MODEL_CAPABILITY.VIDEO_GENERATION],
            inputModalities: ['text', 'image'],
            endpointTypes: []
          } satisfies ModelTagsWithLabelModel
        }
        showTooltip={false}
      />
    )

    expect(container.querySelectorAll('svg')).toHaveLength(1)
  })

  it('does not render the vision tag for a text-to-video model (no image input)', () => {
    const { container } = render(
      <ModelTagsWithLabel
        model={
          {
            id: 'gemini::veo-2-0-generate-001',
            providerId: 'gemini',
            name: 'Veo 2',
            capabilities: [MODEL_CAPABILITY.VIDEO_GENERATION],
            inputModalities: ['text'],
            endpointTypes: []
          } satisfies ModelTagsWithLabelModel
        }
        showTooltip={false}
      />
    )

    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })
})
