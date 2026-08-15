import type * as CherryStudioUi from '@cherrystudio/ui'
import type { Model } from '@shared/data/types/model'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
const aliasModel: Model = {
  id: 'openai::target',
  providerId: 'openai',
  name: 'Friendly Alias',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}
const startSingleModelCheck = vi.fn()
const startHealthCheck = vi.fn()
const health = {
  modelCheckOpen: true,
  models: [imageModel, chatModel],
  apiKeyEntries: [{ id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true }],
  canSelectApiKey: true,
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
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('../modelListHealthContext', () => ({ useModelListHealthRun: () => health }))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('ModelCheckDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    health.models = [imageModel, chatModel]
    health.apiKeyEntries = [{ id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true }]
    health.canSelectApiKey = true
    health.requiresApiKey = true
    health.isSingleModelChecking = false
    health.isModelChecking = false
    health.singleModelResult = null
    startSingleModelCheck.mockResolvedValue('failed')
    startHealthCheck.mockResolvedValue(true)
  })

  it('prevents a paid request when a required API key is unavailable', () => {
    health.apiKeyEntries = []

    render(<ModelCheckDialog />)

    expect(screen.getByText('settings.models.check.no_api_keys')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.models.check.start' })).toBeDisabled()
  })

  it('opens in single-model mode with unsupported models excluded from the default selection', async () => {
    const user = userEvent.setup()
    render(<ModelCheckDialog />)

    expect(screen.getByRole('radiogroup', { name: 'settings.models.check.title' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'settings.models.check.single_model' })).toBeChecked()
    expect(screen.getByText('settings.models.check.disclaimer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^settings\.models\.check\.model Chat$/ })).toHaveTextContent('Chat')

    await user.click(screen.getByRole('button', { name: 'settings.models.check.start' }))
    await waitFor(() =>
      expect(startSingleModelCheck).toHaveBeenCalledWith({
        model: chatModel,
        keySelection: { mode: 'all' }
      })
    )
    expect(screen.queryByLabelText('settings.models.check.timeout')).not.toBeInTheDocument()
  })

  it('uses the stronger cost warning only for all-model checks', async () => {
    const user = userEvent.setup()
    render(<ModelCheckDialog />)

    expect(screen.getByText('settings.models.check.disclaimer')).toBeInTheDocument()
    expect(screen.queryByText('settings.models.check.all_models_disclaimer')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'settings.models.check.all_models' }))

    expect(screen.getByText('settings.models.check.all_models_disclaimer')).toBeInTheDocument()
    expect(screen.queryByText('settings.models.check.disclaimer')).not.toBeInTheDocument()
  })

  it('separates the single-model key scope from concrete key choices', async () => {
    const user = userEvent.setup()
    health.apiKeyEntries = [
      { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
      { id: 'key-2', key: 'sk-secondary', label: 'Secondary', isEnabled: true }
    ]

    render(<ModelCheckDialog />)

    expect(screen.getByRole('radio', { name: 'settings.models.check.all' })).toBeChecked()
    expect(screen.queryByRole('option', { name: 'settings.models.check.all_enabled_keys' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'settings.models.check.single' }))
    await user.click(
      screen.getByRole('button', { name: /^settings\.models\.check\.select_api_key Primary · sk\*{4}ry$/ })
    )
    await user.click(screen.getByRole('option', { name: /Secondary/ }))
    await user.click(screen.getByRole('button', { name: 'settings.models.check.start' }))

    await waitFor(() =>
      expect(startSingleModelCheck).toHaveBeenCalledWith({
        model: chatModel,
        keySelection: { mode: 'single', keyId: 'key-2' }
      })
    )
  })

  it('switches to the all-model form with concurrency and a clamped timeout', async () => {
    const user = userEvent.setup()
    render(<ModelCheckDialog />)
    await user.click(screen.getByRole('radio', { name: 'settings.models.check.all_models' }))

    expect(screen.getByRole('switch')).toBeChecked()
    const timeout = screen.getByLabelText('settings.models.check.timeout')
    await user.clear(timeout)
    await user.type(timeout, '2')
    await user.click(screen.getByRole('button', { name: 'settings.models.check.start' }))

    await waitFor(() =>
      expect(startHealthCheck).toHaveBeenCalledWith({
        keySelection: { mode: 'all' },
        isConcurrent: true,
        timeout: 5000
      })
    )
  })

  it('uses a localized search field when selecting from more than five API keys', async () => {
    const user = userEvent.setup()
    health.apiKeyEntries = Array.from({ length: 6 }, (_, index) => ({
      id: `key-${index + 1}`,
      key: `sk-${index + 1}`,
      label: index === 4 ? 'Visible Secondary' : `Key ${index + 1}`,
      isEnabled: true
    }))

    render(<ModelCheckDialog />)

    await user.click(screen.getByRole('radio', { name: 'settings.models.check.single' }))
    await user.click(screen.getByRole('button', { name: /settings.models.check.select_api_key/ }))

    const search = screen.getByPlaceholderText('common.search')
    await user.type(search, 'Visible Secondary')

    expect(screen.getByRole('option', { name: /Visible Secondary/ })).toBeInTheDocument()
  })

  it('filters models by their visible label', async () => {
    const user = userEvent.setup()
    health.models = [chatModel, aliasModel]

    render(<ModelCheckDialog />)

    await user.click(screen.getByRole('button', { name: /settings.models.check.model/ }))
    await user.type(screen.getByPlaceholderText('common.search'), 'Friendly Alias')

    expect(screen.getByRole('option', { name: /Friendly Alias/ })).toBeInTheDocument()
  })

  it('shows selectable keys only for credential policies that permit them', () => {
    health.requiresApiKey = false
    const { unmount } = render(<ModelCheckDialog />)

    expect(screen.getByRole('radiogroup', { name: 'settings.models.check.key_scope' })).toBeInTheDocument()

    unmount()
    health.canSelectApiKey = false
    render(<ModelCheckDialog />)

    expect(screen.queryByRole('radiogroup', { name: 'settings.models.check.key_scope' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.models.check.start' })).toBeEnabled()
  })

  it('freezes selection controls while a single-model run is starting', async () => {
    const user = userEvent.setup()
    let finishStart!: (outcome: 'failed') => void
    health.apiKeyEntries = [
      { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
      { id: 'key-2', key: 'sk-secondary', label: 'Secondary', isEnabled: true }
    ]
    startSingleModelCheck.mockImplementationOnce(() => new Promise<'failed'>((resolve) => (finishStart = resolve)))

    render(<ModelCheckDialog />)
    await user.click(screen.getByRole('radio', { name: 'settings.models.check.single' }))
    await user.click(screen.getByRole('button', { name: 'settings.models.check.start' }))

    expect(screen.getByRole('radio', { name: 'settings.models.check.single_model' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'settings.models.check.all_models' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /settings.models.check.model/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'settings.models.check.single' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'settings.models.check.all' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /settings.models.check.select_api_key/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeEnabled()

    await user.click(screen.getByRole('radio', { name: 'settings.models.check.all_models' }))
    finishStart('failed')

    await waitFor(() => expect(screen.getByRole('button', { name: 'settings.models.check.start' })).toBeEnabled())
    expect(screen.getByRole('radio', { name: 'settings.models.check.single_model' })).toBeChecked()
    expect(startSingleModelCheck).toHaveBeenCalledWith({
      model: chatModel,
      keySelection: { mode: 'single', keyId: 'key-1' }
    })
  })

  it('keeps the dialog chrome fixed around a bounded scrolling body', () => {
    render(<ModelCheckDialog />)

    // These classes are the bounded-dialog layout contract that prevents the footer from scrolling away.
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('flex', 'max-h-[calc(100vh-2rem)]', 'flex-col', 'overflow-hidden')
    expect(dialog.querySelector('[data-slot="dialog-header"]')).toHaveClass('shrink-0')
    expect(dialog.querySelector('[data-slot="dialog-footer"]')).toHaveClass('shrink-0')
    expect(dialog.querySelector('.min-h-0.flex-1.overflow-y-auto')).toHaveClass('space-y-4', 'pr-1')
  })

  it('disables a single-model run with an unsupported-only placeholder', async () => {
    const user = userEvent.setup()
    health.models = [imageModel]

    render(<ModelCheckDialog />)

    const modelCombobox = screen.getByRole('button', { name: /settings.models.check.model/ })
    expect(modelCombobox).toBeDisabled()
    expect(modelCombobox).toHaveTextContent('settings.provider.no_models_for_check')
    expect(screen.getByRole('button', { name: 'settings.models.check.start' })).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: 'settings.models.check.all_models' }))
    expect(screen.getByRole('button', { name: 'settings.models.check.start' })).toBeEnabled()
  })

  it('allows an all-model run when every model will be skipped', async () => {
    const user = userEvent.setup()
    health.models = [imageModel]

    render(<ModelCheckDialog />)

    await user.click(screen.getByRole('radio', { name: 'settings.models.check.all_models' }))
    const startButton = screen.getByRole('button', { name: 'settings.models.check.start' })
    expect(startButton).toBeEnabled()

    await user.click(startButton)
    await waitFor(() =>
      expect(startHealthCheck).toHaveBeenCalledWith({
        keySelection: { mode: 'all' },
        isConcurrent: true,
        timeout: 15000
      })
    )
  })
})
