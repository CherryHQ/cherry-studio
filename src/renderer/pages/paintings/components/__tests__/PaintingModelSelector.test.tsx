import type { Model } from '@shared/data/types/model'
import { MODALITY, MODEL_CAPABILITY } from '@shared/data/types/model'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'

const selectorHarness = vi.hoisted(() => ({
  models: [] as Model[]
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: (props: { filter?: (model: Model) => boolean; trigger: ReactNode }) => (
    <div>
      {props.trigger}
      <div data-testid="selector-options">
        {selectorHarness.models
          .filter((model) => props.filter?.(model) ?? true)
          .map((model) => (
            <div key={`${model.providerId}:${model.apiModelId ?? model.id}`}>{model.name}</div>
          ))}
      </div>
    </div>
  ),
  getProviderDisplayName: (provider: { name: string }) => provider.name
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: selectorHarness.models })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [{ id: 'openai', name: 'OpenAI' }] })
}))

vi.mock('@cherrystudio/ui/icons', () => ({
  resolveIcon: () => undefined
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const { default: PaintingModelSelector } = await import('../PaintingModelSelector')

function model(overrides: Partial<Model>): Model {
  return {
    id: overrides.apiModelId ?? 'model',
    providerId: 'openai',
    apiModelId: overrides.apiModelId,
    name: overrides.name ?? overrides.apiModelId ?? 'model',
    capabilities: [],
    isHidden: false,
    isEnabled: true,
    ...overrides
  } as Model
}

function painting(overrides: Partial<PaintingData> = {}): PaintingData {
  return {
    id: 'p1',
    providerId: 'openai',
    model: 'gpt-5-image',
    mode: 'generate',
    prompt: '',
    files: [],
    ...overrides
  } as PaintingData
}

describe('PaintingModelSelector', () => {
  beforeEach(() => {
    selectorHarness.models = []
  })

  it('filters text-output image-generation models out of the painting selector', () => {
    selectorHarness.models = [
      model({
        apiModelId: 'gpt-5',
        name: 'GPT-5',
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
        outputModalities: [MODALITY.TEXT]
      }),
      model({
        apiModelId: 'gpt-5-image',
        name: 'GPT-5 Image',
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
        outputModalities: [MODALITY.TEXT, MODALITY.IMAGE]
      })
    ]

    render(<PaintingModelSelector hideTitle painting={painting()} onSelect={vi.fn()} />)

    const options = within(screen.getByTestId('selector-options'))
    expect(options.queryByText('GPT-5')).not.toBeInTheDocument()
    expect(options.getByText('GPT-5 Image')).toBeInTheDocument()
  })
})
