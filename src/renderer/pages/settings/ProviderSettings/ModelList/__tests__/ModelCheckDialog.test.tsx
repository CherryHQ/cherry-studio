import type { Model } from '@shared/data/types/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelCheckDialog from '../ModelCheckDialog'

const chatModel: Model = {
  id: 'openai::chat',
  providerId: 'openai',
  name: 'Chat',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}
const imageModel: Model = {
  id: 'openai::image',
  providerId: 'openai',
  name: 'Image',
  capabilities: ['image-generation'],
  supportsStreaming: false,
  isEnabled: true,
  isHidden: false
}
const startSingleModelCheck = vi.fn()
const startHealthCheck = vi.fn()
const health = {
  modelCheckOpen: true,
  models: [imageModel, chatModel],
  apiKeyEntries: [{ id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true }],
  requiresApiKey: true,
  isSingleModelChecking: false,
  isModelChecking: false,
  singleModelResult: null,
  savingKeyId: null,
  closeModelCheck: vi.fn(),
  resetSingleModelResult: vi.fn(),
  startSingleModelCheck,
  startHealthCheck,
  toggleApiKey: vi.fn()
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../modelListHealthContext', () => ({ useModelListHealthRun: () => health }))

describe('ModelCheckDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    health.models = [imageModel, chatModel]
    health.apiKeyEntries = [{ id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true }]
    health.singleModelResult = null
    startSingleModelCheck.mockResolvedValue('failed')
    startHealthCheck.mockResolvedValue(true)
  })

  it('does not render a stale result when the provider has no models', () => {
    health.models = []

    render(<ModelCheckDialog />)

    expect(screen.getByRole('button', { name: 'settings.models.check.start' })).toBeDisabled()
  })

  it('prevents a paid request when a required API key is unavailable', () => {
    health.apiKeyEntries = []

    render(<ModelCheckDialog />)

    expect(screen.getByText('settings.models.check.no_api_keys')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.models.check.start' })).toBeDisabled()
  })

  it('opens in single-model mode with unsupported models excluded from the default selection', async () => {
    render(<ModelCheckDialog />)

    expect(screen.getAllByTestId('segmented-control')[0]).toHaveAttribute('data-value', 'single')
    expect(screen.getByText('settings.models.check.disclaimer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.check.start' }))
    await waitFor(() =>
      expect(startSingleModelCheck).toHaveBeenCalledWith({
        model: chatModel,
        keySelection: { mode: 'all' }
      })
    )
    expect(screen.queryByLabelText('settings.models.check.timeout')).not.toBeInTheDocument()
  })

  it('separates the single-model key scope from concrete key choices', async () => {
    const user = userEvent.setup()
    health.apiKeyEntries = [
      { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
      { id: 'key-2', key: 'sk-secondary', label: 'Secondary', isEnabled: true }
    ]

    render(<ModelCheckDialog />)

    expect(screen.getAllByTestId('segmented-control')[1]).toHaveAttribute('data-value', 'all')
    expect(screen.queryByRole('option', { name: 'settings.models.check.all_enabled_keys' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.models.check.single' }))
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'key-2')
    await user.click(screen.getByRole('button', { name: 'settings.models.check.start' }))

    await waitFor(() =>
      expect(startSingleModelCheck).toHaveBeenCalledWith({
        model: chatModel,
        keySelection: { mode: 'single', keyId: 'key-2' }
      })
    )
  })

  it('switches to the all-model form with counts, concurrency, and a clamped timeout', async () => {
    render(<ModelCheckDialog />)
    fireEvent.click(screen.getByRole('button', { name: 'settings.models.check.all_models' }))

    expect(screen.getByText('settings.models.check.model_count')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeChecked()
    const timeout = screen.getByLabelText('settings.models.check.timeout')
    fireEvent.change(timeout, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.models.check.start' }))

    await waitFor(() =>
      expect(startHealthCheck).toHaveBeenCalledWith({
        keySelection: { mode: 'all' },
        isConcurrent: true,
        timeout: 5000
      })
    )
  })

  it('uses the same separate key-scope controls for all-model checks', async () => {
    const user = userEvent.setup()
    health.apiKeyEntries = [
      { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
      { id: 'key-2', key: 'sk-secondary', label: 'Secondary', isEnabled: true }
    ]

    render(<ModelCheckDialog />)
    await user.click(screen.getByRole('button', { name: 'settings.models.check.all_models' }))

    expect(screen.getAllByTestId('segmented-control')[1]).toHaveAttribute('data-value', 'all')
    expect(screen.queryByRole('option', { name: 'settings.models.check.all_enabled_keys' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.models.check.single' }))
    await user.selectOptions(screen.getByRole('combobox'), 'key-2')
    await user.click(screen.getByRole('button', { name: 'settings.models.check.start' }))

    await waitFor(() =>
      expect(startHealthCheck).toHaveBeenCalledWith({
        keySelection: { mode: 'single', keyId: 'key-2' },
        isConcurrent: true,
        timeout: 15000
      })
    )
  })
})
