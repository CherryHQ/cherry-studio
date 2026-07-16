import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import RadeonCloudModelCards from '../RadeonCloudModelCards'

const MODELS_URL = 'https://developer.amd.com.cn/radeon/modelapis'
const MODEL_NAMES = [
  'Qwen3.6-35B-A3B',
  'DeepSeek-V4-Flash',
  'DeepSeek-V4-Pro',
  'GLM 5.1',
  'GLM 5.2',
  'OpenAI gpt-oss-120b',
  'Kimi K2.6'
]

describe('RadeonCloudModelCards', () => {
  it('renders seven model cards that open the AMD GPU Cloud model page', () => {
    render(<RadeonCloudModelCards />)

    expect(screen.getByTestId('radeon-cloud-model-cards')).toBeInTheDocument()
    expect(screen.getByText('AMD GPU Cloud')).toBeInTheDocument()
    expect(screen.getByText('Official Model APIs')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AMD GPU Cloud Model APIs' })).toHaveAttribute('href', MODELS_URL)
    expect(screen.getAllByTestId('radeon-cloud-model-link')).toHaveLength(7)
    expect(screen.getAllByTestId('radeon-cloud-model-icon')).toHaveLength(7)

    for (const modelName of MODEL_NAMES) {
      expect(screen.getByRole('link', { name: modelName })).toHaveAttribute('href', MODELS_URL)
      expect(screen.getByRole('link', { name: modelName })).toHaveAttribute('target', '_blank')
      expect(screen.getByRole('link', { name: modelName })).toHaveAttribute('rel', 'noreferrer')
      expect(screen.getByRole('link', { name: modelName })).toHaveClass('h-[68px]')
    }
  })
})
