import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, values: { reason?: string; model?: string }) => `${values.reason}|${values.model}`
  })
}))

import ModelFallbackBlock from '../ModelFallbackBlock'

describe('ModelFallbackBlock', () => {
  it('names the fallback model without its provider prefix', () => {
    render(<ModelFallbackBlock data={{ from: 'anthropic::claude-opus-5', to: 'openai::gpt-5', reason: 'http 429' }} />)

    expect(screen.getByText('http 429|gpt-5')).toBeInTheDocument()
  })

  // A modelId may itself contain the separator (`UniqueModelId` splits on the FIRST one), so
  // taking the last segment truncated every composite id to its tail.
  it('keeps a composite modelId whole', () => {
    render(
      <ModelFallbackBlock
        data={{ from: 'provider-a::model-a', to: 'openrouter::anthropic/claude-3::beta', reason: 'http 500' }}
      />
    )

    expect(screen.getByText('http 500|anthropic/claude-3::beta')).toBeInTheDocument()
  })

  it('renders an id with no provider prefix instead of throwing', () => {
    render(<ModelFallbackBlock data={{ from: 'model-a', to: 'bare-model', reason: 'http 429' }} />)

    expect(screen.getByText('http 429|bare-model')).toBeInTheDocument()
  })
})
