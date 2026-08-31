import '@testing-library/jest-dom/vitest'

import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import type { Model } from '@shared/data/types/model'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderApiSetupDialog from '../ProviderApiSetupDialog'

const updateApiKeysMock = vi.fn()
const updateProviderMock = vi.fn()
const enableProviderMock = vi.fn()
const createModelsMock = vi.fn()
const updateModelsMock = vi.fn()
const fetchProviderCatalogModelsMock = vi.fn()
const fetchResolvedProviderModelsMock = vi.fn()
const checkApiMock = vi.fn()
const getModelHealthCheckSkipReasonMock = vi.fn()
const toastSuccessMock = vi.fn()
let localModels: Model[] = []
let storedApiKeys: Array<{ id: string; key: string; isEnabled: boolean }> = []
let storedApiKeysUnavailable = false
let storedApiKeysLoading = false
let providerMeta: { apiKeyWebsite?: string; fancyProviderName: string; isDmxapi: boolean }
let provider: {
  id: string
  name: string
  presetProviderId?: string
  isEnabled: boolean
  apiKeys: Array<{ id: string; isEnabled: boolean }>
} = {
  id: 'openai',
  name: 'OpenAI',
  presetProviderId: 'openai',
  isEnabled: false,
  apiKeys: []
}

vi.mock('@renderer/components/icons/LoadingIcon', () => ({
  default: () => <span>loading</span>
}))

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({ list, children, getItemKey }: any) => (
    <div>
      {list.slice(0, 20).map((item: any, index: number) => (
        <div key={getItemKey?.(index) ?? index}>{children(item)}</div>
      ))}
    </div>
  )
}))

vi.mock('@renderer/utils/model', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getModelLogoRef: () => undefined
}))

vi.mock('@cherrystudio/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cherrystudio/ui/icons')>()),
  resolveProviderIconRef: () => undefined,
  useIcon: () => undefined
}))

vi.mock('../../components/ModelTagsWithLabel', () => ({
  default: () => null
}))

vi.mock('../../ModelList/ModelTypeFilterTabs', () => ({
  ModelTypeFilterTabs: () => null
}))

vi.mock('../../ModelList/ProviderModelAdd', () => ({
  ProviderModelAddDialog: ({ open, onClose, onSuccess }: any) =>
    open ? (
      <div>
        <button
          type="button"
          onClick={() => {
            const model = createModel('manual')
            localModels = [model]
            onSuccess?.([model.id])
          }}>
          save-manual-model
        </button>
        <button type="button" onClick={onClose}>
          cancel-manual-model
        </button>
      </div>
    ) : null
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({
    provider,
    updateApiKeys: updateApiKeysMock,
    updateProvider: updateProviderMock,
    enableProvider: enableProviderMock
  }),
  useProviderApiKeys: () => ({
    data: storedApiKeysUnavailable ? undefined : { keys: storedApiKeys },
    isLoading: storedApiKeysLoading
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: localModels }),
  useModelMutations: () => ({ createModels: createModelsMock, updateModels: updateModelsMock })
}))

vi.mock('../../hooks/providerSetting/useProviderMeta', () => ({
  useProviderMeta: () => providerMeta
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { success: (...args: any[]) => toastSuccessMock(...args) }
}))

vi.mock('../../utils/modelSync', () => ({
  fetchProviderCatalogModels: (...args: any[]) => fetchProviderCatalogModelsMock(...args),
  fetchResolvedProviderModels: (...args: any[]) => fetchResolvedProviderModelsMock(...args),
  resolveCreateModelEndpointTypes: () => undefined,
  toCreateModelDto: (providerId: string, model: Model) => ({
    providerId,
    modelId: model.apiModelId,
    name: model.name
  })
}))

vi.mock('../../utils/healthCheck', () => ({
  checkApi: (...args: any[]) => checkApiMock(...args),
  getModelHealthCheckSkipReason: (...args: any[]) => getModelHealthCheckSkipReasonMock(...args),
  healthCheckErrorToDisplayString: (error: { message?: string } | string) =>
    typeof error === 'string' ? error : (error.message ?? '')
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; model?: string }) => {
      if (options?.count !== undefined) {
        return `${key}:${options.count}`
      }
      if (options?.model !== undefined && key === 'settings.provider.api_setup.progress.check_model_named') {
        return `${key}:${options.model}`
      }
      return key
    }
  })
}))

