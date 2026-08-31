import { ENDPOINT_TYPE, MODALITY, MODEL_CAPABILITY } from '@shared/data/types/model'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import AddModelDrawer from '../ModelDrawer/AddModelDrawer'

const useProviderMock = vi.fn()
const useModelsMock = vi.fn()
const createModelMock = vi.fn()
const updateModelMock = vi.fn()
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()

const { ipcRequest } = vi.hoisted(() => ({ ipcRequest: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequest }, useIpcOn: vi.fn() }))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()
  const translations: Record<string, string> = {
    'settings.models.add.context_window.label': 'Context window',
    'settings.models.add.max_input_tokens.label': 'Max input tokens',
    'settings.models.add.max_output_tokens.label': 'Max output tokens',
    'settings.models.add.max_output_tokens.placeholder': 'e.g. 65536',
    'settings.models.add.quick_presets': 'Quick presets'
  }

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => translations[key] ?? key
    })
  }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    Button: ({ children, onClick, type = 'button', form, loading, disabled, ...props }: any) => (
      <button
        type={type}
        form={form}
        disabled={disabled || loading}
        data-loading={loading}
        onClick={onClick}
        {...props}>
        {children}
      </button>
    ),
    Switch: ({ checked, onCheckedChange, ...props }: any) => (
      <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} {...props}>
        {String(checked)}
      </button>
    ),
    Tooltip: ({ children, content }: any) => <span aria-label={content}>{children}</span>,
    WarnTooltip: () => <span>warn</span>
  }
})

vi.mock('@renderer/services/toast', () => ({
  toast: {
    success: (...args: any[]) => toastSuccessMock(...args),
    error: (...args: any[]) => toastErrorMock(...args)
  }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: any[]) => useModelsMock(...args),
  useModelMutations: () => ({
    createModel: (...args: any[]) => createModelMock(...args),
    updateModel: (...args: any[]) => updateModelMock(...args)
  })
}))

vi.mock('@renderer/components/icons/CopyIcon', () => ({
  default: () => <span>copy-icon</span>
}))

vi.mock('../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ open, title, children, footer }: any) =>
    open ? (
      <div data-testid="provider-settings-drawer">
        <div>{title}</div>
        {children}
        {footer}
      </div>
    ) : null
}))

