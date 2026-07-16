import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import RadeonCloudModelCards from '../RadeonCloudModelCards'

const MODELS_URL = 'https://developer.amd.com.cn/radeon/modelapis'
const MODEL_NAMES = ['Qwen3.6-35B-A3B', 'DeepSeek-V4-Flash', 'MiniMax M3', 'Kimi 2.6']

describe('RadeonCloudModelCards', () => {
  it('renders four model cards that open the AMD GPU Cloud model page', () => {
    render(<RadeonCloudModelCards />)

    expect(screen.getByTestId('radeon-cloud-model-cards')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(4)

    for (const modelName of MODEL_NAMES) {
      expect(screen.getByRole('link', { name: modelName })).toHaveAttribute('href', MODELS_URL)
      expect(screen.getByRole('link', { name: modelName })).toHaveAttribute('target', '_blank')
      expect(screen.getByRole('link', { name: modelName })).toHaveAttribute('rel', 'noreferrer')
    }
  })
})