function createModel(id: string): Model {
  return {
    id: `openai::${id}`,
    providerId: 'openai',
    apiModelId: id,
    name: id,
    capabilities: [],
    isEnabled: true,
    isHidden: false
  } as unknown as Model
}

describe('ProviderApiSetupDialog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localModels = []
    storedApiKeys = []
    storedApiKeysUnavailable = false
    storedApiKeysLoading = false
    providerMeta = {
      apiKeyWebsite: 'https://platform.openai.com/api-keys',
      fancyProviderName: 'OpenAI',
      isDmxapi: false
    }
    provider = {
      id: 'openai',
      name: 'OpenAI',
      presetProviderId: 'openai',
      isEnabled: false,
      apiKeys: []
    }
    updateApiKeysMock.mockResolvedValue(undefined)
    updateProviderMock.mockResolvedValue(undefined)
    enableProviderMock.mockResolvedValue(undefined)
    createModelsMock.mockImplementation(async (dtos: Array<{ modelId: string; name: string }>) =>
      dtos.map((dto) => ({ ...createModel(dto.modelId), name: dto.name }))
    )
    updateModelsMock.mockResolvedValue([])
    fetchProviderCatalogModelsMock.mockResolvedValue([])
    fetchResolvedProviderModelsMock.mockResolvedValue([createModel('alpha'), createModel('beta')])
    checkApiMock.mockResolvedValue({ latency: 10 })
    getModelHealthCheckSkipReasonMock.mockReturnValue(null)
  })

  it('finishes the dialog exit animation before asking its host to unmount', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.skip' }))

    expect(onClose).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS - 1))
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTime(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('allows the model-loading dialog to close while the request is still pending', async () => {
    const onClose = vi.fn()
    fetchResolvedProviderModelsMock.mockReturnValue(new Promise(() => {}))

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={onClose} />)

    await waitFor(() => expect(fetchResolvedProviderModelsMock).toHaveBeenCalledWith('openai'))
    const cancelButton = screen.getByRole('button', { name: 'settings.provider.api_setup.skip' })
    expect(cancelButton).toBeEnabled()

    fireEvent.click(cancelButton)

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('requires a non-empty key, saves it explicitly, and leaves every model unselected', async () => {
    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={vi.fn()} />)

    const heading = screen.getByRole('heading')
    expect(heading).toHaveTextContent('OpenAI')
    expect(heading).toHaveTextContent('settings.provider.api_setup.add_key')
    const nextButton = screen.getByRole('button', { name: 'settings.provider.api_setup.next' })
    expect(nextButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), { target: { value: 'sk-valid' } })
    fireEvent.click(nextButton)

    await screen.findAllByText('alpha')
    expect(screen.getByRole('heading', { name: /settings\.provider\.api_setup\.models_title/ })).toBeInTheDocument()
    expect(updateApiKeysMock).toHaveBeenCalledWith([{ id: expect.any(String), key: 'sk-valid', isEnabled: true }])
    expect(fetchResolvedProviderModelsMock).toHaveBeenCalledWith('openai')
    expect(screen.getAllByLabelText('settings.provider.api_setup.select_model')).toHaveLength(2)
    expect(
      screen.getAllByLabelText('settings.provider.api_setup.select_model').every((item) => !item.matches(':checked'))
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'common.select_all' }))
    expect(
      screen.getAllByLabelText('settings.provider.api_setup.select_model').every((item) => item.matches(':checked'))
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.deselect_all' }))
    expect(
      screen.getAllByLabelText('settings.provider.api_setup.select_model').every((item) => !item.matches(':checked'))
    ).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'common.search' }), { target: { value: 'beta' } })
    expect(screen.getAllByLabelText('settings.provider.api_setup.select_model')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' })).toBeDisabled()
    expect(enableProviderMock).not.toHaveBeenCalled()
  })

  it('can save the key and close without loading models', async () => {
    const onClose = vi.fn()
    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), { target: { value: 'sk-valid' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.save_and_close' }))

    await waitFor(() => expect(updateApiKeysMock).toHaveBeenCalledTimes(1))
    expect(fetchResolvedProviderModelsMock).not.toHaveBeenCalled()
    expect(enableProviderMock).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('prefills saved keys when the key flow is opened for editing', async () => {
    storedApiKeys = [
      { id: 'saved-key', key: 'sk-existing', isEnabled: true },
      { id: 'disabled-key', key: 'sk-disabled', isEnabled: false }
    ]

    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={vi.fn()} />)

    const apiKeyInput = await screen.findByDisplayValue('sk-existing')
    fireEvent.change(apiKeyInput, { target: { value: 'sk-replacement' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.save_and_close' }))

    await waitFor(() =>
      expect(updateApiKeysMock).toHaveBeenCalledWith([
        { id: 'saved-key', key: 'sk-replacement', isEnabled: true },
        { id: 'disabled-key', key: 'sk-disabled', isEnabled: false }
      ])
    )
    expect(fetchResolvedProviderModelsMock).not.toHaveBeenCalled()
  })

  it('offers the provider API key website from the key step', () => {
    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={vi.fn()} />)

    const apiKeyLink = screen.getByRole('link', { name: 'settings.provider.get_api_key' })
    expect(apiKeyLink).toHaveAttribute('href', 'https://platform.openai.com/api-keys')
    expect(apiKeyLink).toHaveAttribute('target', '_blank')
  })

  it('saves comma-separated keys once, removing blanks and duplicates', async () => {
    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={vi.fn()} />)

    const apiKeyInput = screen.getByLabelText('settings.provider.api_key.label')
    fireEvent.change(apiKeyInput, { target: { value: ' sk-one，sk-two,sk-one,  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.next' }))

    await screen.findAllByText('alpha')
    expect(updateApiKeysMock).toHaveBeenCalledTimes(1)
    expect(updateApiKeysMock).toHaveBeenCalledWith([
      { id: expect.any(String), key: 'sk-one', isEnabled: true },
      { id: expect.any(String), key: 'sk-two', isEnabled: true }
    ])
  })

  it('can reveal and hide the API keys without saving them', async () => {
    const user = userEvent.setup()
    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={vi.fn()} />)

    const apiKeyInput = screen.getByLabelText('settings.provider.api_key.label')
    expect(apiKeyInput).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'settings.provider.api_key.show_key' }))
    expect(apiKeyInput).toHaveAttribute('type', 'text')
    expect(updateApiKeysMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'settings.provider.api_key.hide_key' }))
    expect(apiKeyInput).toHaveAttribute('type', 'password')
  })

  it('stays on the key step when the explicit save fails', async () => {
    updateApiKeysMock.mockRejectedValueOnce(new Error('storage unavailable'))

    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), { target: { value: 'sk-valid' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.next' }))

    await screen.findByText(/storage unavailable/)
    expect(screen.getByLabelText('settings.provider.api_key.label')).toHaveValue('sk-valid')
    expect(fetchResolvedProviderModelsMock).not.toHaveBeenCalled()
    expect(enableProviderMock).not.toHaveBeenCalled()
  })

  it('uses only the first saved key for the single verification request', async () => {
    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), {
      target: { value: 'sk-fresh, sk-backup' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.next' }))

    await screen.findAllByText('alpha')
    fireEvent.click(screen.getAllByLabelText('settings.provider.api_setup.select_model')[0])
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' }))
    fireEvent.click(await screen.findByRole('button', { name: 'settings.provider.api_setup.verify_and_enable' }))

    await waitFor(() =>
      expect(checkApiMock).toHaveBeenCalledWith('openai::alpha', { apiKey: 'sk-fresh', timeout: 15000 })
    )
    expect(checkApiMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(enableProviderMock).toHaveBeenCalledTimes(1))
  })

  it('restores selected local models, creates missing models, and enables only after the check succeeds', async () => {
    const user = userEvent.setup()
    let resolveCheck: ((value: { latency: number }) => void) | undefined
    checkApiMock.mockReturnValue(
      new Promise<{ latency: number }>((resolve) => {
        resolveCheck = resolve
      })
    )
    const restoredAlpha = createModel('alpha')
    localModels = [{ ...restoredAlpha, isEnabled: false, isHidden: true }]
    updateModelsMock.mockResolvedValueOnce([restoredAlpha])
    const canonicalBeta = { ...createModel('beta'), name: 'Canonical Beta' }
    createModelsMock.mockResolvedValueOnce([canonicalBeta])
    const onClose = vi.fn()
    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={onClose} />)

    await screen.findAllByText('alpha')
    const modelCheckboxes = screen.getAllByLabelText('settings.provider.api_setup.select_model')
    expect(modelCheckboxes[0]).toBeChecked()
    expect(modelCheckboxes[1]).not.toBeChecked()
    await user.click(modelCheckboxes[1])
    await user.click(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' }))

    const verificationHeading = await screen.findByRole('heading', {
      name: /settings\.provider\.api_setup\.verify_and_enable/
    })
    expect(verificationHeading).toBeVisible()
    expect(verificationHeading).toHaveTextContent('OpenAI')
    expect(
      screen.getByRole('listitem', {
        name: 'settings.provider.api_setup.progress.add_models common.success'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('listitem', { name: 'settings.provider.api_setup.progress.check_model_named:alpha' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(checkApiMock).not.toHaveBeenCalled()
    expect(enableProviderMock).not.toHaveBeenCalled()

    await waitFor(() =>
      expect(createModelsMock).toHaveBeenCalledWith([{ providerId: 'openai', modelId: 'beta', name: 'beta' }])
    )
    expect(updateModelsMock).toHaveBeenCalledWith([
      {
        uniqueModelId: restoredAlpha.id,
        patch: { isEnabled: true, isHidden: false }
      }
    ])
    await user.click(screen.getByRole('button', { name: 'settings.provider.api_setup.verify_and_enable' }))

    const activeCheckStep = screen.getByRole('listitem', {
      name: 'settings.provider.api_setup.progress.check_model_named:alpha common.loading'
    })
    expect(activeCheckStep).toHaveAttribute('aria-current', 'step')
    expect(within(activeCheckStep).getByRole('status')).toHaveTextContent('common.loading')
    expect(checkApiMock).toHaveBeenCalledWith('openai::alpha', { timeout: 15000 })
    expect(enableProviderMock).not.toHaveBeenCalled()
    resolveCheck?.({ latency: 12 })
    expect(
      await screen.findByRole('listitem', {
        name: 'settings.provider.api_setup.progress.check_model_named:alpha common.success'
      })
    ).toBeInTheDocument()
    expect(enableProviderMock).not.toHaveBeenCalled()
    await waitFor(() => expect(enableProviderMock).toHaveBeenCalledTimes(1))
    expect(toastSuccessMock).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    for (const stepName of [
      'settings.provider.api_setup.progress.add_models',
      'settings.provider.api_setup.progress.check_model_named:alpha',
      'settings.provider.api_setup.progress.enable_provider'
    ]) {
      expect(screen.getByRole('listitem', { name: `${stepName} common.success` })).toBeInTheDocument()
    }
    const closeButton = screen.getByRole('button', { name: 'settings.provider.api_setup.done' })
    vi.useFakeTimers()
    await act(async () => vi.advanceTimersByTime(2000))
    expect(onClose).not.toHaveBeenCalled()
    vi.useRealTimers()
    await user.click(closeButton)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 2500 })
  })

  it('reuses the same saved key entry after model loading fails', async () => {
    fetchResolvedProviderModelsMock
      .mockRejectedValueOnce(new Error('401 rejected sk-first'))
      .mockResolvedValueOnce([createModel('alpha')])

    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), { target: { value: 'sk-first' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.next' }))

    await screen.findByRole('alert')
    expect(screen.queryByText(/sk-first/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.edit_key' }))
    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), { target: { value: 'sk-second' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.next' }))

    await screen.findAllByText('alpha')
    const firstSavedEntry = updateApiKeysMock.mock.calls[0][0][0]
    expect(updateApiKeysMock).toHaveBeenCalledTimes(2)
    expect(updateApiKeysMock.mock.calls[1][0]).toEqual([{ id: firstSavedEntry.id, key: 'sk-second', isEnabled: true }])
  })

  it('waits for stored keys before loading models from an existing configuration', async () => {
    storedApiKeysLoading = true
    const { rerender } = render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    expect(fetchResolvedProviderModelsMock).not.toHaveBeenCalled()

    storedApiKeysLoading = false
    rerender(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    await waitFor(() => expect(fetchResolvedProviderModelsMock).toHaveBeenCalledWith('openai'))
  })

  it('returns to key entry when the saved keys are all disabled', async () => {
    storedApiKeys = [{ id: 'disabled-key', key: 'sk-disabled', isEnabled: false }]
    provider.apiKeys = [{ id: 'disabled-key', isEnabled: false }]

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    expect(await screen.findByLabelText('settings.provider.api_key.label')).toHaveValue('')
    expect(fetchResolvedProviderModelsMock).not.toHaveBeenCalled()
    expect(checkApiMock).not.toHaveBeenCalled()
    expect(enableProviderMock).not.toHaveBeenCalled()
  })

  it('redacts an existing stored key and lets the user edit it after model loading fails', async () => {
    const user = userEvent.setup()
    storedApiKeys = [{ id: 'saved-key', key: 'sk-existing', isEnabled: true }]
    fetchResolvedProviderModelsMock
      .mockRejectedValueOnce(new Error('401 rejected sk-existing'))
      .mockResolvedValueOnce([createModel('alpha')])

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    await screen.findByRole('alert')
    expect(screen.queryByText(/sk-existing/)).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('••••')
    expect(screen.getByRole('button', { name: 'settings.provider.api_setup.edit_key' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.back' }))
    const apiKeyInput = screen.getByLabelText('settings.provider.api_key.label')
    expect(apiKeyInput).toHaveValue('sk-existing')

    await user.clear(apiKeyInput)
    await user.type(apiKeyInput, 'sk-replacement')
    await user.click(screen.getByRole('button', { name: 'settings.provider.api_setup.next' }))

    await screen.findAllByText('alpha')
    expect(updateApiKeysMock).toHaveBeenCalledWith([{ id: 'saved-key', key: 'sk-replacement', isEnabled: true }])
  })

  it('shows a localized reason for a recognized model-loading error', async () => {
    storedApiKeys = [{ id: 'saved-key', key: 'sk-existing', isEnabled: true }]
    fetchResolvedProviderModelsMock.mockRejectedValueOnce(new Error('Invalid API key'))

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('settings.models.manage.sync_pull_failed')
    expect(alert).toHaveTextContent('error.diagnosis.auth')
    expect(alert).not.toHaveTextContent('Invalid API key')
  })

  it('keeps models from a successful source selectable when another source fails', async () => {
    storedApiKeys = [{ id: 'saved-key', key: 'sk-existing', isEnabled: true }]
    fetchProviderCatalogModelsMock.mockResolvedValue([createModel('catalog-model')])
    fetchResolvedProviderModelsMock.mockRejectedValue(new Error('upstream unavailable'))

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    await screen.findAllByText('catalog-model')
    expect(screen.getByRole('alert')).toHaveTextContent('settings.models.manage.sync_pull_failed')
    const modelCheckbox = screen.getByLabelText('settings.provider.api_setup.select_model')
    fireEvent.click(modelCheckbox)
    expect(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' })).toBeEnabled()
  })

  it('omits an unsafe raw error summary when stored keys cannot be loaded', async () => {
    storedApiKeysUnavailable = true
    fetchResolvedProviderModelsMock.mockRejectedValueOnce(new Error('401 rejected sk-sensitive'))

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('settings.models.manage.sync_pull_failed')
    expect(alert).not.toHaveTextContent('sk-sensitive')
    expect(alert).not.toHaveTextContent('401 rejected')
  })

  it('lets a preset provider add a model manually when remote model loading fails', async () => {
    fetchResolvedProviderModelsMock.mockRejectedValueOnce(new Error('models endpoint unsupported'))

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    await screen.findByRole('alert')
    expect(screen.queryByRole('textbox', { name: 'common.search' })).not.toBeInTheDocument()
    const manualAddButton = screen.getByRole('button', { name: 'settings.provider.api_setup.add_model_manually' })

    fireEvent.click(manualAddButton)
    fireEvent.click(screen.getByRole('button', { name: 'save-manual-model' }))

    await screen.findAllByText('manual')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('settings.provider.api_setup.select_model')[0]).toBeChecked()
    expect(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' })).toBeEnabled()
  })

  it('keeps the provider disabled and can return to the preserved selection after a real check fails', async () => {
    checkApiMock.mockRejectedValueOnce(new Error('insufficient balance')).mockResolvedValueOnce({ latency: 9 })

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    await screen.findAllByText('alpha')
    fireEvent.click(screen.getAllByLabelText('settings.provider.api_setup.select_model')[0])
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' }))
    fireEvent.click(await screen.findByRole('button', { name: 'settings.provider.api_setup.verify_and_enable' }))

    await screen.findByText(/error\.diagnosis\.quota/)
    expect(
      await screen.findByRole('heading', { name: /settings\.provider\.api_setup\.verify_and_enable/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('listitem', {
        name: 'settings.provider.api_setup.progress.add_models common.success'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('listitem', {
        name: 'settings.provider.api_setup.progress.check_model_named:alpha settings.models.check.failed'
      })
    ).toBeInTheDocument()
    expect(enableProviderMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.back_to_models' }))
    expect(screen.getByRole('heading', { name: /settings\.provider\.api_setup\.models_title/ })).toBeInTheDocument()
    expect(screen.getAllByLabelText('settings.provider.api_setup.select_model')[0]).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' }))
    fireEvent.click(await screen.findByRole('button', { name: 'settings.provider.api_setup.verify_and_enable' }))
    await waitFor(() => expect(checkApiMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(enableProviderMock).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByRole('listitem', {
        name: 'settings.provider.api_setup.progress.enable_provider common.success'
      })
    ).toBeInTheDocument()
  })

  it('treats a verification timeout as a failed real request and leaves the provider off', async () => {
    provider = { ...provider, isEnabled: true }
    checkApiMock.mockRejectedValueOnce(new Error('Request timed out'))

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    await screen.findAllByText('alpha')
    fireEvent.click(screen.getAllByLabelText('settings.provider.api_setup.select_model')[0])
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' }))
    fireEvent.click(await screen.findByRole('button', { name: 'settings.provider.api_setup.verify_and_enable' }))

    await screen.findByText(/error\.diagnosis\.network/)
    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: false })
    expect(enableProviderMock).not.toHaveBeenCalled()
  })

  it('retries only the model batch that did not persist', async () => {
    const models = Array.from({ length: 501 }, (_, index) => createModel(`model-${index}`))
    fetchResolvedProviderModelsMock.mockResolvedValue(models)
    createModelsMock
      .mockImplementationOnce(async (dtos: Array<{ modelId: string; name: string }>) =>
        dtos.map((dto) => ({ ...createModel(dto.modelId), name: dto.name }))
      )
      .mockRejectedValueOnce(new Error('second batch failed'))
      .mockImplementationOnce(async (dtos: Array<{ modelId: string; name: string }>) =>
        dtos.map((dto) => ({ ...createModel(dto.modelId), name: dto.name }))
      )

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    await screen.findAllByText('model-0')
    fireEvent.click(screen.getByRole('button', { name: 'common.select_all' }))
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('second batch failed')
    expect(screen.getByRole('heading', { name: /settings\.provider\.api_setup\.models_title/ })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /settings\.provider\.api_setup\.verify_and_enable/ })
    ).not.toBeInTheDocument()
    expect(createModelsMock).toHaveBeenCalledTimes(2)
    expect(createModelsMock.mock.calls[0]?.[0]).toHaveLength(500)
    expect(createModelsMock.mock.calls[1]?.[0]).toHaveLength(1)
    expect(checkApiMock).not.toHaveBeenCalled()
    expect(enableProviderMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' }))

    await waitFor(() => expect(createModelsMock).toHaveBeenCalledTimes(3))
    expect(createModelsMock.mock.calls[2]?.[0]).toEqual([
      { providerId: 'openai', modelId: 'model-500', name: 'model-500' }
    ])
    expect(
      await screen.findByRole('heading', { name: /settings\.provider\.api_setup\.verify_and_enable/ })
    ).toBeInTheDocument()
  })

  it('adds high-cost models without probing or enabling the provider', async () => {
    getModelHealthCheckSkipReasonMock.mockReturnValue({ kind: 'generation_cost', output: 'image' })

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    await screen.findAllByText('alpha')
    fireEvent.click(screen.getAllByLabelText('settings.provider.api_setup.select_model')[0])
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' }))

    expect(
      await screen.findByRole('heading', { name: /settings\.provider\.api_setup\.verify_and_enable/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('listitem', {
        name: 'settings.provider.api_setup.progress.add_models common.success'
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'settings.provider.api_setup.verify_and_enable' })
    ).not.toBeInTheDocument()
    const skippedCheckStep = screen.getByRole('listitem', {
      name: 'settings.provider.api_setup.progress.check_model settings.models.check.status_skipped'
    })
    expect(within(skippedCheckStep).getByText('settings.provider.api_setup.manual_description')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.back_to_models' }))
    expect(screen.getByRole('heading', { name: /settings\.provider\.api_setup\.models_title/ })).toBeInTheDocument()
    expect(screen.getAllByLabelText('settings.provider.api_setup.select_model')[0]).toBeChecked()
    expect(createModelsMock).toHaveBeenCalledTimes(1)
    expect(checkApiMock).not.toHaveBeenCalled()
    expect(enableProviderMock).not.toHaveBeenCalled()
  })
})
