import { act, cleanup, fireEvent, render, type RenderResult, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity, type ComponentProps, useState } from 'react'
import type * as ReactHookForm from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentType } from '@shared/data/types/agent'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { ResourceCreateWizardFormValues, ResourceCreateWizardKind } from '../types'

const autoConfigure = vi.hoisted(() => ({
  ready: true,
  generate: vi.fn<(input: { purpose: string; name: string; signal: AbortSignal }) => Promise<unknown>>()
}))

const modelHook = vi.hoisted(() => ({
  defaultModel: undefined as Model | undefined,
  defaultProvider: { id: 'provider', name: 'Provider', isEnabled: true } as Provider | undefined,
  agentModelFilter: vi.fn<(agentType: AgentType | undefined, model: Model, provider?: Provider) => boolean>(() => true),
  unavailableModelIds: new Set<string>()
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

// Interpolated values are appended so assertions can read them (`key:1/2`).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === 'object' ? `${key}:${Object.values(options).join('/')}` : key
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ defaultModel: modelHook.defaultModel, isDefaultModelLoading: false }),
  useModels: () => ({ models: modelHook.defaultModel?.isEnabled ? [modelHook.defaultModel] : [] }),
  useModelById: (id: string | null) => ({ model: id === 'provider::model' ? { name: 'Picked model' } : undefined })
}))

// Installed catalogs the result page resolves names from.
vi.mock('@renderer/hooks/useSkills', () => ({
  useInstalledSkills: () => ({
    skills: [
      { id: 'skill-builtin', name: 'Builtin skill', source: 'builtin' },
      { id: 'skill-review', name: 'Review skill', source: 'local' },
      { id: 'skill-unused', name: 'Unused skill', source: 'local' }
    ]
  })
}))
vi.mock('@renderer/hooks/useKnowledgeBase', () => ({
  useKnowledgeBases: () => ({ bases: [{ id: 'kb-docs', name: 'Docs' }] })
}))
vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ mcpServers: [{ id: 'mcp-github', name: 'GitHub' }] })
}))
vi.mock('../../edit', () => ({
  ResourceEditDialogHost: ({ target }: { target: { kind: string; id: string } }) => (
    <div data-testid="edit-host">{`${target.kind}:${target.id}`}</div>
  )
}))

