import { toast } from '@renderer/services/toast'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AddModelDrawer from '../ModelDrawer/AddModelDrawer'
import EditModelDrawer from '../ModelDrawer/EditModelDrawer'

const useProviderMock = vi.fn()
const useModelsMock = vi.fn()
const createModelMock = vi.fn()
const updateModelMock = vi.fn()

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
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

vi.mock('@renderer/components/tags/Model', () => ({
  VisionTag: ({ onClick }: any) => (
    <button type="button" onClick={onClick}>
      vision
    </button>
  ),
  WebSearchTag: ({ onClick }: any) => (
    <button type="button" onClick={onClick}>
      web_search
    </button>
  ),
  ReasoningTag: ({ onClick }: any) => (
    <button type="button" onClick={onClick}>
      reasoning
    </button>
  ),
  ToolsCallingTag: ({ onClick }: any) => (
    <button type="button" onClick={onClick}>
      function_calling
    </button>
  ),
  RerankerTag: ({ onClick }: any) => (
    <button type="button" onClick={onClick}>
      rerank
    </button>
  ),
  EmbeddingTag: ({ onClick }: any) => (
    <button type="button" onClick={onClick}>
      embedding
    </button>
  )
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
    ;(window as any).api.getAppInfo = vi.fn().mockResolvedValue({})

    useModelsMock.mockReturnValue({ models: [] })
  })

  it('renders the legacy add drawer without the inner panel shell and submits through the local drawer form', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })

    render(<AddModelDrawer providerId="openai" open prefill={null} onClose={vi.fn()} />)

    expect(screen.getByTestId('provider-settings-drawer')).toBeInTheDocument()
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
  })

  it('renders the new-api add drawer with the shared select surface and keeps endpoint type in create payload', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'new-api', name: 'New API' }
    })

    render(<AddModelDrawer providerId="new-api" open prefill={null} onClose={vi.fn()} />)

    expect(screen.getByTestId('provider-settings-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('provider-settings-model-endpoint-type-field')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('settings.models.add.model_id.label'), {
      target: { value: 'claude-4-sonnet' }
    })
    await act(async () => {
      fireEvent.submit(screen.getByTestId('provider-settings-model-add-drawer-content'))
    })

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'new-api',
        modelId: 'claude-4-sonnet',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      })
    )
  })

  it('keeps the add-model submit disabled while creating and shows an error toast on failure', async () => {
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

    expect(toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
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
            capabilities: [],
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

  it('auto-saves cherryin endpoint type changes from the edit drawer', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'cherryin', name: 'CherryIN' }
    })

    render(
      <EditModelDrawer
        providerId="cherryin"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'cherryin::claude-4-sonnet',
            providerId: 'cherryin',
            name: 'claude-4-sonnet',
            group: 'Anthropic',
            capabilities: [],
            endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES],
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
      fireEvent.click(screen.getByRole('button', { name: 'endpoint_type.openai' }))
    })

    expect(updateModelMock).toHaveBeenCalledWith(
      'cherryin',
      'claude-4-sonnet',
      expect.objectContaining({
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_RESPONSES]
      })
    )
  })

  it('prevents clearing the last endpoint type from the edit drawer', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'cherryin', name: 'CherryIN' }
    })

    render(
      <EditModelDrawer
        providerId="cherryin"
        open
        onClose={vi.fn()}
        model={
          {
            id: 'cherryin::claude-4-sonnet',
            providerId: 'cherryin',
            name: 'claude-4-sonnet',
            group: 'Anthropic',
            capabilities: [],
            endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES],
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    const responseEndpointButton = screen.getByRole('button', { name: 'endpoint_type.openai-response' })
    expect(responseEndpointButton).toHaveAttribute('aria-disabled', 'true')
    expect(responseEndpointButton).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(responseEndpointButton)
    })

    expect(updateModelMock).not.toHaveBeenCalled()
  })
})
