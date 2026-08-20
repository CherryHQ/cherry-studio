import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderModelCheck from '../ProviderModelCheck'

const openModelCheck = vi.fn()
const healthState = {
  models: [{ id: 'openai::gpt-4o' }],
  isModelChecking: false
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../ModelCheckDialog', () => ({ default: () => <div data-testid="model-check-dialog" /> }))
vi.mock('../modelListHealthContext', () => ({
  useModelListHealthRun: () => ({ ...healthState, openModelCheck })
}))

describe('ProviderModelCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    healthState.models = [{ id: 'openai::gpt-4o' }]
    healthState.isModelChecking = false
  })

  it('renders an accessible text entry and opens the unified dialog', () => {
    render(<ProviderModelCheck />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.check.button_caption' }))
    expect(openModelCheck).toHaveBeenCalledOnce()
    expect(screen.getByTestId('model-check-dialog')).toBeInTheDocument()
  })

  it('shows the checking label and disables repeat runs while a runner is active', () => {
    healthState.isModelChecking = true
    render(<ProviderModelCheck />)

    expect(screen.getByRole('button', { name: 'settings.models.check.checking' })).toBeDisabled()
  })
})
