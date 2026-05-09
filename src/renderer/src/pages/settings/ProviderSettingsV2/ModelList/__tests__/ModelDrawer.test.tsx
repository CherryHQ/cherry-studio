import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AddModelDrawer from '../ModelDrawer/AddModelDrawer'
import EditModelDrawer from '../ModelDrawer/EditModelDrawer'

const useProviderMock = vi.fn()
const useModelsMock = vi.fn()
const createModelMock = vi.fn()
const deleteModelMock = vi.fn()
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
    Button: ({ children, onClick, type = 'button', form, ...props }: any) => (
      <button type={type} form={form} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Switch: ({ checked, onCheckedChange, ...props }: any) => (
      <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} {...props}>
        {String(checked)}
      </button>
    ),
    WarnTooltip: () => <span>warn</span>
  }
})

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: any[]) => useModelsMock(...args),
  useModelMutations: () => ({
    createModel: (...args: any[]) => createModelMock(...args),
    deleteModel: (...args: any[]) => deleteModelMock(...args),
    updateModel: (...args: any[]) => updateModelMock(...args)
  })
}))

vi.mock('@renderer/components/Tags/Model', () => ({
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

vi.mock('@renderer/components/Icons/CopyIcon', () => ({
  default: () => <span>copy-icon</span>
}))

vi.mock('../../shared/primitives/ProviderSettingsDrawer', () => ({
  default: ({ open, title, children, footer }: any) =>
    open ? (
      <div data-testid="provider-settings-drawer" className="provider-settings-default-scope">
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
    ;(window as any).toast = {
      success: vi.fn(),
      error: vi.fn()
    }
    ;(window as any).modal = { confirm: vi.fn() }

    useModelsMock.mockReturnValue({ models: [] })
  })

  it('renders the legacy add drawer without the inner panel shell and submits through the local drawer form', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })

    render(<AddModelDrawer providerId="openai" open prefill={null} onClose={vi.fn()} />)

    expect(screen.getByTestId('provider-settings-drawer')).toBeInTheDocument()
    expect(
      screen.getByTestId('provider-settings-model-add-drawer-content').closest('.provider-settings-default-scope')
    ).not.toBeNull()
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
    fireEvent.submit(screen.getByTestId('provider-settings-model-add-drawer-content'))

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

  it('renders the new-api add drawer with the shared select surface and keeps endpoint type in create payload', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'new-api', name: 'New API' }
    })

    render(<AddModelDrawer providerId="new-api" open prefill={null} onClose={vi.fn()} />)

    expect(screen.getByTestId('provider-settings-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('provider-settings-model-endpoint-type-field')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('settings.models.add.model_id.label'), {
      target: { value: 'claude-4-sonnet' }
    })
    fireEvent.submit(screen.getByTestId('provider-settings-model-add-drawer-content'))

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'new-api',
        modelId: 'claude-4-sonnet',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      })
    )
  })

  it('loads edit values, expands more settings, and keeps save plus auto-save on the existing mutation path', async () => {
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
    expect(
      screen.getByTestId('provider-settings-model-edit-drawer-content').closest('.provider-settings-default-scope')
    ).not.toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /settings\.moresetting\.label/i }))
    })
    expect(screen.getByTestId('provider-settings-model-more-settings')).toBeInTheDocument()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('models.price.input'), {
        target: { value: '12.5' }
      })
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
      fireEvent.change(screen.getByLabelText('settings.models.add.model_name.label'), {
        target: { value: 'Claude 4 Sonnet Updated' }
      })
    })
    const callsBeforeSave = updateModelMock.mock.calls.length
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /common\.save/i }))
    })

    expect(updateModelMock.mock.calls.length).toBeGreaterThan(callsBeforeSave)
  })

  it('writes cherryin endpoint type back through the edit drawer save path', async () => {
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
      fireEvent.click(screen.getByRole('button', { name: /common\.save/i }))
    })

    expect(updateModelMock).toHaveBeenCalledWith(
      'cherryin',
      'claude-4-sonnet',
      expect.objectContaining({
        endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
      })
    )
  })

  it('shows delete only for disabled models and deletes after confirmation', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', name: 'OpenAI' }
    })

    const onClose = vi.fn()

    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={onClose}
        model={
          {
            id: 'openai::claude-4-sonnet',
            providerId: 'openai',
            name: 'claude-4-sonnet',
            group: 'Anthropic',
            capabilities: [],
            isEnabled: false,
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /common\.delete/i }))

    expect(window.modal.confirm).toHaveBeenCalledTimes(1)
    const options = (window.modal.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(options.okButtonProps).toEqual({ danger: true })

    await options.onOk()

    expect(deleteModelMock).toHaveBeenCalledWith('openai', 'claude-4-sonnet')
    expect(window.toast.success).toHaveBeenCalledWith('common.delete_success')
    expect(onClose).toHaveBeenCalled()
  })

  it('does not show delete action for enabled models', () => {
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
            isEnabled: true,
            supportsStreaming: true,
            pricing: {
              input: { perMillionTokens: 0, currency: 'USD' },
              output: { perMillionTokens: 0, currency: 'USD' }
            }
          } as any
        }
      />
    )

    expect(screen.queryByRole('button', { name: /common\.delete/i })).not.toBeInTheDocument()
  })
})
