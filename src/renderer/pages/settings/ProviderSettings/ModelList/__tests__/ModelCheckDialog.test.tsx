import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { HealthStatus, type ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type { Model } from '@shared/data/types/model'

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
const { showErrorDetailPopup } = vi.hoisted(() => ({ showErrorDetailPopup: vi.fn() }))
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
  singleModelResult: null as ModelWithStatus | null,
  savingKeyId: null,
  closeModelCheck: vi.fn(),
  resetSingleModelResult: vi.fn(),
  startSingleModelCheck,
  startHealthCheck,
  toggleApiKey: vi.fn()
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('@renderer/components/ErrorDetailModal', () => ({ showErrorDetailPopup }))
vi.mock('../modelListHealthContext', () => ({ useModelListHealthRun: () => health }))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('ModelCheckDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    health.modelCheckOpen = true
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

    expect(screen.getByText('settings.provider.api_key.label')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.models.check.start' })).toBeDisabled()
  })

  it('opens with the main connection-check content and checks one concrete key', async () => {
    const user = userEvent.setup()
    render(<ModelCheckDialog />)

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'message.api.check.model.title' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /button\.select_model.*Chat$/ })).toHaveTextContent('Chat')
    expect(screen.getByRole('button', { name: 'settings.models.check.model_button_caption' })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'settings.models.check.model_scope' })).not.toBeInTheDocument()
    expect(screen.queryByText('settings.models.check.disclaimer')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.models.check.all_models_disclaimer')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.models.check.start' }))

    await waitFor(() =>
      expect(startSingleModelCheck).toHaveBeenCalledWith({
        model: chatModel,
        keySelection: { mode: 'single', keyId: 'key-1' }
      })
    )
    expect(screen.queryByLabelText('settings.models.check.timeout')).not.toBeInTheDocument()
  })

  it('replaces the same dialog with the current all-model form and arguments', async () => {
    const user = userEvent.setup()
    render(<ModelCheckDialog />)

    await user.click(screen.getByRole('button', { name: 'settings.models.check.model_button_caption' }))

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'settings.models.check.title' })).toBeInTheDocument()
    expect(screen.getByText('settings.models.check.all_models_disclaimer')).toBeInTheDocument()
    expect(screen.queryByText('settings.models.check.disclaimer')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.models.check.model_button_caption' })).not.toBeInTheDocument()
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

  it('selects one enabled key for a single-model check', async () => {
    const user = userEvent.setup()
    health.apiKeyEntries = [
      { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
      { id: 'key-2', key: 'sk-alternative', label: 'Secondary', isEnabled: true }
    ]

    render(<ModelCheckDialog />)

    await user.click(screen.getByRole('button', { name: /^settings\.models\.check\.select_api_key sk\*{4}mary$/ }))
    await user.click(screen.getByRole('option', { name: /^sk\*{4}tive$/ }))
    await user.click(screen.getByRole('button', { name: 'settings.models.check.start' }))

    await waitFor(() =>
      expect(startSingleModelCheck).toHaveBeenCalledWith({
        model: chatModel,
        keySelection: { mode: 'single', keyId: 'key-2' }
      })
    )
  })

  it('derives the all-model key selection without discarding the stored choice', async () => {
    const user = userEvent.setup()
    health.apiKeyEntries = [
      { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
      { id: 'key-2', key: 'sk-alternative', label: 'Secondary', isEnabled: true }
    ]
    const { rerender } = render(<ModelCheckDialog />)
    await user.click(screen.getByRole('button', { name: 'settings.models.check.model_button_caption' }))

    await user.click(screen.getByRole('radio', { name: 'settings.models.check.single' }))
    await user.click(screen.getByRole('button', { name: /^settings\.models\.check\.select_api_key sk\*{4}mary$/ }))
    await user.click(screen.getByRole('option', { name: /^sk\*{4}tive$/ }))

    health.apiKeyEntries = health.apiKeyEntries.map((entry) =>
      entry.id === 'key-2' ? { ...entry, isEnabled: false } : entry
    )
    rerender(<ModelCheckDialog />)

    expect(screen.getByRole('radio', { name: 'settings.models.check.all' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'settings.models.check.start' }))
    await waitFor(() =>
      expect(startHealthCheck).toHaveBeenLastCalledWith({
        keySelection: { mode: 'all' },
        isConcurrent: true,
        timeout: 15000
      })
    )

    health.apiKeyEntries = health.apiKeyEntries.map((entry) =>
      entry.id === 'key-2' ? { ...entry, isEnabled: true } : entry
    )
    rerender(<ModelCheckDialog />)

    expect(screen.getByRole('radio', { name: 'settings.models.check.single' })).toBeChecked()
    expect(
      screen.getByRole('button', { name: /^settings\.models\.check\.select_api_key sk\*{4}tive$/ })
    ).toBeInTheDocument()
  })

  it('shows single-model key controls only when the credential policy permits selection', () => {
    health.requiresApiKey = false
    health.apiKeyEntries = [
      { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
      { id: 'key-2', key: 'sk-secondary', label: 'Secondary', isEnabled: true }
    ]
    const { unmount } = render(<ModelCheckDialog />)

    expect(screen.getByRole('button', { name: /settings.models.check.select_api_key/ })).toBeInTheDocument()

    unmount()
    health.canSelectApiKey = false
    render(<ModelCheckDialog />)

    expect(screen.queryByText('settings.models.check.select_api_key')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.models.check.start' })).toBeEnabled()
  })

  it('freezes single-model controls while a run is starting', async () => {
    const user = userEvent.setup()
    let finishStart!: (outcome: 'failed') => void
    health.apiKeyEntries = [
      { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
      { id: 'key-2', key: 'sk-secondary', label: 'Secondary', isEnabled: true }
    ]
    startSingleModelCheck.mockImplementationOnce(() => new Promise<'failed'>((resolve) => (finishStart = resolve)))

    render(<ModelCheckDialog />)
    await user.click(screen.getByRole('button', { name: 'settings.models.check.start' }))

    expect(screen.getByRole('button', { name: /button.select_model/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /settings.models.check.select_api_key/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'settings.models.check.model_button_caption' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'settings.models.check.model_button_caption' }))
    expect(screen.queryByText('settings.models.check.all_models_disclaimer')).not.toBeInTheDocument()
    finishStart('failed')

    await waitFor(() => expect(screen.getByRole('button', { name: 'settings.models.check.start' })).toBeEnabled())
    expect(screen.getByRole('heading', { name: 'message.api.check.model.title' })).toBeInTheDocument()
    expect(startSingleModelCheck).toHaveBeenCalledWith({
      model: chatModel,
      keySelection: { mode: 'single', keyId: 'key-1' }
    })
  })

  it('shows the main error card for the selected key failure', async () => {
    const user = userEvent.setup()
    const error = { name: 'Error', message: 'Invalid API key', stack: null }
    const entry = health.apiKeyEntries[0]
    health.singleModelResult = {
      kind: 'failed',
      model: chatModel,
      status: HealthStatus.FAILED,
      keyResults: [
        {
          kind: 'failed',
          status: HealthStatus.FAILED,
          checking: false,
          credential: { kind: 'api-key', entry },
          error
        }
      ],
      checking: false,
      error
    }

    render(<ModelCheckDialog />)

    expect(screen.getByText('Invalid API key')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /message.api.connection.failed/ }))

    expect(showErrorDetailPopup).toHaveBeenCalledWith({ error })
  })

  it('disables a single-model run with an unsupported-only placeholder', async () => {
    const user = userEvent.setup()
    health.models = [imageModel]

    render(<ModelCheckDialog />)

    const modelCombobox = screen.getByRole('button', { name: /button.select_model/ })
    expect(modelCombobox).toBeDisabled()
    expect(modelCombobox).toHaveTextContent('settings.provider.no_models_for_check')
    expect(screen.getByRole('button', { name: 'settings.models.check.start' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'settings.models.check.model_button_caption' }))
    expect(screen.getByRole('button', { name: 'settings.models.check.start' })).toBeEnabled()
  })

  it('allows an all-model run when every model will be skipped', async () => {
    const user = userEvent.setup()
    health.models = [imageModel]

    render(<ModelCheckDialog />)
    await user.click(screen.getByRole('button', { name: 'settings.models.check.model_button_caption' }))
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