vi.mock('@renderer/hooks/useCherryCloudModelAvailability', () => ({
  useCherryCloudModelAvailability: () => ({
    isModelHidden: () => false,
    isModelUnavailable: (model: Model) => modelHook.unavailableModelIds.has(model.id),
    getModelDescription: () => undefined
  })
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
vi.mock('../steps/BasicInfoStep', () => ({ BasicInfoStep: StepHarness }))
// The entry shares the basic step's fields (one form), so it gets the same harness.
vi.mock('../steps/AutoCreateEntry', () => ({ AutoCreateEntry: StepHarness }))
vi.mock('@renderer/hooks/resourceCatalog', () => ({
  useResourceAutoConfigure: () => ({ ready: autoConfigure.ready, generate: autoConfigure.generate })
}))
vi.mock('../steps/SystemPromptStep', () => ({
  SystemPromptStep: ({ form }: { form: ReactHookForm.UseFormReturn<ResourceCreateWizardFormValues> }) => (
    <>
      <textarea aria-label="draft prompt" {...form.register('prompt')} />
      <button type="button" onClick={() => form.setValue('prompt', 'be helpful')}>
        fill system prompt
      </button>
    </>
  )
}))
vi.mock('../steps/KnowledgeStep', () => ({
  KnowledgeStep: ({ form }: { form: ReactHookForm.UseFormReturn<ResourceCreateWizardFormValues> }) => (
    <div data-testid="knowledge-step">
      <DraftValues form={form} />
      <button type="button" onClick={() => form.setValue('knowledgeBaseIds', ['knowledge-draft'])}>
        select knowledge base
      </button>
    </div>
  )
}))
vi.mock('../steps/CapabilityStep', () => ({
  CapabilityStep: () => <div data-testid="capability-step" />
}))

import { ResourceCreateWizard } from '../ResourceCreateWizard'

const NEXT = 'library.config.dialogs.create.next'
const CREATE = 'library.config.dialogs.create.submit'
const CANCEL = 'common.cancel'
const MANUAL = 'library.config.dialogs.create.auto.manual'
const AUTO = 'library.config.dialogs.create.auto.submit'
const START = 'library.config.dialogs.create.result.start'
const ADJUST = 'library.config.dialogs.create.result.adjust'
const PROMPT_ROW = 'library.config.prompt.label'
const PERMISSION_ROW = 'library.config.agent.section.permission.title'
const TOOLS_ROW = 'library.config.agent.section.tools.tab.tools'
const SKILLS_ROW = 'library.config.agent.section.tools.tab.skills'
const MCP_ROW = 'library.config.agent.section.tools.tab.mcp'
const KNOWLEDGE_ROW = 'library.config.dialogs.create.step.knowledge'

/** The value cell of a result-page summary row. */
const summaryValue = (label: string) => screen.getByText(label).nextElementSibling

/** The dialog's own X button (its sr-only label is not exposed in jsdom). */
const dialogCloseButton = () => document.querySelector<HTMLElement>('[data-slot="dialog-close"]')!

const BASIC = /library\.config\.dialogs\.create\.step\.basic$/
const KNOWLEDGE = /library\.config\.dialogs\.create\.step\.knowledge$/
const onSubmitSpy = vi.fn()
const draft = {
  name: '  Activity draft  ',
  description: '  Description preserved across tabs  ',
  prompt: `  DRAFT_START
${'Keep every instruction across tab switches.\n'.repeat(40)}DRAFT_END  `
}

function StepHarness({ form }: { form: ReactHookForm.UseFormReturn<ResourceCreateWizardFormValues> }) {
  const modelId = useWatch({ control: form.control, name: 'modelId' })
  const name = useWatch({ control: form.control, name: 'name' })

  return (
    <>
      <div data-testid="model-id">{modelId ?? 'empty'}</div>
      <div data-testid="name">{name || 'empty'}</div>
      <DraftValues form={form} />
      <input aria-label="draft name" {...form.register('name')} />
      <input aria-label="draft description" {...form.register('description')} />
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
      <button type="button" onClick={() => form.setValue('modelId', 'provider::model')}>
        fill model
      </button>
      <button type="button" onClick={() => form.setValue('avatar', '🦊')}>
        pick avatar
      </button>
      {(['pi', 'claude-code'] as const).map((runtime) => (
        <button
          key={runtime}
          type="button"
          onClick={() => {
            form.setValue('agentType', runtime)
            form.setValue('modelId', null)
          }}>
          switch to {runtime}
        </button>
      ))}
      <button type="button" onClick={() => form.setValue('permissionMode', 'plan')}>
        use plan mode
      </button>
    </>
  )
}

function DraftValues({ form }: { form: ReactHookForm.UseFormReturn<ResourceCreateWizardFormValues> }) {
  const [name, description, prompt, knowledgeBaseIds, agentType, permissionMode, avatar] = useWatch({
    control: form.control,
    name: ['name', 'description', 'prompt', 'knowledgeBaseIds', 'agentType', 'permissionMode', 'avatar']
  })
  return (
    <>
      <div data-testid="draft-avatar">{avatar}</div>
      <div data-testid="draft-name">{name}</div>
      <div data-testid="draft-description">{description}</div>
      <div data-testid="draft-prompt">{prompt}</div>
      <div data-testid="knowledge-ids">{JSON.stringify(knowledgeBaseIds)}</div>
      <div data-testid="knowledge-count">{knowledgeBaseIds.length}</div>
      <div data-testid="agent-type">{agentType}</div>
      <div data-testid="permission-mode">{permissionMode}</div>
    </>
  )
}

function ActivityHost({
  visible,
  kind,
  initialName
}: {
  visible: boolean
  kind: ResourceCreateWizardKind
  initialName?: string
}) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        reopen wizard
      </button>
      <Activity mode={visible ? 'visible' : 'hidden'}>
        <div aria-label="wizard-activity">
          <ResourceCreateWizard
            kind={kind}
            open={open}
            onOpenChange={setOpen}
            onStartConversation={vi.fn()}
            onSubmit={onSubmitSpy}
            initialName={initialName}
          />
        </div>
      </Activity>
    </>
  )
}

async function hideAndShow(
  rerender: RenderResult['rerender'],
  props: { kind: ResourceCreateWizardKind; initialName?: string }
) {
  await act(async () => rerender(<ActivityHost {...props} visible={false} />))
  await waitFor(() => expect(screen.getByLabelText('wizard-activity')).not.toBeVisible())
  await act(async () => rerender(<ActivityHost {...props} visible />))
  await waitFor(() => expect(screen.getByLabelText('wizard-activity')).toBeVisible())
}

async function fillDraftToKnowledge(user: ReturnType<typeof userEvent.setup>, kind: ResourceCreateWizardKind) {
  await user.clear(screen.getByRole('textbox', { name: 'draft name' }))
  await user.type(screen.getByRole('textbox', { name: 'draft name' }), draft.name)
  await user.type(screen.getByRole('textbox', { name: 'draft description' }), draft.description)
  await user.click(screen.getByRole('button', { name: MANUAL }))
  await user.click(screen.getByRole('button', { name: NEXT }))
  // Manual create prefills an Agent's empty prompt with the purpose; replace it with the draft.
  await user.clear(screen.getByRole('textbox', { name: 'draft prompt' }))
  await user.paste(draft.prompt)
  await user.click(screen.getByRole('button', { name: NEXT }))
  if (kind === 'agent') {
    expect(screen.getByTestId('capability-step')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: NEXT }))
  }
  await user.click(screen.getByRole('button', { name: 'select knowledge base' }))
}

function expectDraft() {
  expect(screen.getByRole('button', { name: KNOWLEDGE })).toHaveAttribute('aria-current', 'step')
  expect(screen.getByTestId('draft-name').textContent).toBe(draft.name)
  expect(screen.getByTestId('draft-description').textContent).toBe(draft.description)
  expect(screen.getByTestId('draft-prompt').textContent).toBe(draft.prompt)
  expect(screen.getByTestId('knowledge-ids').textContent).toBe('["knowledge-draft"]')
  expect(screen.getByTestId('knowledge-count')).toHaveTextContent('1')
}

