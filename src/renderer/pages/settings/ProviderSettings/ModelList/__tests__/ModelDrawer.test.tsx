import { ENDPOINT_TYPE, MODALITY, MODEL_CAPABILITY } from '@shared/data/types/model'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import AddModelDrawer from '../ModelDrawer/AddModelDrawer'
import EditModelDrawer from '../ModelDrawer/EditModelDrawer'

const useProviderMock = vi.fn()
const useProviderPresetMock = vi.fn()
const useModelsMock = vi.fn()
const createModelMock = vi.fn()
const updateModelMock = vi.fn()
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()

const newApiProvider = {
  id: 'new-api',
  name: 'New API',
  endpointConfigs: {
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
      adapterFamily: 'newapi',
      baseUrl: 'http://localhost:3000'
    },
    [ENDPOINT_TYPE.OPENAI_RESPONSES]: { adapterFamily: 'newapi' },
    [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'newapi' },
    [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { adapterFamily: 'newapi' }
  }
}

const { ipcRequest } = vi.hoisted(() => ({ ipcRequest: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequest }, useIpcOn: vi.fn() }))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

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
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderPreset: (...args: any[]) => useProviderPresetMock(...args)
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
    useProviderPresetMock.mockReturnValue({ data: undefined })
  })

  it('renders the legacy add drawer without the inner panel shell and submits through the local drawer form', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })

    render(<AddModelDrawer providerId="openai" open prefill={null} onClose={vi.fn()} />)

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
      provider: newApiProvider
    })

    render(
      <AddModelDrawer
        providerId="new-api"
        open
        prefill={{ endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS }}
        onClose={vi.fn()}
      />
    )

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
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      })
    )
  })

  it('clears a chosen endpoint when the add form removes it from the supported set', async () => {
    const user = userEvent.setup()
    useProviderMock.mockReturnValue({
      provider: newApiProvider
    })

    render(
      <AddModelDrawer
        providerId="new-api"
        open
        prefill={{ endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS }}
        onClose={vi.fn()}
      />
    )

    const endpointSelect = within(screen.getByTestId('provider-settings-model-endpoint-type-field')).getByRole(
      'combobox'
    )
    await user.click(endpointSelect)
    await user.click(await screen.findByRole('option', { name: 'endpoint_type.anthropic' }))

    const preferredField = screen.getByTestId('provider-settings-model-preferred-endpoint-field')
    await user.click(within(preferredField).getByRole('radio', { name: 'endpoint_type.anthropic' }))

    await user.click(endpointSelect)
    await user.click(await screen.findByRole('option', { name: 'endpoint_type.anthropic' }))
    // The pin left the supported set, so it must not survive to the create payload.
    expect(
      within(screen.getByTestId('provider-settings-model-preferred-endpoint-field')).getByRole('radio', {
        name: /settings\.models\.add\.preferred_endpoint\.inherit/
      })
    ).toBeChecked()

    await user.type(screen.getByLabelText('settings.models.add.model_id.label'), 'chat-only-model')
    await user.click(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i }))

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      })
    )
    expect(createModelMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ preferredEndpointType: expect.anything() })
    )
  })

  it('pins the chosen endpoint without touching the supported set', async () => {
    const user = userEvent.setup()
    // doubao-shaped: an ordinary preset provider that speaks both chat completions and responses.
    useProviderMock.mockReturnValue({
      provider: {
        id: 'doubao',
        name: 'doubao',
        presetProviderId: 'doubao',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://ark.example.com' },
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://ark.example.com' }
        }
      }
    })

    render(<AddModelDrawer providerId="doubao" open prefill={null} onClose={vi.fn()} />)

    // No capability multi-select here — only the routing choice.
    expect(screen.queryByTestId('provider-settings-model-endpoint-type-field')).not.toBeInTheDocument()
    const preferredField = screen.getByTestId('provider-settings-model-preferred-endpoint-field')
    expect(
      screen.getByRole('img', {
        name: 'settings.models.add.preferred_endpoint.label: settings.models.add.preferred_endpoint.tooltip'
      })
    ).toBeInTheDocument()
    expect(
      within(preferredField).getByRole('radio', { name: /settings\.models\.add\.preferred_endpoint\.inherit/ })
    ).toBeChecked()

    await user.click(within(preferredField).getByRole('radio', { name: 'endpoint_type.openai-response' }))
    await user.type(screen.getByLabelText('settings.models.add.model_id.label'), 'doubao-seed-2-1-pro')
    await user.click(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i }))

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'doubao',
        modelId: 'doubao-seed-2-1-pro',
        preferredEndpointType: ENDPOINT_TYPE.OPENAI_RESPONSES,
        endpointTypes: undefined
      })
    )
  })

  it('leaves the endpoint choice unset when the user never picks one', async () => {
    const user = userEvent.setup()
    useProviderMock.mockReturnValue({
      provider: {
        id: 'doubao',
        name: 'doubao',
        presetProviderId: 'doubao',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://ark.example.com' },
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://ark.example.com' }
        }
      }
    })

    render(<AddModelDrawer providerId="doubao" open prefill={null} onClose={vi.fn()} />)

    await user.type(screen.getByLabelText('settings.models.add.model_id.label'), 'doubao-seed-2-1-pro')
    await user.click(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i }))

    // Pinning the default anyway would freeze the model against future registry updates.
    expect(createModelMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ preferredEndpointType: expect.anything() })
    )
  })

  it('drops a provider-wide pin that is unsupported by an entered preset model', async () => {
    const user = userEvent.setup()
    useProviderMock.mockReturnValue({
      provider: {
        id: 'doubao',
        name: 'doubao',
        presetProviderId: 'doubao',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://ark.example.com' },
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://ark.example.com' }
        }
      }
    })
    useProviderPresetMock.mockReturnValue({
      data: {
        models: [
          {
            id: 'doubao::chat-only-preset',
            providerId: 'doubao',
            apiModelId: 'chat-only-preset',
            name: 'Chat Only Preset',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
            supportsStreaming: true
          }
        ]
      }
    })

    render(<AddModelDrawer providerId="doubao" open prefill={null} onClose={vi.fn()} />)

    const preferredField = screen.getByTestId('provider-settings-model-preferred-endpoint-field')
    await user.click(within(preferredField).getByRole('radio', { name: 'endpoint_type.openai-response' }))
    await user.type(screen.getByLabelText('settings.models.add.model_id.label'), 'chat-only-preset,custom-model')

    expect(screen.queryByTestId('provider-settings-model-preferred-endpoint-field')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /settings\.models\.add\.add_model/i }))

    expect(createModelMock).toHaveBeenCalledTimes(2)
    for (const [payload] of createModelMock.mock.calls) {
      expect(payload).not.toHaveProperty('preferredEndpointType')
    }
  })

  it('hides the endpoint choice when the provider serves a single chat endpoint', () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'anthropic',
        name: 'Anthropic',
        presetProviderId: 'anthropic',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.anthropic.com' } }
      }
    })

    render(<AddModelDrawer providerId="anthropic" open prefill={null} onClose={vi.fn()} />)

    expect(screen.queryByTestId('provider-settings-model-preferred-endpoint-field')).not.toBeInTheDocument()
  })

  it('shows operation-compatible endpoint controls for a custom provider', () => {
    const provider = {
      id: 'custom-provider',
      name: 'Custom Provider',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.example.com/v1' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.example.com/anthropic' }
      }
    }
    useProviderMock.mockReturnValue({ provider })

    const addDrawer = render(<AddModelDrawer providerId="custom-provider" open prefill={null} onClose={vi.fn()} />)

    expect(screen.getByTestId('provider-settings-model-endpoint-type-field')).toBeInTheDocument()
    expect(screen.getByTestId('provider-settings-model-preferred-endpoint-field')).toBeInTheDocument()
    addDrawer.unmount()

    render(
      <EditModelDrawer
        providerId="custom-provider"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'custom-provider::chat-model',
            providerId: 'custom-provider',
            apiModelId: 'chat-model',
            name: 'Chat Model',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
            supportsStreaming: true
          } as any
        }
      />
    )

    expect(screen.getByTestId('provider-settings-model-endpoint-type-field')).toBeInTheDocument()
    expect(screen.getByTestId('provider-settings-model-preferred-endpoint-field')).toBeInTheDocument()
  })

  it('expresses image editing with the image operation, image input, and edit endpoint', async () => {
    const user = userEvent.setup()
    useProviderMock.mockReturnValue({
      provider: {
        id: 'custom-provider',
        name: 'Custom Provider',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: { baseUrl: 'https://api.example.com' }
        }
      }
    })

    render(<AddModelDrawer providerId="custom-provider" open prefill={null} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'settings.moresetting.label' }))
    await user.click(screen.getByRole('button', { name: 'models.type.image' }))
    await user.click(screen.getByRole('button', { name: 'models.type.text' }))
    await user.click(screen.getByRole('button', { name: 'models.type.vision' }))
    const endpointSelect = within(screen.getByTestId('provider-settings-model-endpoint-type-field')).getByRole(
      'combobox'
    )
    await user.click(endpointSelect)
    await user.click(await screen.findByRole('option', { name: 'endpoint_type.image-edit' }))
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
        inputModalities: [MODALITY.IMAGE]
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
        capabilities: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.IMAGE_GENERATION, MODEL_CAPABILITY.REASONING],
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

  it('loads edit values, shows more settings, and auto-saves edits on the existing mutation path', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })

    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'openai::claude-4-sonnet',
            providerId: 'openai',
            name: 'claude-4-sonnet',
            group: 'Anthropic',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    expect(screen.getByLabelText('settings.models.add.model_name.label')).toHaveValue('claude-4-sonnet')
    const modelIdInput = screen.getByLabelText('settings.models.add.model_id.label')
    expect(modelIdInput).toHaveValue('claude-4-sonnet')
    expect(modelIdInput).toHaveAttribute('readonly')
    expect(modelIdInput).not.toBeDisabled()
    expect(screen.getByTestId('provider-settings-model-edit-drawer-content')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /common\.save/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /common\.cancel/i })).not.toBeInTheDocument()

    expect(screen.getByTestId('provider-settings-model-more-settings')).toBeInTheDocument()

    await act(async () => {
      const inputPrice = screen.getByLabelText('models.price.input')
      fireEvent.change(inputPrice, {
        target: { value: '12.5' }
      })
      fireEvent.blur(inputPrice)
    })
    expect(updateModelMock).toHaveBeenCalledWith(
      'openai',
      'claude-4-sonnet',
      expect.objectContaining({
        pricing: expect.objectContaining({
          input: expect.objectContaining({ perMillionTokens: 12.5 })
        })
      })
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'settings.models.add.supported_text_delta.label' }))
    })
    expect(updateModelMock).toHaveBeenCalledWith(
      'openai',
      'claude-4-sonnet',
      expect.objectContaining({
        supportsStreaming: false
      })
    )

    await act(async () => {
      const modelName = screen.getByLabelText('settings.models.add.model_name.label')
      fireEvent.change(modelName, {
        target: { value: 'Claude 4 Sonnet Updated' }
      })
      fireEvent.blur(modelName)
    })
    expect(updateModelMock).toHaveBeenCalledWith(
      'openai',
      'claude-4-sonnet',
      expect.objectContaining({
        name: 'Claude 4 Sonnet Updated'
      })
    )
  })

  it('auto-saves image generation as an additional model operation', async () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'custom-provider',
        name: 'Custom Provider',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.example.com' },
          [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://api.example.com' }
        }
      }
    })

    render(
      <EditModelDrawer
        providerId="custom-provider"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'custom-provider::image-model',
            providerId: 'custom-provider',
            name: 'Image Model',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'models.type.image' }))
    })

    expect(updateModelMock).toHaveBeenCalledWith(
      'custom-provider',
      'image-model',
      expect.objectContaining({
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
        capabilities: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.IMAGE_GENERATION]
      })
    )
  })

  it('does not overwrite the saved chat endpoint when opening the edit drawer', async () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'custom-provider',
        name: 'Custom Provider',
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.example.com' },
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.example.com' }
        }
      }
    })

    render(
      <EditModelDrawer
        providerId="custom-provider"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'custom-provider::custom-openai-model',
            providerId: 'custom-provider',
            name: 'Custom OpenAI Model',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
            supportsStreaming: true
          } as any
        }
      />
    )

    await waitFor(() => {
      expect(
        within(screen.getByTestId('provider-settings-model-endpoint-type-field')).getByRole('combobox')
      ).toHaveTextContent('endpoint_type.openai')
    })
    expect(updateModelMock).not.toHaveBeenCalled()
  })

  it('keeps model type, capabilities, and input modalities independently editable', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })

    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'openai::custom-embedding',
            providerId: 'openai',
            name: 'Custom Embedding',
            group: 'Custom',
            capabilities: [MODEL_CAPABILITY.EMBEDDING],
            inputModalities: [],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    const imageType = screen.getByRole('button', { name: 'models.type.image' })
    const reasoning = screen.getByRole('button', { name: 'models.type.reasoning' })
    const videoInput = screen.getByRole('button', { name: 'models.type.video' })
    expect(imageType).not.toBeDisabled()
    expect(reasoning).not.toBeDisabled()
    expect(videoInput).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(imageType)
    })
    expect(updateModelMock).toHaveBeenLastCalledWith(
      'openai',
      'custom-embedding',
      expect.objectContaining({
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION, MODEL_CAPABILITY.EMBEDDING],
        inputModalities: []
      })
    )

    await act(async () => {
      fireEvent.click(reasoning)
    })
    expect(updateModelMock).toHaveBeenLastCalledWith(
      'openai',
      'custom-embedding',
      expect.objectContaining({
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION, MODEL_CAPABILITY.EMBEDDING, MODEL_CAPABILITY.REASONING],
        inputModalities: []
      })
    )

    await act(async () => {
      fireEvent.click(videoInput)
    })
    expect(updateModelMock).toHaveBeenLastCalledWith(
      'openai',
      'custom-embedding',
      expect.objectContaining({
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION, MODEL_CAPABILITY.EMBEDDING, MODEL_CAPABILITY.REASONING],
        inputModalities: [MODALITY.VIDEO]
      })
    )
  })

  it('serializes edit auto-saves and keeps the latest form snapshot', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })
    const firstSave = deferred<void>()
    updateModelMock.mockReturnValueOnce(firstSave.promise).mockResolvedValue(undefined)

    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'openai::claude-4-sonnet',
            providerId: 'openai',
            name: 'claude-4-sonnet',
            group: 'Anthropic',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    await act(async () => {
      const inputPrice = screen.getByLabelText('models.price.input')
      fireEvent.change(inputPrice, {
        target: { value: '12.5' }
      })
      fireEvent.blur(inputPrice)
    })

    expect(updateModelMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      const outputPrice = screen.getByLabelText('models.price.output')
      fireEvent.change(outputPrice, {
        target: { value: '7.25' }
      })
      fireEvent.blur(outputPrice)
    })

    expect(updateModelMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstSave.resolve()
      await firstSave.promise
      await Promise.resolve()
    })

    expect(updateModelMock).toHaveBeenCalledTimes(2)
    expect(updateModelMock.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        pricing: expect.objectContaining({
          input: expect.objectContaining({ perMillionTokens: 12.5 }),
          output: expect.objectContaining({ perMillionTokens: 7.25 })
        })
      })
    )
  })

  it('does not save a new model edit into an older in-flight model', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })
    const firstSave = deferred<void>()
    updateModelMock.mockReturnValueOnce(firstSave.promise).mockResolvedValue(undefined)

    const { rerender } = render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'openai::model-a',
            providerId: 'openai',
            name: 'Model A',
            group: 'Group A',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    await act(async () => {
      const modelName = screen.getByLabelText('settings.models.add.model_name.label')
      fireEvent.change(modelName, {
        target: { value: 'Model A Updated' }
      })
      fireEvent.blur(modelName)
    })

    rerender(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'openai::model-b',
            providerId: 'openai',
            name: 'Model B',
            group: 'Group B',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    await act(async () => {
      const modelName = screen.getByLabelText('settings.models.add.model_name.label')
      fireEvent.change(modelName, {
        target: { value: 'Model B Updated' }
      })
      fireEvent.blur(modelName)
    })

    expect(updateModelMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstSave.resolve()
      await firstSave.promise
      await Promise.resolve()
    })

    expect(updateModelMock).toHaveBeenCalledTimes(2)
    expect(updateModelMock.mock.calls[0]).toEqual([
      'openai',
      'model-a',
      expect.objectContaining({ name: 'Model A Updated' })
    ])
    expect(updateModelMock.mock.calls[1]).toEqual([
      'openai',
      'model-b',
      expect.objectContaining({ name: 'Model B Updated' })
    ])
  })

  it('preserves pending auto-saves for the previous model when switching models', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })
    const firstSave = deferred<void>()
    updateModelMock.mockReturnValueOnce(firstSave.promise).mockResolvedValue(undefined)

    const { rerender } = render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'openai::model-a',
            providerId: 'openai',
            name: 'Model A',
            group: 'Group A',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    await act(async () => {
      const inputPrice = screen.getByLabelText('models.price.input')
      fireEvent.change(inputPrice, {
        target: { value: '1.5' }
      })
      fireEvent.blur(inputPrice)
    })
    expect(updateModelMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      const outputPrice = screen.getByLabelText('models.price.output')
      fireEvent.change(outputPrice, {
        target: { value: '2.5' }
      })
      fireEvent.blur(outputPrice)
    })
    expect(updateModelMock).toHaveBeenCalledTimes(1)

    rerender(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'openai::model-b',
            providerId: 'openai',
            name: 'Model B',
            group: 'Group B',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    await act(async () => {
      firstSave.resolve()
      await firstSave.promise
      await Promise.resolve()
    })

    expect(updateModelMock).toHaveBeenCalledTimes(2)
    expect(updateModelMock.mock.calls[1]).toEqual([
      'openai',
      'model-a',
      expect.objectContaining({
        pricing: expect.objectContaining({
          input: expect.objectContaining({ perMillionTokens: 1.5 }),
          output: expect.objectContaining({ perMillionTokens: 2.5 })
        })
      })
    ])
  })

  it('offers only the endpoints the aggregator reported for this model', async () => {
    const user = userEvent.setup()
    useProviderMock.mockReturnValue({
      provider: newApiProvider
    })

    render(
      <EditModelDrawer
        providerId="new-api"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'new-api::claude-4-sonnet',
            providerId: 'new-api',
            name: 'claude-4-sonnet',
            group: 'Anthropic',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            // What upstream `/models` reported in `supported_endpoint_types`.
            endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES, ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    expect(screen.getByTestId('provider-settings-model-endpoint-type-field')).toBeInTheDocument()
    const preferredField = screen.getByTestId('provider-settings-model-preferred-endpoint-field')
    expect(
      within(preferredField)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('value'))
    ).toEqual(['inherit', ENDPOINT_TYPE.OPENAI_RESPONSES, ENDPOINT_TYPE.ANTHROPIC_MESSAGES])
    // Nothing is pinned yet, so the model inherits — the chip names where that lands today rather
    // than showing the effective route as if it had been chosen.
    expect(
      within(preferredField).getByRole('radio', { name: /settings\.models\.add\.preferred_endpoint\.inherit/ })
    ).toBeChecked()
    expect(updateModelMock).not.toHaveBeenCalled()

    await user.click(within(preferredField).getByRole('radio', { name: 'endpoint_type.anthropic' }))

    // Routing moves; the upstream-owned supported set is never rewritten.
    expect(updateModelMock).toHaveBeenCalledWith(
      'new-api',
      'claude-4-sonnet',
      expect.objectContaining({
        preferredEndpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointTypes: undefined
      })
    )
  })

  it('keeps a single-endpoint aggregator model showing which protocol it speaks', () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'cherryin',
        name: 'CherryIN',
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
            adapterFamily: 'cherryin',
            baseUrl: 'https://open.cherryin.net'
          }
        }
      }
    })

    render(
      <EditModelDrawer
        providerId="cherryin"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'cherryin::agent/kimi-k2.5',
            providerId: 'cherryin',
            name: 'Kimi K2.5',
            group: 'agent',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    // Nothing to choose, but which protocol an aggregator routes a model over is not implied by
    // the provider, so it stays on screen rather than disappearing.
    const preferredField = screen.getByTestId('provider-settings-model-preferred-endpoint-field')
    expect(
      within(preferredField)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('value'))
    ).toEqual(['inherit', ENDPOINT_TYPE.ANTHROPIC_MESSAGES])
  })

  it('falls back to configured chat routes when an aggregator reports no endpoints', () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'new-api',
        name: 'New API',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://new-api.example.com' },
          [ENDPOINT_TYPE.OPENAI_EMBEDDINGS]: { baseUrl: 'https://new-api.example.com' }
        }
      }
    })

    render(
      <EditModelDrawer
        providerId="new-api"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'new-api::unclassified-model',
            providerId: 'new-api',
            name: 'Unclassified Model',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            endpointTypes: [],
            supportsStreaming: true
          } as any
        }
      />
    )

    const preferredField = screen.getByTestId('provider-settings-model-preferred-endpoint-field')
    expect(
      within(preferredField)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('value'))
    ).toEqual(['inherit', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS])
  })

  it('hands routing back to the inherited order when the pin is cleared', async () => {
    const user = userEvent.setup()
    useProviderMock.mockReturnValue({
      provider: {
        id: 'doubao',
        name: 'doubao',
        presetProviderId: 'doubao',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://ark.example.com' },
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://ark.example.com' }
        }
      }
    })

    render(
      <EditModelDrawer
        providerId="doubao"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'doubao::doubao-seed-2-1-pro',
            providerId: 'doubao',
            name: 'doubao-seed-2-1-pro',
            group: 'doubao',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_RESPONSES],
            preferredEndpointType: ENDPOINT_TYPE.OPENAI_RESPONSES,
            supportsStreaming: true
          } as any
        }
      />
    )

    const preferredField = screen.getByTestId('provider-settings-model-preferred-endpoint-field')
    expect(within(preferredField).getByRole('radio', { name: 'endpoint_type.openai-response' })).toBeChecked()

    await user.click(
      within(preferredField).getByRole('radio', { name: /settings\.models\.add\.preferred_endpoint\.inherit/ })
    )

    // Without an explicit clear the pin was permanent, so a later registry default could never apply.
    expect(updateModelMock).toHaveBeenCalledWith(
      'doubao',
      'doubao-seed-2-1-pro',
      expect.objectContaining({ preferredEndpointType: null })
    )
  })

  it('auto-saves an endpoint switch as a routing preference, leaving the supported set alone', async () => {
    const user = userEvent.setup()
    useProviderMock.mockReturnValue({
      provider: {
        id: 'doubao',
        name: 'doubao',
        presetProviderId: 'doubao',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://ark.example.com' },
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://ark.example.com' }
        }
      }
    })

    render(
      <EditModelDrawer
        providerId="doubao"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'doubao::doubao-seed-2-1-pro',
            providerId: 'doubao',
            name: 'doubao-seed-2-1-pro',
            group: 'doubao',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_RESPONSES],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    const preferredField = screen.getByTestId('provider-settings-model-preferred-endpoint-field')
    // No stored pin, so the model inherits; the chip names where that lands rather than pretending
    // the effective route was chosen.
    expect(
      within(preferredField).getByRole('radio', { name: /settings\.models\.add\.preferred_endpoint\.inherit/ })
    ).toBeChecked()

    await user.click(within(preferredField).getByRole('radio', { name: 'endpoint_type.openai-response' }))

    expect(updateModelMock).toHaveBeenCalledWith(
      'doubao',
      'doubao-seed-2-1-pro',
      expect.objectContaining({
        preferredEndpointType: ENDPOINT_TYPE.OPENAI_RESPONSES,
        endpointTypes: undefined
      })
    )
  })

  it('never rewrites the upstream endpoint set from the edit drawer', async () => {
    const user = userEvent.setup()
    useProviderMock.mockReturnValue({
      provider: {
        id: 'cherryin',
        name: 'CherryIN',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://open.cherryin.net' },
          [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: { baseUrl: 'https://open.cherryin.net' }
        }
      }
    })

    render(
      <EditModelDrawer
        providerId="cherryin"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'cherryin::qwen-image-edit',
            providerId: 'cherryin',
            name: 'qwen-image-edit',
            group: 'Image',
            capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
            endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, ENDPOINT_TYPE.OPENAI_IMAGE_EDIT],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    const preferredField = screen.getByTestId('provider-settings-model-preferred-endpoint-field')
    await user.click(within(preferredField).getByRole('radio', { name: 'endpoint_type.image-edit' }))

    // Single-select over the upstream set: the route moves, the set itself cannot be narrowed,
    // extended, or emptied from here — which is what the old multi-select allowed.
    const patches = updateModelMock.mock.calls.map(([, , patch]) => patch)
    expect(patches).not.toHaveLength(0)
    for (const patch of patches) {
      expect(patch.endpointTypes).toBeUndefined()
    }
    expect(updateModelMock).toHaveBeenCalledWith(
      'cherryin',
      'qwen-image-edit',
      expect.objectContaining({ preferredEndpointType: ENDPOINT_TYPE.OPENAI_IMAGE_EDIT })
    )
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

  it('auto-saves preset and manually entered token limits from the edit drawer', async () => {
    const user = userEvent.setup()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })

    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'openai::preset-model',
            providerId: 'openai',
            name: 'preset-model',
            group: 'OpenAI',
            capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
            supportsStreaming: true
          } as any
        }
      />
    )

    await user.click(screen.getByRole('button', { name: /512K \(524288\)/ }))
    await user.click(screen.getByRole('button', { name: 'Max input tokens: 256K (256000)' }))
    await user.click(screen.getByRole('button', { name: /64K \(65536\)/ }))

    await waitFor(() => {
      expect(updateModelMock).toHaveBeenCalledWith(
        'openai',
        'preset-model',
        expect.objectContaining({ contextWindow: 524288 })
      )
      expect(updateModelMock).toHaveBeenCalledWith(
        'openai',
        'preset-model',
        expect.objectContaining({ maxInputTokens: 256000 })
      )
      expect(updateModelMock).toHaveBeenCalledWith(
        'openai',
        'preset-model',
        expect.objectContaining({ maxOutputTokens: 65536 })
      )
    })

    const contextInput = screen.getByLabelText('Context window')
    const maxInput = screen.getByLabelText('Max input tokens')
    const maxOutput = screen.getByLabelText('Max output tokens')

    await user.clear(contextInput)
    await user.type(contextInput, '777777')
    await user.click(maxInput)
    await user.clear(maxInput)
    await user.type(maxInput, '666666')
    await user.click(maxOutput)
    await user.clear(maxOutput)
    await user.type(maxOutput, '555555')
    await user.tab()

    await waitFor(() => {
      expect(updateModelMock).toHaveBeenCalledWith(
        'openai',
        'preset-model',
        expect.objectContaining({ contextWindow: 777777 })
      )
      expect(updateModelMock).toHaveBeenCalledWith(
        'openai',
        'preset-model',
        expect.objectContaining({ maxInputTokens: 666666 })
      )
      expect(updateModelMock).toHaveBeenCalledWith(
        'openai',
        'preset-model',
        expect.objectContaining({ maxOutputTokens: 555555 })
      )
    })
  })
})
