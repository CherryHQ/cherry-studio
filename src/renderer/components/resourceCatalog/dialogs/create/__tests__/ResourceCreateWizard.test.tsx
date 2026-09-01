import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactHookForm from 'react-hook-form'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentType } from '@shared/data/types/agent'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const modelHook = vi.hoisted(() => ({
  defaultModel: undefined as Model | undefined,
  defaultProvider: { id: 'provider', name: 'Provider', isEnabled: true } as Provider | undefined,
  useDefaultModel: vi.fn(),
  agentModelFilter: vi.fn<(agentType: AgentType | undefined, model: Model, provider?: Provider) => boolean>(() => true)
}))

function makeModel(id: UniqueModelId = 'provider::default'): Model {
  return {
    id,
    providerId: 'provider',
    apiModelId: id.split('::')[1],
    name: 'Default model',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: (options?: { enabled?: boolean }) => {
    modelHook.useDefaultModel(options)
    return { defaultModel: modelHook.defaultModel }
  }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderById: () => ({ provider: modelHook.defaultProvider })
}))

vi.mock('@renderer/hooks/agent/useAgentModelFilter', () => ({
  useAgentModelFilter: (agentType: AgentType | undefined) => (model: Model, provider?: Provider) =>
    modelHook.agentModelFilter(agentType, model, provider)
}))

// Mock the step bodies so the wizard shell (navigation, validation gate, submit
// mapping) is exercised in isolation. BasicInfoStep fills the fields that gate
// the Next button; SystemPromptStep fills the prompt.
vi.mock('../steps/BasicInfoStep', async () => {
  const { useWatch } = await vi.importActual<typeof ReactHookForm>('react-hook-form')

  return {
    BasicInfoStep: ({
      form
    }: {
      form: {
        control: ReactHookForm.Control<{ modelId: string | null; name: string }>
        setValue: (name: string, value: unknown) => void
      }
    }) => {
      const modelId = useWatch({ control: form.control, name: 'modelId' })
      const name = useWatch({ control: form.control, name: 'name' })

      return (
        <>
          <div data-testid="model-id">{modelId ?? 'empty'}</div>
          <div data-testid="name">{name || 'empty'}</div>
          <button type="button" onClick={() => form.setValue('name', 'My Resource')}>
            fill name
          </button>
          <button
            type="button"
            onClick={() => {
              form.setValue('name', 'My Resource')
              form.setValue('modelId', 'provider::model')
            }}>
            fill basic
          </button>
          <button
            type="button"
            onClick={() => {
              form.setValue('agentType', 'pi')
              form.setValue('name', 'My Resource')
              form.setValue('modelId', 'provider::model')
            }}>
            fill pi basic
          </button>
          <button
            type="button"
            onClick={() => {
              form.setValue('agentType', 'pi')
              form.setValue('modelId', null)
            }}>
            switch to pi
          </button>
          <button
            type="button"
            onClick={() => {
              form.setValue('agentType', 'dsh')
              form.setValue('modelId', null)
            }}>
            switch to dsh
          </button>
        </>
      )
    }
  }
})
vi.mock('../steps/SystemPromptStep', () => ({
  SystemPromptStep: ({ form }: { form: { setValue: (name: string, value: unknown) => void } }) => (
    <button type="button" onClick={() => form.setValue('prompt', 'be helpful')}>
      fill system prompt
    </button>
  )
}))
vi.mock('../steps/KnowledgeStep', () => ({
  KnowledgeStep: () => <div data-testid="knowledge-step" />
}))
vi.mock('../steps/CapabilityStep', () => ({
  CapabilityStep: () => <div data-testid="capability-step" />
}))

import { ResourceCreateWizard } from '../ResourceCreateWizard'

const NEXT = 'library.config.dialogs.create.next'
const CREATE = 'library.config.dialogs.create.submit'
const CANCEL = 'common.cancel'

afterEach(() => {
  cleanup()
  modelHook.defaultModel = undefined
  modelHook.defaultProvider = { id: 'provider', name: 'Provider', isEnabled: true } as Provider
  modelHook.useDefaultModel.mockReset()
  modelHook.agentModelFilter.mockReset()
  modelHook.agentModelFilter.mockReturnValue(true)
})