function expectDefaults(kind: ResourceCreateWizardKind, name = '') {
  expect(screen.getByRole('button', { name: MANUAL })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: BASIC })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'draft name' })).toHaveValue(name)
  expect(screen.getByRole('textbox', { name: 'draft description' })).toHaveValue('')
  expect(screen.getByTestId('draft-prompt')).toBeEmptyDOMElement()
  expect(screen.getByTestId('knowledge-ids').textContent).toBe('[]')
  expect(screen.getByTestId('knowledge-count')).toHaveTextContent('0')
  expect(screen.getByTestId('agent-type')).toHaveTextContent(kind === 'agent' ? 'pi-durable' : 'claude-code')
  expect(screen.getByTestId('permission-mode')).toHaveTextContent('auto')
}

afterEach(() => {
  cleanup()
  onSubmitSpy.mockReset()
  modelHook.defaultModel = undefined
  modelHook.defaultProvider = { id: 'provider', name: 'Provider', isEnabled: true } as Provider
  modelHook.agentModelFilter.mockReset()
  modelHook.agentModelFilter.mockReturnValue(true)
  modelHook.unavailableModelIds.clear()
  autoConfigure.ready = true
  autoConfigure.generate.mockReset()
})

describe('ResourceCreateWizard', () => {
  it('keeps a catalog prompt and default agent settings when creating from template metadata', async () => {
    const user = userEvent.setup()
    modelHook.defaultModel = makeModel()
    const onSubmit = vi.fn()
    render(
      <ResourceCreateWizard
        kind="agent"
        open
        onOpenChange={vi.fn()}
        onStartConversation={vi.fn()}
        onSubmit={onSubmit}
        initialValues={{
          name: 'Product manager',
          avatar: '👨‍💼',
          description: 'Plan products',
          prompt: 'Keep this prompt\n{{language}}'
        }}
      />
    )
    await waitFor(() => expect(screen.getByRole('button', { name: NEXT })).toBeEnabled())
    for (let step = 0; step < 3; step++) await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: CREATE }))
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Product manager',
      avatar: '👨‍💼',
      description: 'Plan products',
      prompt: 'Keep this prompt\n{{language}}',
      agentType: 'pi-durable',
      permissionMode: 'auto',
      modelId: 'provider::default',
      skillIds: [],
      knowledgeBaseIds: [],
      mcpServerIds: [],
      enableWebSearch: false
    })
  })

  it.each(['assistant', 'agent'] as const)(
    'keeps the draft and the current step after <Activity> hide/show (%s kind)',
    async (kind) => {
      const user = userEvent.setup()
      modelHook.defaultModel = makeModel()
      const { rerender } = render(<ActivityHost kind={kind} visible />)
      await fillDraftToKnowledge(user, kind)
      expectDraft()

      await hideAndShow(rerender, { kind })

      expectDraft()
      await user.click(screen.getByRole('button', { name: CREATE }))
      expect(onSubmitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Activity draft',
          description: 'Description preserved across tabs',
          prompt: draft.prompt.trim(),
          knowledgeBaseIds: ['knowledge-draft']
        })
      )
    }
  )

  it.each(['assistant', 'agent'] as const)(
    'reinitialises the wizard on a committed close and reopen of the same instance (%s kind)',
    async (kind) => {
      const user = userEvent.setup()
      modelHook.defaultModel = makeModel()
      const { rerender } = render(<ActivityHost kind={kind} visible />)
      if (kind === 'agent') {
        await user.click(screen.getByRole('button', { name: 'switch to claude-code' }))
        await user.click(screen.getByRole('button', { name: 'use plan mode' }))
      }
      await fillDraftToKnowledge(user, kind)
      await hideAndShow(rerender, { kind })
      expectDraft()

      await user.click(screen.getByRole('button', { name: CANCEL }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'reopen wizard' }))

      expectDefaults(kind)
    }
  )

  it.each(['assistant', 'agent'] as const)(
    "resets to the new kind's defaults when the resource kind changes while open (%s kind)",
    async (kind) => {
      const user = userEvent.setup()
      modelHook.defaultModel = makeModel()
      const { rerender } = render(<ActivityHost kind={kind} visible />)
      await fillDraftToKnowledge(user, kind)
      expectDraft()
      const nextKind = kind === 'agent' ? 'assistant' : 'agent'

      rerender(<ActivityHost kind={nextKind} visible />)

      expectDefaults(nextKind)
    }
  )

  it('keeps the draft when initialName changes while open and uses the newest seed on the next open', async () => {
    const user = userEvent.setup()
    modelHook.defaultModel = makeModel()
    const { rerender } = render(<ActivityHost kind="assistant" initialName="First seed" visible />)
    expectDefaults('assistant', 'First seed')
    await fillDraftToKnowledge(user, 'assistant')
    await hideAndShow(rerender, { kind: 'assistant', initialName: 'First seed' })
    expectDraft()

    rerender(<ActivityHost kind="assistant" initialName="Newest seed" visible />)

    expectDraft()
    await user.click(screen.getByRole('button', { name: CANCEL }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'reopen wizard' }))
    expectDefaults('assistant', 'Newest seed')
  })

  it('prefills the model from the default model when the wizard opens', async () => {
    modelHook.defaultModel = makeModel()

    render(
      <ResourceCreateWizard
        kind="assistant"
        open
        onOpenChange={vi.fn()}
        onStartConversation={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    expect(await screen.findByTestId('model-id')).toHaveTextContent('provider::default')
  })

  it('does not prefill a disabled default model', async () => {
    modelHook.defaultModel = { ...makeModel(), isEnabled: false }

    render(
      <ResourceCreateWizard
        kind="assistant"
        open
        onOpenChange={vi.fn()}
        onStartConversation={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    expect(await screen.findByTestId('model-id')).toHaveTextContent('empty')
  })

  it('submits the default model when the user does not choose another model', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    modelHook.defaultModel = makeModel()
    render(
      <ResourceCreateWizard
        kind="assistant"
        open
        onOpenChange={vi.fn()}
        onStartConversation={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    expect(await screen.findByTestId('model-id')).toHaveTextContent('provider::default')
    await user.click(screen.getByRole('button', { name: 'fill name' }))
    await user.click(screen.getByRole('button', { name: MANUAL }))
    expect(screen.getByRole('button', { name: NEXT })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: CREATE }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Resource', modelId: 'provider::default' })
    )
  })

  it('seeds the name from initialName so a caller-supplied name clears the first step', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    modelHook.defaultModel = makeModel()

    render(
      <ResourceCreateWizard
        kind="assistant"
        open
        onOpenChange={vi.fn()}
        onStartConversation={vi.fn()}
        onSubmit={onSubmit}
        initialName="测试助手"
      />
    )

    expect(await screen.findByTestId('name')).toHaveTextContent('测试助手')
    // Name + default model are both set, so the first step is already cleared.
    await user.click(screen.getByRole('button', { name: MANUAL }))
    expect(screen.getByRole('button', { name: NEXT })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: CREATE }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: '测试助手' }))
  })

  it('does not prefill a default model rejected by the wizard model filter', async () => {
    modelHook.defaultModel = makeModel()

    render(
      <ResourceCreateWizard
        kind="assistant"
        open
        onOpenChange={vi.fn()}
        onStartConversation={vi.fn()}
        onSubmit={vi.fn()}
        modelFilter={() => false}
      />
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
      onSubmit: vi.fn(),
      onStartConversation: vi.fn()
    }
    const { rerender } = render(<ResourceCreateWizard {...props} />)

    expect(await screen.findByTestId('model-id')).toHaveTextContent('provider::default')
    await user.click(screen.getByRole('button', { name: 'fill name' }))
    await user.click(screen.getByRole('button', { name: MANUAL }))
    expect(screen.getByRole('button', { name: NEXT })).toBeEnabled()

    defaultModelAllowed = false
    rerender(<ResourceCreateWizard {...props} />)

    expect(await screen.findByTestId('model-id')).toHaveTextContent('empty')
    expect(screen.getByRole('button', { name: NEXT })).toBeDisabled()
  })

  it('does not prefill, and retracts, a default model the selector would not offer', async () => {
    modelHook.defaultModel = makeModel()
    modelHook.unavailableModelIds.add(modelHook.defaultModel.id)
    const props = {
      kind: 'agent' as const,
      open: true,
      onOpenChange: vi.fn(),
      onSubmit: vi.fn(),
      onStartConversation: vi.fn()
    }
    const { rerender } = render(<ResourceCreateWizard {...props} />)

    expect(await screen.findByTestId('model-id')).toHaveTextContent('empty')

    modelHook.unavailableModelIds.clear()
    rerender(<ResourceCreateWizard {...props} />)
    expect(await screen.findByTestId('model-id')).toHaveTextContent('provider::default')

    modelHook.unavailableModelIds.add(modelHook.defaultModel.id)
    rerender(<ResourceCreateWizard {...props} />)
    expect(await screen.findByTestId('model-id')).toHaveTextContent('empty')
  })

  it('gates Next on a valid name + model, then walks assistant steps to a mapped submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <ResourceCreateWizard
        kind="assistant"
        open
        onOpenChange={vi.fn()}
        onStartConversation={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    // Step 1: Next is blocked until name + model are set.
    await user.click(screen.getByRole('button', { name: MANUAL }))
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
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Resource', modelId: 'provider::model', prompt: 'be helpful' })
    )
  })

  it('surfaces the actionable submit error and leaves the dialog closable after failure', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn().mockRejectedValue(new Error('Selected skill no longer exists'))

    render(
      <ResourceCreateWizard
        kind="assistant"
        open
        onOpenChange={onOpenChange}
        onStartConversation={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: MANUAL }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: CREATE }))

    expect(await screen.findByText('Selected skill no longer exists')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'library.config.dialogs.create.assistant_title' })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: CANCEL }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it.each(['pi-durable', 'pi', 'claude-code'] as const)('submits the selected %s agent runtime', async (runtime) => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <ResourceCreateWizard
        kind="agent"
        open
        onOpenChange={vi.fn()}
        onStartConversation={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    if (runtime !== 'pi-durable') {
      await user.click(screen.getByRole('button', { name: `switch to ${runtime}` }))
    }
    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: MANUAL }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: CREATE }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ agentType: runtime, permissionMode: 'auto' }))
  })

  it('restores Pi Durable and its permission default after canceling and reopening', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onOpenChange = vi.fn()
    const props = { kind: 'agent' as const, onOpenChange, onSubmit, onStartConversation: vi.fn() }
    const view = render(<ResourceCreateWizard {...props} open />)

    await user.click(screen.getByRole('button', { name: 'switch to claude-code' }))
    await user.click(screen.getByRole('button', { name: 'use plan mode' }))
    fireEvent.click(dialogCloseButton())
    expect(onOpenChange).toHaveBeenCalledWith(false)
    view.rerender(<ResourceCreateWizard {...props} open={false} />)
    view.rerender(<ResourceCreateWizard {...props} open />)

    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: MANUAL }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: CREATE }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ agentType: 'pi-durable', permissionMode: 'auto' }))
  })

  it('does not render an invalid step when a closed agent wizard falls back to assistant kind', async () => {
    const user = userEvent.setup()
    const props = { open: true, onOpenChange: vi.fn(), onSubmit: vi.fn(), onStartConversation: vi.fn() }
    const { rerender } = render(<ResourceCreateWizard {...props} kind="agent" />)

    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: MANUAL }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    expect(screen.getByTestId('knowledge-step')).toBeInTheDocument()

    expect(() => rerender(<ResourceCreateWizard {...props} kind="assistant" open={false} />)).not.toThrow()
  })

  it('does not prefill the default model for agent kind when rejected by the model filter', async () => {
    modelHook.defaultModel = makeModel()
    modelHook.agentModelFilter.mockReturnValue(false)

    render(
      <ResourceCreateWizard kind="agent" open onOpenChange={vi.fn()} onStartConversation={vi.fn()} onSubmit={vi.fn()} />
    )

    expect(await screen.findByTestId('model-id')).toHaveTextContent('empty')
  })

  it('prefills the default model for agent kind when accepted by the model filter', async () => {
    modelHook.defaultModel = makeModel()

    render(
      <ResourceCreateWizard kind="agent" open onOpenChange={vi.fn()} onStartConversation={vi.fn()} onSubmit={vi.fn()} />
    )

    expect(await screen.findByTestId('model-id')).toHaveTextContent('provider::default')
  })

  it('does not prefill a default model when its provider is disabled', async () => {
    modelHook.defaultModel = makeModel()
    modelHook.defaultProvider = { id: 'provider', name: 'Provider', isEnabled: false } as Provider

    render(
      <ResourceCreateWizard kind="agent" open onOpenChange={vi.fn()} onStartConversation={vi.fn()} onSubmit={vi.fn()} />
    )

    expect(await screen.findByTestId('model-id')).toHaveTextContent('empty')
  })

  it.each(['pi', 'claude-code'] as const)(
    'reselects a compatible default model after switching an agent to the %s runtime',
    async (agentType) => {
      const user = userEvent.setup()
      modelHook.defaultModel = makeModel()
      modelHook.defaultProvider = { id: 'provider', name: 'Provider', isEnabled: true } as Provider
      modelHook.agentModelFilter.mockImplementation(
        (agentType, _model, provider) => agentType === 'claude-code' || Boolean(provider)
      )

      render(
        <ResourceCreateWizard
          kind="agent"
          open
          onOpenChange={vi.fn()}
          onStartConversation={vi.fn()}
          onSubmit={vi.fn()}
        />
      )

      expect(await screen.findByTestId('model-id')).toHaveTextContent('provider::default')
      if (agentType === 'pi') {
        await user.click(screen.getByRole('button', { name: 'switch to claude-code' }))
      }
      await user.click(screen.getByRole('button', { name: `switch to ${agentType}` }))

      await waitFor(() => expect(screen.getByTestId('model-id')).toHaveTextContent('provider::default'))
    }
  )
})

