import '@testing-library/jest-dom/vitest'

import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import type { Model } from '@shared/data/types/model'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderApiSetupDialog from '../ProviderApiSetupDialog'

const addApiKeyMock = vi.fn()
const updateApiKeyMock = vi.fn()
const updateProviderMock = vi.fn()
const enableProviderMock = vi.fn()
const createModelsMock = vi.fn()
const updateModelsMock = vi.fn()
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

vi.mock('@cherrystudio/ui/icons', () => ({
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
      <div data-testid="manual-model-dialog">
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
    addApiKey: addApiKeyMock,
    updateApiKey: updateApiKeyMock,
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
  fetchProviderCatalogModels: () => Promise.resolve([]),
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
      if (
        options?.model !== undefined &&
        [
          'settings.provider.api_setup.progress.check_model_named',
          'settings.provider.api_setup.status.checking_model'
        ].includes(key)
      ) {
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
    addApiKeyMock.mockResolvedValue({
      ...provider,
      apiKeys: [{ id: 'saved-key', isEnabled: true }]
    })
    updateApiKeyMock.mockResolvedValue(undefined)
    updateProviderMock.mockResolvedValue(undefined)
    enableProviderMock.mockResolvedValue(undefined)
    createModelsMock.mockImplementation(async (dtos: Array<{ modelId: string; name: string }>) =>
      dtos.map((dto) => ({ ...createModel(dto.modelId), name: dto.name }))
    )
    updateModelsMock.mockResolvedValue([])
    fetchResolvedProviderModelsMock.mockResolvedValue([createModel('alpha'), createModel('beta')])
    checkApiMock.mockResolvedValue({ latency: 10 })
    getModelHealthCheckSkipReasonMock.mockReturnValue(null)
  })

  it('finishes the dialog exit animation before asking its host to unmount', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()

    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

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
    const cancelButton = screen.getByRole('button', { name: 'common.cancel' })
    expect(cancelButton).toBeEnabled()

    fireEvent.click(cancelButton)

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('requires a non-empty key, saves it explicitly, and leaves every model unselected', async () => {
    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={vi.fn()} />)

    const heading = screen.getByRole('heading')
    expect(heading).toHaveTextContent('OpenAI')
    expect(heading).toHaveTextContent('settings.provider.api_setup.add_key')
    expect(screen.queryByText('settings.provider.api_setup.key_description')).not.toBeInTheDocument()
    const saveButton = screen.getByRole('button', { name: 'settings.provider.api_setup.save_key' })
    expect(saveButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), { target: { value: 'sk-valid' } })
    fireEvent.click(saveButton)

    await screen.findAllByText('alpha')
    expect(screen.getByRole('heading', { name: /settings\.provider\.api_setup\.models_title/ })).toBeInTheDocument()
    expect(screen.queryByText('settings.provider.api_setup.models_description')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { expanded: true })).not.toBeInTheDocument()
    expect(addApiKeyMock).toHaveBeenCalledWith('sk-valid')
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

  it('offers the provider API key website from the key step', () => {
    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={vi.fn()} />)

    const apiKeyLink = screen.getByRole('link', { name: 'settings.provider.get_api_key' })
    expect(apiKeyLink).toHaveAttribute('href', 'https://platform.openai.com/api-keys')
    expect(apiKeyLink).toHaveAttribute('target', '_blank')
  })

  it('stays on the key step when the explicit save fails', async () => {
    addApiKeyMock.mockRejectedValueOnce(new Error('storage unavailable'))

    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), { target: { value: 'sk-valid' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.save_key' }))

    await screen.findByText(/storage unavailable/)
    expect(screen.getByLabelText('settings.provider.api_key.label')).toHaveValue('sk-valid')
    expect(fetchResolvedProviderModelsMock).not.toHaveBeenCalled()
    expect(enableProviderMock).not.toHaveBeenCalled()
  })

  it('uses the key saved in this flow for the single verification request', async () => {
    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), { target: { value: 'sk-fresh' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.save_key' }))

    await screen.findAllByText('alpha')
    fireEvent.click(screen.getAllByLabelText('settings.provider.api_setup.select_model')[0])
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' }))
    fireEvent.click(await screen.findByRole('button', { name: 'settings.provider.api_setup.verify_and_enable' }))

    await waitFor(() =>
      expect(checkApiMock).toHaveBeenCalledWith('openai::alpha', { apiKey: 'sk-fresh', timeout: 15000 })
    )
    expect(checkApiMock).toHaveBeenCalledTimes(1)
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

    expect(screen.getByRole('status')).toHaveTextContent('settings.provider.api_setup.status.checking_model:alpha')
    expect(
      screen.getByRole('listitem', {
        name: 'settings.provider.api_setup.progress.check_model_named:alpha common.loading'
      })
    ).toHaveAttribute('aria-current', 'step')
    expect(checkApiMock).toHaveBeenCalledWith('openai::alpha', { timeout: 15000 })
    expect(enableProviderMock).not.toHaveBeenCalled()

    resolveCheck?.({ latency: 12 })
    await waitFor(() => expect(enableProviderMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('settings.provider.api_setup.success')).toBeInTheDocument()
    expect(toastSuccessMock).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'common.close' })).not.toBeInTheDocument()
    for (const stepName of [
      'settings.provider.api_setup.progress.add_models',
      'settings.provider.api_setup.progress.check_model_named:alpha',
      'settings.provider.api_setup.progress.enable_provider'
    ]) {
      expect(screen.getByRole('listitem', { name: `${stepName} common.success` })).toBeInTheDocument()
    }
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 2500 })
  })

  it('updates the same saved key after model loading fails instead of creating a duplicate', async () => {
    fetchResolvedProviderModelsMock
      .mockRejectedValueOnce(new Error('401 rejected sk-first'))
      .mockResolvedValueOnce([createModel('alpha')])

    render(<ProviderApiSetupDialog providerId="openai" initialStep="api-key" onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), { target: { value: 'sk-first' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.save_key' }))

    await screen.findByRole('alert')
    expect(screen.queryByText(/sk-first/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.edit_key' }))
    fireEvent.change(screen.getByLabelText('settings.provider.api_key.label'), { target: { value: 'sk-second' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.save_key' }))

    await screen.findAllByText('alpha')
    expect(addApiKeyMock).toHaveBeenCalledTimes(1)
    expect(updateApiKeyMock).toHaveBeenCalledWith('saved-key', { key: 'sk-second', isEnabled: true })
  })

  it('waits for stored keys before loading models from an existing configuration', async () => {
    storedApiKeysLoading = true
    const { rerender } = render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    expect(fetchResolvedProviderModelsMock).not.toHaveBeenCalled()

    storedApiKeysLoading = false
    rerender(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    await waitFor(() => expect(fetchResolvedProviderModelsMock).toHaveBeenCalledWith('openai'))
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

    await user.click(screen.getByRole('button', { name: 'settings.provider.api_setup.edit_key' }))
    const apiKeyInput = screen.getByLabelText('settings.provider.api_key.label')
    expect(apiKeyInput).toHaveValue('sk-existing')

    await user.clear(apiKeyInput)
    await user.type(apiKeyInput, 'sk-replacement')
    await user.click(screen.getByRole('button', { name: 'settings.provider.api_setup.save_key' }))

    await screen.findAllByText('alpha')
    expect(updateApiKeyMock).toHaveBeenCalledWith('saved-key', { key: 'sk-replacement', isEnabled: true })
    expect(addApiKeyMock).not.toHaveBeenCalled()
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

  it('lets a custom provider add a model manually when remote model loading fails', async () => {
    provider = { ...provider, presetProviderId: undefined }
    fetchResolvedProviderModelsMock.mockRejectedValueOnce(new Error('models endpoint unsupported'))

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    await screen.findByRole('alert')
    expect(screen.queryByRole('textbox', { name: 'common.search' })).not.toBeInTheDocument()
    const manualAddButton = screen.getByRole('button', { name: 'settings.provider.api_setup.add_model_manually' })

    fireEvent.click(manualAddButton)
    expect(screen.getByTestId('manual-model-dialog')).toBeInTheDocument()

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

    await screen.findByText(/insufficient balance/)
    expect(
      screen.getByRole('heading', { name: /settings\.provider\.api_setup\.verify_and_enable/ })
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
    expect(await screen.findByText('settings.provider.api_setup.success')).toBeInTheDocument()
  })

  it('treats a verification timeout as a failed real request and leaves the provider off', async () => {
    provider = { ...provider, isEnabled: true }
    checkApiMock.mockRejectedValueOnce(new Error('Request timed out'))

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    await screen.findAllByText('alpha')
    fireEvent.click(screen.getAllByLabelText('settings.provider.api_setup.select_model')[0])
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' }))
    fireEvent.click(await screen.findByRole('button', { name: 'settings.provider.api_setup.verify_and_enable' }))

    await screen.findByText(/Request timed out/)
    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: false })
    expect(enableProviderMock).not.toHaveBeenCalled()
  })

  it('keeps partial model creation and does not check or enable when a later batch fails', async () => {
    const models = Array.from({ length: 501 }, (_, index) => createModel(`model-${index}`))
    fetchResolvedProviderModelsMock.mockResolvedValue(models)
    createModelsMock
      .mockImplementationOnce(async (dtos: Array<{ modelId: string; name: string }>) =>
        dtos.map((dto) => ({ ...createModel(dto.modelId), name: dto.name }))
      )
      .mockRejectedValueOnce(new Error('second batch failed'))

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
  })

  it('adds high-cost models without probing or enabling the provider', async () => {
    getModelHealthCheckSkipReasonMock.mockReturnValue({ kind: 'generation_cost', output: 'image' })

    render(<ProviderApiSetupDialog providerId="openai" initialStep="models" onClose={vi.fn()} />)

    await screen.findAllByText('alpha')
    fireEvent.click(screen.getAllByLabelText('settings.provider.api_setup.select_model')[0])
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.progress.add_models' }))

    await screen.findByText('settings.provider.api_setup.manual_title')
    expect(
      screen.getByRole('heading', { name: /settings\.provider\.api_setup\.verify_and_enable/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('listitem', {
        name: 'settings.provider.api_setup.progress.add_models common.success'
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'settings.provider.api_setup.verify_and_enable' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('listitem', {
        name: 'settings.provider.api_setup.progress.check_model settings.models.check.status_skipped'
      })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.close' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.back_to_models' }))
    expect(screen.getByRole('heading', { name: /settings\.provider\.api_setup\.models_title/ })).toBeInTheDocument()
    expect(screen.getAllByLabelText('settings.provider.api_setup.select_model')[0]).toBeChecked()
    expect(createModelsMock).toHaveBeenCalledTimes(1)
    expect(checkApiMock).not.toHaveBeenCalled()
    expect(enableProviderMock).not.toHaveBeenCalled()
  })
})