describe('ResourceCreateWizard', () => {
  it.each(['assistant', 'agent'] as const)('labels the shared authoring step as System Prompt for %s', (kind) => {
    render(<ResourceCreateWizard kind={kind} open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)

    expect(screen.getByText('library.config.prompt.label')).toBeInTheDocument()
    expect(screen.queryByText('library.config.dialogs.create.step.persona')).not.toBeInTheDocument()
  })

  it('does not activate the default-model query while closed', () => {
    render(<ResourceCreateWizard kind="assistant" open={false} onOpenChange={vi.fn()} onSubmit={vi.fn()} />)

    expect(modelHook.useDefaultModel).toHaveBeenCalledWith({ enabled: false })
  })

  it('prefills the model from the default model when the wizard opens', async () => {
    modelHook.defaultModel = makeModel()

    render(<ResourceCreateWizard kind="assistant" open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)

    expect(await screen.findByTestId('model-id')).toHaveTextContent('provider::default')
  })

  it('does not prefill a disabled default model', async () => {
    modelHook.defaultModel = { ...makeModel(), isEnabled: false }

    render(<ResourceCreateWizard kind="assistant" open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)

    expect(await screen.findByTestId('model-id')).toHaveTextContent('empty')
  })

  it('submits the default model when the user does not choose another model', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    modelHook.defaultModel = makeModel()
    render(<ResourceCreateWizard kind="assistant" open onOpenChange={vi.fn()} onSubmit={onSubmit} />)

    expect(await screen.findByTestId('model-id')).toHaveTextContent('provider::default')
    await user.click(screen.getByRole('button', { name: 'fill name' }))
    expect(screen.getByRole('button', { name: NEXT })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: CREATE }))

    expect(onSubmit).toHaveBeenCalledWith({
      avatar: '💬',
      name: 'My Resource',
      agentType: 'claude-code',
      permissionMode: 'auto',
      modelId: 'provider::default',
      description: '',
      prompt: '',
      knowledgeBaseIds: [],
      skillIds: []
    })
  })

  it('seeds the name from initialName so a caller-supplied name clears the first step', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    modelHook.defaultModel = makeModel()

    render(
      <ResourceCreateWizard kind="assistant" open onOpenChange={vi.fn()} onSubmit={onSubmit} initialName="测试助手" />
    )

    expect(await screen.findByTestId('name')).toHaveTextContent('测试助手')
    // Name + default model are both set, so the first step is already cleared.
    expect(screen.getByRole('button', { name: NEXT })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: CREATE }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: '测试助手' }))
  })

  it('does not prefill a default model rejected by the wizard model filter', async () => {
    modelHook.defaultModel = makeModel()

    render(
      <ResourceCreateWizard kind="assistant" open onOpenChange={vi.fn()} onSubmit={vi.fn()} modelFilter={() => false} />
    )

    expect(await screen.findByTestId('model-id')).toHaveTextContent('empty')
  })

  it('removes an auto-selected default model if the model filter later excludes it', async () => {
    const user = userEvent.setup()
    modelHook.defaultModel = makeModel()
    let defaultModelAllowed = true
    modelHook.agentModelFilter.mockImplementation(() => defaultModelAllowed)
    const props = {
      kind: 'agent' as const,
      open: true,
      onOpenChange: vi.fn(),
      onSubmit: vi.fn()
    }
    const { rerender } = render(<ResourceCreateWizard {...props} />)

    expect(await screen.findByTestId('model-id')).toHaveTextContent('provider::default')
    await user.click(screen.getByRole('button', { name: 'fill name' }))
    expect(screen.getByRole('button', { name: NEXT })).toBeEnabled()

    defaultModelAllowed = false
    rerender(<ResourceCreateWizard {...props} />)

    expect(await screen.findByTestId('model-id')).toHaveTextContent('empty')
    expect(screen.getByRole('button', { name: NEXT })).toBeDisabled()
  })

  it('gates Next on a valid name + model, then walks assistant steps to a mapped submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ResourceCreateWizard kind="assistant" open onOpenChange={vi.fn()} onSubmit={onSubmit} />)

    // Step 1: Next is blocked until name + model are set.
    expect(screen.getByRole('button', { name: NEXT })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    expect(screen.getByRole('button', { name: NEXT })).toBeEnabled()

    // Step 1 → 2 (System Prompt)
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: 'fill system prompt' }))

    // Step 2 → 3 (assistant: knowledge)
    await user.click(screen.getByRole('button', { name: NEXT }))
    expect(screen.getByTestId('knowledge-step')).toBeInTheDocument()

    // Final create → mapped payload
    await user.click(screen.getByRole('button', { name: CREATE }))
    expect(onSubmit).toHaveBeenCalledWith({
      avatar: '💬',
      name: 'My Resource',
      agentType: 'claude-code',
      permissionMode: 'auto',
      modelId: 'provider::model',
      description: '',
      prompt: 'be helpful',
      knowledgeBaseIds: [],
      skillIds: []
    })
  })

  it('surfaces the actionable submit error and leaves the dialog closable after failure', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn().mockRejectedValue(new Error('Selected skill no longer exists'))

    render(<ResourceCreateWizard kind="assistant" open onOpenChange={onOpenChange} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: CREATE }))

    expect(await screen.findByText('Selected skill no longer exists')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'library.config.dialogs.create.assistant_title' })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: CANCEL }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows the knowledge step after capability for the agent kind', async () => {
    const user = userEvent.setup()
    render(<ResourceCreateWizard kind="agent" open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))

    expect(screen.getByTestId('capability-step')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-step')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: NEXT }))

    expect(screen.getByTestId('knowledge-step')).toBeInTheDocument()
    expect(screen.queryByTestId('capability-step')).not.toBeInTheDocument()
  })

  it('does not render an invalid step when a closed agent wizard falls back to assistant kind', async () => {
    const user = userEvent.setup()
    const props = { open: true, onOpenChange: vi.fn(), onSubmit: vi.fn() }
    const { rerender } = render(<ResourceCreateWizard {...props} kind="agent" />)

    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    expect(screen.getByTestId('knowledge-step')).toBeInTheDocument()

    expect(() => rerender(<ResourceCreateWizard {...props} kind="assistant" open={false} />)).not.toThrow()
  })

  it('shows capability and knowledge steps for pi agents', async () => {
    const user = userEvent.setup()
    render(<ResourceCreateWizard kind="agent" open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'fill pi basic' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))

    expect(screen.getByTestId('capability-step')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-step')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: NEXT }))

    expect(screen.getByTestId('knowledge-step')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: CREATE })).toBeInTheDocument()
  })

  it('does not prefill the default model for agent kind when rejected by the model filter', async () => {
    modelHook.defaultModel = makeModel()
    modelHook.agentModelFilter.mockReturnValue(false)

    render(<ResourceCreateWizard kind="agent" open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)

    expect(await screen.findByTestId('model-id')).toHaveTextContent('empty')
  })

  it('prefills the default model for agent kind when accepted by the model filter', async () => {
    modelHook.defaultModel = makeModel()

    render(<ResourceCreateWizard kind="agent" open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)

    expect(await screen.findByTestId('model-id')).toHaveTextContent('provider::default')
  })

  it('does not prefill a default model when its provider is disabled', async () => {
    modelHook.defaultModel = makeModel()
    modelHook.defaultProvider = { id: 'provider', name: 'Provider', isEnabled: false } as Provider

    render(<ResourceCreateWizard kind="agent" open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)

    expect(await screen.findByTestId('model-id')).toHaveTextContent('empty')
  })

  it.each(['pi', 'dsh'] as const)(
    'reselects a compatible default model after switching an agent to the %s runtime',
    async (agentType) => {
      const user = userEvent.setup()
      modelHook.defaultModel = makeModel()
      modelHook.defaultProvider = { id: 'provider', name: 'Provider', isEnabled: true } as Provider
      modelHook.agentModelFilter.mockImplementation(
        (agentType, _model, provider) => agentType === 'claude-code' || Boolean(provider)
      )

      render(<ResourceCreateWizard kind="agent" open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)

      expect(await screen.findByTestId('model-id')).toHaveTextContent('provider::default')
      await user.click(screen.getByRole('button', { name: `switch to ${agentType}` }))

      await waitFor(() => expect(screen.getByTestId('model-id')).toHaveTextContent('provider::default'))
    }
  )
})