describe('Model drawers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcRequest.mockImplementation((route: string) =>
      route === 'app.get_info' ? Promise.resolve({}) : Promise.resolve(undefined)
    )

    useModelsMock.mockReturnValue({ models: [] })
  })

  it('renders the legacy add drawer without the inner panel shell and submits through the local drawer form', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })
    const onClose = vi.fn()
    const onSuccess = vi.fn()

    render(<AddModelDrawer providerId="openai" open prefill={null} onClose={onClose} onSuccess={onSuccess} />)

    expect(screen.getByTestId('provider-settings-model-add-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('provider-settings-model-add-drawer-content')).toBeInTheDocument()
    expect(screen.queryByText('settings.models.add.endpoint_type.tooltip')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('settings.models.add.model_id.label'), {
      target: { value: 'alpha-model' }
    })
    fireEvent.change(screen.getByLabelText('settings.models.add.model_name.label'), {
      target: { value: 'Alpha Model' }
    })
    fireEvent.change(screen.getByLabelText('settings.models.add.group_name.label'), {
      target: { value: 'Alpha' }
    })
    await act(async () => {
      fireEvent.submit(screen.getByTestId('provider-settings-model-add-drawer-content'))
    })

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        modelId: 'alpha-model',
        name: 'Alpha Model',
        group: 'Alpha',
        endpointTypes: undefined
      })
    )
    expect(createModelMock.mock.calls[0][0]).not.toHaveProperty('inputModalities')
    expect(onSuccess).toHaveBeenCalledWith(['openai::alpha-model'])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('marks only the model ID as required and blocks empty submission', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })

    render(<AddModelDrawer providerId="openai" open prefill={null} onClose={vi.fn()} />)

    const modelIdInput = screen.getByLabelText('settings.models.add.model_id.label')

    expect(screen.getByText('*')).toBeInTheDocument()
    expect(modelIdInput).toBeRequired()
    expect(screen.getByLabelText('settings.models.add.model_name.label')).not.toBeRequired()
    expect(screen.getByLabelText('settings.models.add.group_name.label')).not.toBeRequired()
    fireEvent.click(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i }))

    expect(screen.getByText('settings.models.add.model_id.required')).toBeInTheDocument()
    expect(modelIdInput).toHaveFocus()
    expect(createModelMock).not.toHaveBeenCalled()
  })

  it('creates a New API model with multiple endpoint types', async () => {
    const user = userEvent.setup()
    useProviderMock.mockReturnValue({
      provider: { id: 'new-api', name: 'New API' }
    })

    render(<AddModelDrawer providerId="new-api" open prefill={null} onClose={vi.fn()} />)

    expect(screen.getByTestId('provider-settings-model-add-dialog')).toBeInTheDocument()
    const endpointField = screen.getByTestId('provider-settings-model-endpoint-type-field')
    const endpointSelect = within(endpointField).getByRole('combobox')
    expect(endpointSelect).toHaveTextContent('endpoint_type.openai')
    expect(screen.queryByText('settings.models.add.purpose.label')).not.toBeInTheDocument()

    await user.click(endpointSelect)
    await user.click(await screen.findByRole('option', { name: 'endpoint_type.anthropic' }))
    await user.type(screen.getByLabelText('settings.models.add.model_id.label'), 'claude-4-sonnet')
    await user.click(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i }))

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'new-api',
        modelId: 'claude-4-sonnet',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      })
    )
  })

  it('atomically maps a custom model to image editing from the purpose surface', async () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'custom-provider',
        name: 'Custom Provider',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.example.com' }
        }
      }
    })

    render(<AddModelDrawer providerId="custom-provider" open prefill={null} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: /settings\.models\.add\.purpose\.image_edit\.label/ }))
    fireEvent.change(screen.getByLabelText('settings.models.add.model_id.label'), {
      target: { value: 'image-editor' }
    })

    await act(async () => {
      fireEvent.submit(screen.getByTestId('provider-settings-model-add-drawer-content'))
    })

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'custom-provider',
        modelId: 'image-editor',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT],
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
        inputModalities: [MODALITY.IMAGE],
        outputModalities: [MODALITY.IMAGE]
      })
    )
  })

  it('adds a custom chat model without purpose choices in the simplified flow', async () => {
    const user = userEvent.setup()
    useProviderMock.mockReturnValue({
      provider: {
        id: 'custom-provider',
        name: 'Custom Provider',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.example.com' }
        }
      }
    })

    render(
      <AddModelDrawer providerId="custom-provider" open prefill={null} onClose={vi.fn()} showPurposeSelection={false} />
    )

    expect(screen.queryByText('settings.models.add.purpose.label')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('settings.models.add.model_id.label'), 'chat-model')
    await user.click(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i }))

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'custom-provider',
        modelId: 'chat-model',
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      })
    )
  })

  it('saves independent model type, capability, and input-modality selections when adding', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })

    render(<AddModelDrawer providerId="openai" open prefill={null} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('settings.models.add.model_id.label'), {
      target: { value: 'custom-image-model' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.moresetting.label' }))
    fireEvent.click(screen.getByRole('button', { name: 'models.type.image' }))
    fireEvent.click(screen.getByRole('button', { name: 'models.type.reasoning' }))
    fireEvent.click(screen.getByRole('button', { name: 'models.type.audio' }))

    await act(async () => {
      fireEvent.submit(screen.getByTestId('provider-settings-model-add-drawer-content'))
    })

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION, MODEL_CAPABILITY.REASONING],
        inputModalities: [MODALITY.AUDIO]
      })
    )
  })

  it('preserves an explicitly emptied input-modality selection when adding', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })

    render(<AddModelDrawer providerId="openai" open prefill={null} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('settings.models.add.model_id.label'), {
      target: { value: 'explicit-text-model' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.moresetting.label' }))
    fireEvent.click(screen.getByRole('button', { name: 'models.type.audio' }))
    fireEvent.click(screen.getByRole('button', { name: 'models.type.audio' }))

    await act(async () => {
      fireEvent.submit(screen.getByTestId('provider-settings-model-add-drawer-content'))
    })

    expect(createModelMock).toHaveBeenCalledWith(expect.objectContaining({ inputModalities: [] }))
  })

  it('keeps the add-model submit disabled while creating and shows one inline error on failure', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })
    let rejectCreate!: (error: Error) => void
    createModelMock.mockReturnValue(
      new Promise((_, reject) => {
        rejectCreate = reject
      })
    )

    render(<AddModelDrawer providerId="openai" open prefill={null} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('settings.models.add.model_id.label'), {
      target: { value: 'alpha-model' }
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i }))
    })

    expect(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /common\.cancel/i })).toBeDisabled()

    await act(async () => {
      rejectCreate(new Error('create failed'))
    })

    expect(screen.getByRole('alert')).toHaveTextContent('settings.models.manage.operation_failed')
    expect(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i })).not.toBeDisabled()
  })

  it('offers independent token limit presets and keeps custom input available', async () => {
    const user = userEvent.setup()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })

    render(<AddModelDrawer providerId="openai" open prefill={null} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'settings.moresetting.label' }))

    const contextGroup = screen.getByRole('group', {
      name: 'Context window Quick presets'
    })
    const maxInputGroup = screen.getByRole('group', {
      name: 'Max input tokens Quick presets'
    })
    const maxOutputGroup = screen.getByRole('group', {
      name: 'Max output tokens Quick presets'
    })
    const contextPreset = within(contextGroup).getByRole('button', { name: /200K \(200000\)/ })
    const maxInputPreset = within(maxInputGroup).getByRole('button', { name: /512K \(512000\)/ })
    const maxOutputPreset = within(maxOutputGroup).getByRole('button', { name: /256K \(256000\)/ })

    expect(within(contextGroup).getAllByRole('button')).toHaveLength(6)
    expect(within(maxInputGroup).getAllByRole('button')).toHaveLength(5)
    expect(within(maxOutputGroup).getAllByRole('button')).toHaveLength(5)
    expect(screen.getByLabelText('Max output tokens')).toHaveAttribute('placeholder', 'e.g. 65536')

    await user.click(contextPreset)
    await user.click(maxInputPreset)
    await user.click(maxOutputPreset)

    expect(screen.getByLabelText('Context window')).toHaveValue('200000')
    expect(screen.getByLabelText('Max input tokens')).toHaveValue('512000')
    expect(screen.getByLabelText('Max output tokens')).toHaveValue('256000')
    expect(contextPreset).toHaveAttribute('aria-pressed', 'true')
    expect(maxInputPreset).toHaveAttribute('aria-pressed', 'true')
    expect(maxOutputPreset).toHaveAttribute('aria-pressed', 'true')

    const contextInput = screen.getByLabelText('Context window')
    await user.clear(contextInput)
    await user.type(contextInput, '777777')

    expect(screen.getByLabelText('Context window')).toHaveValue('777777')
    expect(contextPreset).toHaveAttribute('aria-pressed', 'false')
  })

  it('submits the exact values selected from token limit presets', async () => {
    const user = userEvent.setup()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })

    render(<AddModelDrawer providerId="openai" open prefill={null} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'settings.moresetting.label' }))

    await user.type(screen.getByLabelText('settings.models.add.model_id.label'), 'preset-model')
    await user.click(screen.getByRole('button', { name: /512K \(524288\)/ }))
    await user.click(screen.getByRole('button', { name: 'Max input tokens: 1M (1000000)' }))
    await user.click(
      within(
        screen.getByRole('group', {
          name: 'Max output tokens Quick presets'
        })
      ).getByRole('button', { name: /128K \(128000\)/ })
    )
    await user.click(screen.getByRole('button', { name: 'settings.models.add.add_model' }))

    await waitFor(() =>
      expect(createModelMock).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'openai',
          modelId: 'preset-model',
          contextWindow: 524288,
          maxInputTokens: 1000000,
          maxOutputTokens: 128000
        })
      )
    )
  })
})