describe('ResourceCreateWizard auto create', () => {
  const generated = {
    name: 'PR Reviewer',
    emoji: '🔍',
    description: 'Reviews pull requests',
    prompt: 'You review pull requests.',
    knowledgeBaseIds: ['kb-docs'],
    mcpServerIds: ['mcp-github'],
    skillIds: ['skill-review'],
    permissionMode: 'default',
    enableWebSearch: false
  }

  async function describePurpose(user: ReturnType<typeof userEvent.setup>, purpose = 'Review my GitHub PRs') {
    await user.type(screen.getByRole('textbox', { name: 'draft description' }), purpose)
  }

  beforeEach(() => {
    // Generation needs a default model; keeping it out of the selector leaves the model field to each test.
    modelHook.defaultModel = makeModel()
    modelHook.unavailableModelIds.add('provider::default')
  })

  it.each(['assistant', 'agent'] as const)(
    'opens on the entry and enables Auto create only once purpose and model are set (%s kind)',
    async (kind) => {
      const user = userEvent.setup()
      render(
        <ResourceCreateWizard
          kind={kind}
          open
          onOpenChange={vi.fn()}
          onStartConversation={vi.fn()}
          onSubmit={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: MANUAL })).toBeEnabled()
      expect(screen.queryByRole('button', { name: BASIC })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: AUTO })).toBeDisabled()

      await describePurpose(user)
      expect(screen.getByRole('button', { name: AUTO })).toBeDisabled()

      await user.click(screen.getByRole('button', { name: 'fill model' }))
      expect(screen.getByRole('button', { name: AUTO })).toBeEnabled()
    }
  )

  it.each([
    ['assistant', '💬'],
    ['agent', '✨']
  ] as const)('starts a new %s with the %s avatar', (kind, avatar) => {
    render(
      <ResourceCreateWizard kind={kind} open onOpenChange={vi.fn()} onStartConversation={vi.fn()} onSubmit={vi.fn()} />
    )

    expect(screen.getByTestId('draft-avatar')).toHaveTextContent(avatar)
  })

  it('keeps Auto create disabled until the installed catalogs have loaded', async () => {
    const user = userEvent.setup()
    autoConfigure.ready = false
    render(
      <ResourceCreateWizard kind="agent" open onOpenChange={vi.fn()} onStartConversation={vi.fn()} onSubmit={vi.fn()} />
    )

    await describePurpose(user)
    await user.click(screen.getByRole('button', { name: 'fill model' }))

    expect(screen.getByRole('button', { name: AUTO })).toBeDisabled()
  })

  it('carries avatar, name, model and purpose into the first manual step', async () => {
    const user = userEvent.setup()
    render(
      <ResourceCreateWizard kind="agent" open onOpenChange={vi.fn()} onStartConversation={vi.fn()} onSubmit={vi.fn()} />
    )

    await user.click(screen.getByRole('button', { name: 'pick avatar' }))
    await user.type(screen.getByRole('textbox', { name: 'draft name' }), 'Reviewer')
    await describePurpose(user)
    await user.click(screen.getByRole('button', { name: 'fill model' }))
    await user.click(screen.getByRole('button', { name: MANUAL }))

    expect(screen.getByRole('button', { name: BASIC })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByTestId('draft-avatar')).toHaveTextContent('🦊')
    expect(screen.getByRole('textbox', { name: 'draft name' })).toHaveValue('Reviewer')
    expect(screen.getByRole('textbox', { name: 'draft description' })).toHaveValue('Review my GitHub PRs')
    expect(screen.getByTestId('model-id')).toHaveTextContent('provider::model')
  })

  it.each([
    ['agent', 'Review my GitHub PRs'],
    ['assistant', '']
  ] as const)('prefills the %s prompt from the purpose on Manual create only for Agents', async (kind, prompt) => {
    const user = userEvent.setup()
    render(
      <ResourceCreateWizard kind={kind} open onOpenChange={vi.fn()} onStartConversation={vi.fn()} onSubmit={vi.fn()} />
    )

    await describePurpose(user)
    await user.click(screen.getByRole('button', { name: MANUAL }))

    expect(screen.getByTestId('draft-prompt').textContent).toBe(prompt)
  })

  it('creates an agent once with the generated configuration', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    autoConfigure.generate.mockResolvedValue(generated)
    render(
      <ResourceCreateWizard
        kind="agent"
        open
        onOpenChange={vi.fn()}
        onStartConversation={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    await describePurpose(user)
    await user.click(screen.getByRole('button', { name: 'fill model' }))
    await user.click(screen.getByRole('button', { name: AUTO }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(autoConfigure.generate.mock.calls[0][0]).toMatchObject({ purpose: 'Review my GitHub PRs', name: '' })
    expect(onSubmit).toHaveBeenCalledWith({
      avatar: '🔍',
      agentType: 'pi-durable',
      permissionMode: 'default',
      name: 'PR Reviewer',
      modelId: 'provider::model',
      description: 'Reviews pull requests',
      prompt: 'You review pull requests.',
      knowledgeBaseIds: ['kb-docs'],
      skillIds: ['skill-review'],
      mcpServerIds: ['mcp-github'],
      enableWebSearch: false
    })
  })

  it('keeps a name the user typed and an avatar they picked over the generated ones', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    autoConfigure.generate.mockResolvedValue(generated)
    render(
      <ResourceCreateWizard
        kind="assistant"
        open
        onOpenChange={vi.fn()}
        onStartConversation={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    await user.type(screen.getByRole('textbox', { name: 'draft name' }), 'My Reviewer')
    await user.click(screen.getByRole('button', { name: 'pick avatar' }))
    await describePurpose(user)
    await user.click(screen.getByRole('button', { name: 'fill model' }))
    await user.click(screen.getByRole('button', { name: AUTO }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Reviewer', avatar: '🦊' }))
  })

  it.each([
    [
      'an unusable reply',
      () => autoConfigure.generate.mockResolvedValue(null),
      'library.config.dialogs.create.auto.failed'
    ],
    [
      'a generation error',
      () => autoConfigure.generate.mockRejectedValue(new Error('Provider is down')),
      'Provider is down'
    ]
  ])('shows an error, creates nothing and keeps Manual create after %s', async (_case, arrange, message) => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    arrange()
    render(
      <ResourceCreateWizard
        kind="agent"
        open
        onOpenChange={vi.fn()}
        onStartConversation={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    await describePurpose(user)
    await user.click(screen.getByRole('button', { name: 'fill model' }))
    await user.click(screen.getByRole('button', { name: AUTO }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: MANUAL }))
    expect(screen.getByRole('button', { name: BASIC })).toHaveAttribute('aria-current', 'step')
  })

  it('asks for a default model instead of generating when none is set', async () => {
    const user = userEvent.setup()
    modelHook.defaultModel = undefined
    render(
      <ResourceCreateWizard
        kind="assistant"
        open
        onOpenChange={vi.fn()}
        onStartConversation={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    await describePurpose(user)
    await user.click(screen.getByRole('button', { name: 'fill model' }))
    await user.click(screen.getByRole('button', { name: AUTO }))

    expect(await screen.findByRole('alert')).toHaveTextContent('library.config.prompt.no_default_model')
    expect(autoConfigure.generate).not.toHaveBeenCalled()
  })

  it('keeps what the user entered when the generated create fails, so Manual create adds no hidden tools', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Network down')).mockResolvedValue(undefined)
    autoConfigure.generate.mockResolvedValue({ ...generated, enableWebSearch: true })
    render(
      <ResourceCreateWizard
        kind="assistant"
        open
        onOpenChange={vi.fn()}
        onStartConversation={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    await describePurpose(user)
    await user.click(screen.getByRole('button', { name: 'fill model' }))
    await user.click(screen.getByRole('button', { name: AUTO }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down')
    expect(screen.getByRole('textbox', { name: 'draft name' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'draft description' })).toHaveValue('Review my GitHub PRs')

    await user.click(screen.getByRole('button', { name: MANUAL }))
    await user.click(screen.getByRole('button', { name: 'fill name' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: CREATE }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: 'My Resource',
        description: 'Review my GitHub PRs',
        prompt: '',
        knowledgeBaseIds: [],
        mcpServerIds: [],
        enableWebSearch: false
      })
    )
  })

  it('cannot be closed once the generated resource is being created', async () => {
    const user = userEvent.setup()
    let finishCreate: (id: string) => void = () => {}
    const onSubmit = vi.fn(() => new Promise<string>((resolve) => (finishCreate = resolve)))
    const onOpenChange = vi.fn()
    autoConfigure.generate.mockResolvedValue(generated)
    render(
      <ResourceCreateWizard
        kind="agent"
        open
        onOpenChange={onOpenChange}
        onStartConversation={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    await describePurpose(user)
    await user.click(screen.getByRole('button', { name: 'fill model' }))
    await user.click(screen.getByRole('button', { name: AUTO }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    fireEvent.click(dialogCloseButton())
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => finishCreate('agent-1'))
    fireEvent.click(dialogCloseButton())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('lets the user cancel while generating and abandons the request', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    let signal: AbortSignal | undefined
    let finishGenerate: (value: unknown) => void = () => {}
    autoConfigure.generate.mockImplementation((input) => {
      signal = input.signal
      return new Promise((resolve) => (finishGenerate = resolve))
    })
    render(<ActivityHostWithSubmit onSubmit={onSubmit} />)

    await describePurpose(user)
    await user.click(screen.getByRole('button', { name: 'fill model' }))
    await user.click(screen.getByRole('button', { name: AUTO }))
    // The working view stands in for the entry, titled with the purpose until a name exists.
    expect(screen.getByRole('heading', { name: 'library.config.dialogs.create.result.working_title' })).toBeVisible()
    expect(screen.getByText('Review my GitHub PRs')).toBeVisible()
    expect(screen.queryByRole('button', { name: MANUAL })).not.toBeInTheDocument()
    fireEvent.click(dialogCloseButton())

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(signal?.aborted).toBe(true)
    // A reply that still arrives after the cancel must not create anything.
    await act(async () => finishGenerate(generated))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('ends on the result page with the generated configuration resolved to names', async () => {
    const user = userEvent.setup()
    autoConfigure.generate.mockResolvedValue(generated)
    render(<ResultHost kind="agent" onSubmit={vi.fn().mockResolvedValue('agent-1')} />)

    await describePurpose(user)
    await user.click(screen.getByRole('button', { name: 'fill model' }))
    await user.click(screen.getByRole('button', { name: AUTO }))

    expect(
      await screen.findByRole('heading', { name: 'library.config.dialogs.create.result.agent_title' })
    ).toBeVisible()
    expect(screen.getByText('PR Reviewer')).toBeVisible()
    expect(screen.getByText('Reviews pull requests')).toBeVisible()
    expect(summaryValue(PROMPT_ROW)).toHaveTextContent('library.config.dialogs.create.result.prompt_generated')
    expect(summaryValue('common.model')).toHaveTextContent('Picked model')
    expect(summaryValue(PERMISSION_ROW)).toHaveTextContent('agent.settings.tooling.permissionMode.default.title')
    expect(summaryValue(SKILLS_ROW)).toHaveTextContent('Builtin skill, Review skill')
    expect(summaryValue(MCP_ROW)).toHaveTextContent('GitHub')
    expect(summaryValue(KNOWLEDGE_ROW)).toHaveTextContent('Docs')
  })

  it('summarises an Assistant with its web search state and no Agent-only rows', async () => {
    const user = userEvent.setup()
    autoConfigure.generate.mockResolvedValue({ ...generated, enableWebSearch: true, mcpServerIds: [] })
    render(<ResultHost kind="assistant" onSubmit={vi.fn().mockResolvedValue('assistant-1')} />)

    await describePurpose(user)
    await user.click(screen.getByRole('button', { name: 'fill model' }))
    await user.click(screen.getByRole('button', { name: AUTO }))

    expect(
      await screen.findByRole('heading', { name: 'library.config.dialogs.create.result.assistant_title' })
    ).toBeVisible()
    expect(summaryValue(TOOLS_ROW)).toHaveTextContent('library.config.dialogs.create.result.web_search')
    expect(summaryValue(MCP_ROW)).toHaveTextContent('common.none')
    expect(screen.queryByText(PERMISSION_ROW)).not.toBeInTheDocument()
    expect(screen.queryByText(SKILLS_ROW)).not.toBeInTheDocument()
  })
})

describe('ResourceCreateWizard result page', () => {
  async function createManually(user: ReturnType<typeof userEvent.setup>, kind: ResourceCreateWizardKind) {
    await user.type(screen.getByRole('textbox', { name: 'draft description' }), 'Review my GitHub PRs')
    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: MANUAL }))
    for (let step = 0; step < (kind === 'agent' ? 3 : 2); step++) {
      await user.click(screen.getByRole('button', { name: NEXT }))
    }
    await user.click(screen.getByRole('button', { name: CREATE }))
  }

  it('ends a manual create on the result page with what was configured', async () => {
    const user = userEvent.setup()
    render(<ResultHost kind="agent" onSubmit={vi.fn().mockResolvedValue('agent-1')} />)

    await createManually(user, 'agent')

    expect(
      await screen.findByRole('heading', { name: 'library.config.dialogs.create.result.agent_title' })
    ).toBeVisible()
    expect(screen.getByText('My Resource')).toBeVisible()
    // Manual create seeds an Agent's prompt from the purpose, so it counts as filled, not generated.
    expect(summaryValue(PROMPT_ROW)).toHaveTextContent('library.config.dialogs.create.result.prompt_filled')
    expect(summaryValue('common.model')).toHaveTextContent('Picked model')
    expect(summaryValue(PERMISSION_ROW)).toHaveTextContent('agent.settings.tooling.permissionMode.auto.title')
    expect(summaryValue(TOOLS_ROW)?.textContent).toMatch(/tools_enabled:(\d+)\/\1$/)
    expect(summaryValue(SKILLS_ROW)).toHaveTextContent(/^Builtin skill$/)
    expect(summaryValue(MCP_ROW)).toHaveTextContent('common.none')
    expect(summaryValue(KNOWLEDGE_ROW)).toHaveTextContent('common.none')
  })

  it('closes and runs the start action with the created ID, then reopens on a fresh entry', async () => {
    const user = userEvent.setup()
    const onStartConversation = vi.fn()
    render(
      <ResultHost
        kind="assistant"
        onSubmit={vi.fn().mockResolvedValue('assistant-1')}
        onStartConversation={onStartConversation}
      />
    )
    await createManually(user, 'assistant')

    await user.click(await screen.findByRole('button', { name: START }))

    expect(onStartConversation).toHaveBeenCalledExactlyOnceWith('assistant-1')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'reopen wizard' }))
    expect(screen.getByRole('heading', { name: 'library.config.dialogs.create.assistant_title' })).toBeVisible()
    expect(screen.getByRole('button', { name: MANUAL })).toBeVisible()
  })

  it('closes and opens the edit dialog for the created resource on Adjust settings', async () => {
    const user = userEvent.setup()
    const onStartConversation = vi.fn()
    render(
      <ResultHost
        kind="agent"
        onSubmit={vi.fn().mockResolvedValue('agent-1')}
        onStartConversation={onStartConversation}
      />
    )
    await createManually(user, 'agent')

    await user.click(await screen.findByRole('button', { name: ADJUST }))

    expect(await screen.findByTestId('edit-host')).toHaveTextContent('agent:agent-1')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onStartConversation).not.toHaveBeenCalled()
  })
})

function ResultHost({
  kind,
  onSubmit,
  onStartConversation = vi.fn()
}: Pick<ComponentProps<typeof ResourceCreateWizard>, 'kind' | 'onSubmit'> & {
  onStartConversation?: (id: string) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        reopen wizard
      </button>
      <ResourceCreateWizard
        kind={kind}
        open={open}
        onOpenChange={setOpen}
        onSubmit={onSubmit}
        onStartConversation={onStartConversation}
      />
    </>
  )
}

function ActivityHostWithSubmit({ onSubmit }: Pick<ComponentProps<typeof ResourceCreateWizard>, 'onSubmit'>) {
  const [open, setOpen] = useState(true)
  return (
    <ResourceCreateWizard
      kind="agent"
      open={open}
      onOpenChange={setOpen}
      onStartConversation={vi.fn()}
      onSubmit={onSubmit}
    />
  )
}
