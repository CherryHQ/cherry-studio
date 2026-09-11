import type { ImageGenerationSupport } from '@cherrystudio/provider-registry'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import PaintingSettings from '../PaintingSettings'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

function Draft() {
  const [painting, setPainting] = useState<PaintingData>({
    id: 'draft',
    providerId: 'test',
    model: 'image',
    mode: 'generate',
    prompt: 'a fox',
    files: [],
    params: { quality: 'high', seed: 0 }
  })
  return (
    <>
      <PaintingSettings
        painting={painting}
        hasImages
        onConfigChange={(patch) => setPainting({ ...painting, ...patch })}
      />
      <output aria-label="request">{JSON.stringify({ operation: painting.mode, params: painting.params })}</output>
    </>
  )
}

function support(value: ImageGenerationSupport) {
  MockUseDataApiUtils.mockQueryData('/providers/:providerId/models/:modelId*/image-generation-support', value)
}

describe('PaintingSettings operations', () => {
  beforeEach(() => MockUseDataApiUtils.resetMocks())

  it('requires an explicit independent-operation choice and clears incompatible params', () => {
    support({
      modes: {
        generate: { supports: { quality: { type: 'enum', options: ['high'] }, seed: { type: 'text' } } },
        remix: { supports: { seed: { type: 'text' }, strength: { type: 'range', min: 0, max: 1, default: 0.5 } } }
      }
    })
    render(<Draft />)
    expect(screen.getByRole('button', { name: 'paintings.mode.generate' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'paintings.mode.remix' }))
    expect(screen.getByRole('button', { name: 'paintings.mode.remix' })).toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(screen.getByLabelText('request').textContent)).toEqual({
      operation: 'remix',
      params: { seed: 0, strength: 0.5 }
    })
  })

  it('does not present reference-image input as a separate edit operation', () => {
    support({ modes: { generate: { supports: {} }, edit: { supports: { seed: { type: 'text' } } } } })
    render(<Draft />)
    expect(screen.queryByRole('button', { name: 'paintings.mode.edit' })).not.toBeInTheDocument()
    expect(JSON.parse(screen.getByLabelText('request').textContent).operation).toBe('generate')
  })
})
