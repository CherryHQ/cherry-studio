import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import RadeonCloudModelCards from '../RadeonCloudModelCards'

const TOKEN_FACTORY_URL = 'https://developer.amd.com.cn/radeon/tokenfactory'
const MODEL_NAMES = [
  'Qwen3.6-35B-A3B',
  'DeepSeek-V4-Flash',
  'DeepSeek-V4-Pro',
  'GLM 5.1',
  'GLM 5.2',
  'OpenAI gpt-oss-120b',
  'Kimi K2.6'
]

function expectCherrySource(link: HTMLElement) {
  const href = link.getAttribute('href')

  expect(href).not.toBeNull()

  const url = new URL(href!)
  expect(`${url.origin}${url.pathname}`).toBe(TOKEN_FACTORY_URL)
  expect(Object.fromEntries(url.searchParams)).toEqual({ source: 'cherry-studio' })
}

describe('RadeonCloudModelCards', () => {
  it('links only the AMD GPU Cloud title and renders models as non-interactive rows', () => {
    render(<RadeonCloudModelCards />)

    expect(screen.getByTestId('radeon-cloud-model-cards')).toBeInTheDocument()
    expect(screen.getByText('Official Model APIs')).toBeInTheDocument()
    expectCherrySource(screen.getByRole('link', { name: 'AMD GPU Cloud' }))
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getAllByTestId('radeon-cloud-model-row')).toHaveLength(7)
    expect(screen.getAllByTestId('radeon-cloud-model-icon')).toHaveLength(7)
    expect(screen.getAllByTestId('radeon-cloud-model-details')).toHaveLength(7)
    expect(screen.getAllByText(/AMD Radeon Cloud/)).toHaveLength(7)
    expect(screen.queryByText(/AMD MI Cloud/)).not.toBeInTheDocument()
    expect(screen.queryByText(/ · Radeon Cloud · /)).not.toBeInTheDocument()
    expect(screen.queryByText(/Fireworks/)).not.toBeInTheDocument()

    for (const modelName of MODEL_NAMES) {
      const modelNameElement = screen.getByText(modelName)
      const modelDetails = modelNameElement.closest('[data-testid="radeon-cloud-model-details"]')

      expect(modelDetails).toHaveClass('truncate')
      expect(modelDetails).toHaveTextContent(`${modelName} ·`)
      expect(screen.queryByRole('link', { name: modelName })).not.toBeInTheDocument()
    }
  })
})
