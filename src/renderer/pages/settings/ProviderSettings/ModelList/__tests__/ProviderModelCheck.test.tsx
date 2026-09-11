import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderModelCheck from '../ProviderModelCheck'

const openModelCheck = vi.fn()
const healthState = {
  models: [{ id: 'openai::gpt-4o' }],
  isModelChecking: false
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../ModelCheckDialog', () => ({ default: () => null }))
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
  })

  it('shows the checking label and disables repeat runs while a runner is active', () => {
    healthState.isModelChecking = true
    render(<ProviderModelCheck />)

    expect(screen.getByRole('button', { name: 'settings.models.check.checking' })).toBeDisabled()
  })

  it('opens model setup from the enabled check action when no models exist', () => {
    const onAddModels = vi.fn()
    healthState.models = []

    render(<ProviderModelCheck onAddModels={onAddModels} />)

    const checkButton = screen.getByRole('button', { name: 'settings.models.check.button_caption' })
    expect(checkButton).toBeEnabled()

    fireEvent.click(checkButton)
    expect(onAddModels).toHaveBeenCalledOnce()
    expect(openModelCheck).not.toHaveBeenCalled()
  })

  it('keeps the model check unavailable when no setup action is provided', () => {
    healthState.models = []

    render(<ProviderModelCheck />)

    expect(screen.getByRole('button', { name: 'settings.models.check.button_caption' })).toBeDisabled()
  })
})
