import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, cleanup, fireEvent, render, type RenderResult, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity, type ComponentProps, useState } from 'react'
import type * as ReactHookForm from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { AgentType } from '@shared/data/types/agent'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { ResourceCreateWizardFormValues, ResourceCreateWizardKind } from '../types'

const autoConfigure = vi.hoisted(() => ({
  ready: true,
  generate: vi.fn<(input: { purpose: string; name: string; signal: AbortSignal }) => Promise<unknown>>(),
  installFeaturedMcpServers: vi.fn<(ids: string[]) => Promise<string[]>>()
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
  useResourceAutoConfigure: () => ({
    ready: autoConfigure.ready,
    generate: autoConfigure.generate,
    installFeaturedMcpServers: autoConfigure.installFeaturedMcpServers
  })
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
  CapabilityStep: ({ form }: { form: ReactHookForm.UseFormReturn<ResourceCreateWizardFormValues> }) => (
    <div data-testid="capability-step">
      <button type="button" onClick={() => form.setValue('skillIds', ['skill-review'])}>
        select skill
      </button>
    </div>
  )
}))
// The tools and advanced steps run for real; only their catalog-backed and Radix-select fields are stubbed.
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: vi.fn() }))
vi.mock('@renderer/components/resourceCatalog/dialogs/components/McpCapabilityList', () => ({
  McpCapabilityList: ({ onSelectedIdsChange }: { onSelectedIdsChange: (ids: string[]) => void }) => (
    <button type="button" onClick={() => onSelectedIdsChange(['mcp-github'])}>
      select MCP server
    </button>
  )
}))
vi.mock('@renderer/components/resourceCatalog/dialogs/components/ReplyLanguageSelect', () => ({
  ReplyLanguageSelect: ({
    onChange
  }: {
    onChange: (patch: { languageMode: 'custom'; languageCustom: string }) => void
  }) => (
    <button type="button" onClick={() => onChange({ languageMode: 'custom', languageCustom: '日本語' })}>
      reply in Japanese
    </button>
  )
}))

import { buildCreateAgentCommand } from '@renderer/utils/resourceCatalog'

import { ResourceCreateWizard } from '../ResourceCreateWizard'

const NEXT = 'library.config.dialogs.create.next'
const CREATE = 'library.config.dialogs.create.submit'
const CANCEL = 'common.cancel'
const MANUAL = 'library.config.dialogs.create.auto.manual'
const AUTO = 'library.config.dialogs.create.auto.submit'
const START = 'library.config.dialogs.create.result.start'
const ADJUST = 'library.config.dialogs.create.result.adjust'
const PROMPT_ROW = 'library.config.prompt.label'
const AGENT_PROMPT = 'library.config.agent.prompt.instructions_label'
const PERMISSION_ROW = 'library.config.agent.section.permission.title'
const TOOLS_ROW = 'library.config.agent.section.tools.tab.tools'
const SKILLS_ROW = 'library.config.agent.section.tools.tab.skills'
const MCP_ROW = 'library.config.agent.section.tools.tab.mcp'
const KNOWLEDGE_ROW = 'library.config.dialogs.create.step.knowledge'
const HEARTBEAT_ROW = 'library.config.agent.field.heartbeat_enabled.label'
const RESULT = 'library.config.dialogs.create.result'
const LIST_SEPARATOR = `${RESULT}.list_separator`

/** The value cell of a result-page summary row. */
const summaryValue = (label: string) => screen.getByText(label).nextElementSibling

/** The dialog's own X button (its sr-only label is not exposed in jsdom). */
const dialogCloseButton = () => document.querySelector<HTMLElement>('[data-slot="dialog-close"]')!

const BASIC = /library\.config\.dialogs\.create\.step\.basic$/
const KNOWLEDGE = /library\.config\.dialogs\.create\.step\.knowledge$/
const DEFAULT_AGENT_SETTINGS_PAYLOAD = {
  disabledTools: [],
  channels: [],
  agentSettings: {
    languageMode: 'inherit',
    languageCustom: '',
    heartbeatEnabled: false,
    heartbeatInterval: 30,
    heartbeatTimeoutMinutes: 2,
    envVarsText: ''
  }
}
const onSubmitSpy = vi.fn()
const UPLOADED_AVATAR = { data: new Uint8Array([1, 2, 3]), previewUrl: 'data:image/webp;base64,AQID' }
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
      <button type="button" onClick={() => form.setValue('avatarImage', UPLOADED_AVATAR, { shouldDirty: true })}>
        upload avatar
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
  if (kind === 'assistant') {
    await replacePrompt(user, 'draft prompt')
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: 'select knowledge base' }))
    return
  }
  // Agents: tools → skills → knowledge, then the prompt on the last step, then back to knowledge.
  await user.click(screen.getByRole('button', { name: NEXT }))
  expect(screen.getByTestId('capability-step')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: NEXT }))
  await user.click(screen.getByRole('button', { name: 'select knowledge base' }))
  await walkToLastStep(user)
  // Pi Durable shows the full prompt field; other runtimes keep the plain editor.
  await replacePrompt(user, screen.queryByRole('textbox', { name: AGENT_PROMPT }) ? AGENT_PROMPT : 'draft prompt')
  await user.click(screen.getByRole('button', { name: KNOWLEDGE }))
}

/** Manual create prefills an Agent's empty prompt with the purpose; replace it with the draft. */
async function replacePrompt(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.clear(screen.getByRole('textbox', { name: label }))
  await user.paste(draft.prompt)
}

async function walkToLastStep(user: ReturnType<typeof userEvent.setup>) {
  while (screen.queryByRole('button', { name: NEXT })) await user.click(screen.getByRole('button', { name: NEXT }))
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
  autoConfigure.installFeaturedMcpServers.mockReset()
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
    await walkToLastStep(user)
    await user.click(screen.getByRole('button', { name: CREATE }))
    expect(onSubmit).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS_PAYLOAD,
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
      await walkToLastStep(user)
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
    await walkToLastStep(user)
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
    await walkToLastStep(user)
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

describe('ResourceCreateWizard agent steps', () => {
  const WRITE_TOOL = 'agent.tools.builtin.write.label'
  const railLabels = () =>
    Array.from(screen.getByRole('button', { name: BASIC }).closest('ol')!.querySelectorAll('li'), (item) =>
      item.textContent?.replace(/^\d+/, '')
    )

  async function startManual(user: ReturnType<typeof userEvent.setup>, kind: ResourceCreateWizardKind = 'agent') {
    const onSubmit = vi.fn().mockResolvedValue('created-1')
    render(
      <ResourceCreateWizard kind={kind} open onOpenChange={vi.fn()} onStartConversation={vi.fn()} onSubmit={onSubmit} />
    )
    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: MANUAL }))
    return onSubmit
  }

  /** The command the caller would send for the submitted values. */
  const submittedCommand = (onSubmit: ReturnType<typeof vi.fn>) => buildCreateAgentCommand(onSubmit.mock.calls[0][0])

  it('keeps the Assistant on basic, System Prompt and knowledge', async () => {
    await startManual(userEvent.setup(), 'assistant')

    expect(railLabels()).toEqual([
      'library.config.dialogs.create.step.basic',
      PROMPT_ROW,
      'library.config.dialogs.create.step.knowledge'
    ])
  })

  it('walks an Agent through seven steps and sends what each one set', async () => {
    const user = userEvent.setup()
    const onSubmit = await startManual(user)

    expect(railLabels()).toEqual([
      'library.config.dialogs.create.step.basic',
      'library.config.dialogs.edit.tools_tab',
      'library.config.dialogs.create.step.capability',
      'library.config.dialogs.create.step.knowledge',
      MCP_ROW,
      'settings.channels.title',
      'library.config.dialogs.edit.advanced_tab'
    ])
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('switch', { name: WRITE_TOOL }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: 'select skill' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: 'select knowledge base' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: 'select MCP server' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.clear(screen.getByRole('textbox', { name: AGENT_PROMPT }))
    await user.type(screen.getByRole('textbox', { name: AGENT_PROMPT }), 'Review carefully')
    await user.click(screen.getByRole('button', { name: 'reply in Japanese' }))
    await user.click(screen.getByRole('switch', { name: HEARTBEAT_ROW }))
    const interval = screen.getByRole('spinbutton', { name: 'library.config.agent.field.heartbeat_interval.label' })
    await user.clear(interval)
    await user.type(interval, '45')
    await user.tab()
    await user.type(screen.getByRole('textbox', { name: /env_vars\.label/ }), 'API_KEY=secret{Enter}REGION=eu')
    await user.click(screen.getByRole('button', { name: CREATE }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(submittedCommand(onSubmit)).toMatchObject({
      type: 'pi-durable',
      instructions: 'Review carefully',
      disabledTools: ['write'],
      skillIds: ['skill-review'],
      knowledgeBaseIds: ['knowledge-draft'],
      mcps: ['mcp-github'],
      configuration: {
        language: '日本語',
        heartbeat_enabled: true,
        heartbeat_interval: 45,
        env_vars: { API_KEY: 'secret', REGION: 'eu' }
      }
    })
  })

  it('creates the Agent with a tool switched off in disabledTools, and drops one switched back on', async () => {
    const user = userEvent.setup()
    const onSubmit = await startManual(user)

    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('switch', { name: WRITE_TOOL }))
    await user.click(screen.getByRole('switch', { name: 'agent.tools.builtin.read.label' }))
    await user.click(screen.getByRole('switch', { name: 'agent.tools.builtin.read.label' }))
    await walkToLastStep(user)
    await user.click(screen.getByRole('button', { name: CREATE }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(submittedCommand(onSubmit).disabledTools).toEqual(['write'])
  })

  it('adds no language, heartbeat or env vars to the configuration when the advanced step is left alone', async () => {
    const user = userEvent.setup()
    const onSubmit = await startManual(user)

    await walkToLastStep(user)
    await user.click(screen.getByRole('button', { name: CREATE }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const command = submittedCommand(onSubmit)
    expect(command.configuration).toEqual({ avatar: '✨', permission_mode: 'auto' })
    expect(command).not.toHaveProperty('disabledTools')
    expect(command).not.toHaveProperty('mcps')
    expect(command).not.toHaveProperty('channels')
  })

  describe('channels', () => {
    const ADD_CHANNEL = 'library.config.dialogs.create.channels.add'
    const TELEGRAM = 'agent.channels.telegram.title'
    const WECHAT = 'agent.channels.wechat.title'
    const DONE = 'library.config.dialogs.create.channels.done'

    async function openChannelsStep(user: ReturnType<typeof userEvent.setup>) {
      const onSubmit = await startManual(user)
      while (!screen.queryByRole('button', { name: ADD_CHANNEL })) {
        await user.click(screen.getByRole('button', { name: NEXT }))
      }
      return onSubmit
    }
    async function addChannel(user: ReturnType<typeof userEvent.setup>, platform: string) {
      // The shared UI mock renders menu items as always-visible buttons.
      await user.click(screen.getByRole('button', { name: platform }))
    }

    it('adds, edits and removes channel drafts, and creates the Agent with the ones left', async () => {
      const user = userEvent.setup()
      const onSubmit = await openChannelsStep(user)

      await addChannel(user, TELEGRAM)
      await user.type(screen.getByPlaceholderText('agent.channels.telegram.botTokenPlaceholder'), ' 123:abc ')
      const name = screen.getByDisplayValue(TELEGRAM)
      await user.clear(name)
      await user.type(name, 'Ops bot')
      await user.click(screen.getByRole('button', { name: DONE }))
      await user.click(screen.getByRole('switch', { name: 'common.enabled Ops bot' }))

      await addChannel(user, WECHAT)
      await user.click(screen.getByRole('button', { name: DONE }))
      await user.click(screen.getByRole('button', { name: `common.delete ${WECHAT}` }))
      expect(screen.queryByRole('button', { name: `common.edit ${WECHAT}` })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'common.edit Ops bot' }))
      await user.type(screen.getByPlaceholderText('agent.channels.telegram.chatIdsPlaceholder'), '42, 43')
      await user.click(screen.getByRole('button', { name: DONE }))

      await walkToLastStep(user)
      await user.click(screen.getByRole('button', { name: CREATE }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(submittedCommand(onSubmit).channels).toEqual([
        {
          type: 'telegram',
          name: 'Ops bot',
          isActive: true,
          permissionMode: null,
          config: { bot_token: '123:abc', allowed_chat_ids: ['42', '43'] }
        }
      ])
    })

    it('blocks Next until a channel switched on has its credentials', async () => {
      const user = userEvent.setup()
      await openChannelsStep(user)

      await addChannel(user, TELEGRAM)
      await user.click(screen.getByRole('button', { name: DONE }))
      await user.click(screen.getByRole('switch', { name: `common.enabled ${TELEGRAM}` }))

      expect(screen.getByRole('alert')).toHaveTextContent('library.config.dialogs.create.channels.invalid')
      expect(screen.getByRole('button', { name: NEXT })).toBeDisabled()

      await user.click(screen.getByRole('button', { name: `common.edit ${TELEGRAM}` }))
      await user.type(screen.getByPlaceholderText('agent.channels.telegram.botTokenPlaceholder'), '123:abc')
      await user.click(screen.getByRole('button', { name: DONE }))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: NEXT })).toBeEnabled()
    })

    it('keeps a WeChat draft off and pending its QR login, which needs the Agent to exist', async () => {
      const user = userEvent.setup()
      await openChannelsStep(user)

      await addChannel(user, WECHAT)
      expect(screen.getByText('agent.channels.qrAfterCreate')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: DONE }))

      expect(screen.getByRole('switch', { name: `common.enabled ${WECHAT}` })).toBeDisabled()
      expect(screen.getByText('library.config.dialogs.create.channels.qr_pending')).toBeInTheDocument()
    })
  })
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
    autoConfigure.installFeaturedMcpServers.mockImplementation(async (ids) => ids)
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
      ...DEFAULT_AGENT_SETTINGS_PAYLOAD,
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

  it('installs a picked featured MCP server before creating, and sends its new server ID', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    autoConfigure.generate.mockResolvedValue({ ...generated, mcpServerIds: ['mcp-github', 'preset:fetch'] })
    autoConfigure.installFeaturedMcpServers.mockImplementation(async (ids) => {
      expect(onSubmit).not.toHaveBeenCalled()
      return ids.map((id) => (id === 'preset:fetch' ? 'mcp-fetch-new' : id))
    })
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
    expect(autoConfigure.installFeaturedMcpServers).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].mcpServerIds).toEqual(['mcp-github', 'mcp-fetch-new'])
  })

  it('creates nothing and keeps the entry when a featured MCP server fails to install', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    autoConfigure.generate.mockResolvedValue({ ...generated, mcpServerIds: ['preset:fetch'] })
    autoConfigure.installFeaturedMcpServers.mockRejectedValue(new Error('npm offline'))
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

    expect(await screen.findByRole('alert')).toHaveTextContent('npm offline')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'draft name' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'draft description' })).toHaveValue('Review my GitHub PRs')
    expect(screen.getByRole('button', { name: MANUAL })).toBeEnabled()
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

  it.each([
    ['assistant', 'assistant_fallback_name', 2],
    ['agent', 'agent_fallback_name', 3]
  ] as const)(
    'names an unnamed %s by its kind while generating and keeps the purpose as the subtitle',
    async (kind, fallbackKey, stepCount) => {
      const user = userEvent.setup()
      autoConfigure.generate.mockReturnValue(new Promise(() => {}))
      render(
        <ResourceCreateWizard
          kind={kind}
          open
          onOpenChange={vi.fn()}
          onStartConversation={vi.fn()}
          onSubmit={vi.fn()}
        />
      )

      await describePurpose(user)
      await user.click(screen.getByRole('button', { name: 'fill model' }))
      await user.click(screen.getByRole('button', { name: AUTO }))

      expect(screen.getByText(`${RESULT}.${fallbackKey}`)).toBeVisible()
      expect(screen.getByText('Review my GitHub PRs')).toBeVisible()
      expect(screen.getAllByText(new RegExp(`^${RESULT}\\.working\\.`))).toHaveLength(stepCount)
    }
  )

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
    expect(screen.getByRole('heading', { name: 'library.config.dialogs.create.result.working_title' })).toBeVisible()
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
    expect(summaryValue(SKILLS_ROW)).toHaveTextContent(`Builtin skill${LIST_SEPARATOR}Review skill`)
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
    expect(summaryValue(MCP_ROW)).toHaveTextContent(`${RESULT}.empty.not_added`)
    expect(screen.queryByText(PERMISSION_ROW)).not.toBeInTheDocument()
    expect(screen.queryByText(SKILLS_ROW)).not.toBeInTheDocument()
  })
})

describe('ResourceCreateWizard result page', () => {
  async function createManually(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByRole('textbox', { name: 'draft description' }), 'Review my GitHub PRs')
    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: MANUAL }))
    await walkToLastStep(user)
    await user.click(screen.getByRole('button', { name: CREATE }))
  }

  it('ends a manual create on the result page with what was configured', async () => {
    const user = userEvent.setup()
    render(<ResultHost kind="agent" onSubmit={vi.fn().mockResolvedValue('agent-1')} />)

    await createManually(user)

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
    expect(summaryValue(MCP_ROW)).toHaveTextContent(`${RESULT}.empty.not_bound`)
    expect(summaryValue(KNOWLEDGE_ROW)).toHaveTextContent(`${RESULT}.empty.not_linked`)
    expect(summaryValue(HEARTBEAT_ROW)).toHaveTextContent(`${RESULT}.heartbeat_off`)
    expect(summaryValue('settings.channels.title')).toHaveTextContent(`${RESULT}.empty.not_connected`)
  })

  it("lists the Agent's channels and starts a pending QR login from the result page", async () => {
    MockUseDataApiUtils.mockQueryResult('/agent-channels', {
      data: [
        { id: 'ch-wechat', type: 'wechat', name: 'WeChat bot', isActive: false, config: { token_path: '' } },
        { id: 'ch-telegram', type: 'telegram', name: 'Ops bot', isActive: true, config: { bot_token: 't' } }
      ] as never
    })
    const request = vi.mocked(window.api.ipcApi.request)
    request.mockResolvedValue({ ok: true, data: undefined })
    const user = userEvent.setup()
    render(<ResultHost kind="agent" onSubmit={vi.fn().mockResolvedValue('agent-1')} />)

    await createManually(user)

    const channels = await waitFor(() => summaryValue('settings.channels.title')!)
    expect(channels).toHaveTextContent(`WeChat bot${RESULT}.qr_pending${RESULT}.qr_login${LIST_SEPARATOR}Ops bot`)
    await user.click(screen.getByRole('button', { name: `${RESULT}.qr_login` }))
    expect(request).toHaveBeenCalledWith('channel.update', { channelId: 'ch-wechat', updates: { isActive: true } })

    // Abandoning the login switches the channel off again, so it stays pending instead of polling.
    const qrDialog = screen.getByRole('heading', { name: 'agent.channels.wechat.qrTitle' }).closest('[role="dialog"]')!
    await user.click(qrDialog.querySelector<HTMLElement>('[data-slot="dialog-close"]')!)
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('channel.update', { channelId: 'ch-wechat', updates: { isActive: false } })
    )
  })

  it('counts a tool switched off and shows the heartbeat interval', async () => {
    const user = userEvent.setup()
    render(<ResultHost kind="agent" onSubmit={vi.fn().mockResolvedValue('agent-1')} />)

    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: MANUAL }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('switch', { name: 'agent.tools.builtin.write.label' }))
    await walkToLastStep(user)
    await user.click(screen.getByRole('switch', { name: HEARTBEAT_ROW }))
    await user.click(screen.getByRole('button', { name: CREATE }))

    await screen.findByRole('heading', { name: 'library.config.dialogs.create.result.agent_title' })
    const [, enabled, total] = summaryValue(TOOLS_ROW)?.textContent?.match(/tools_enabled:(\d+)\/(\d+)$/) ?? []
    expect(Number(enabled)).toBe(Number(total) - 1)
    expect(summaryValue(HEARTBEAT_ROW)).toHaveTextContent(`${RESULT}.heartbeat_every:30`)
  })

  it('says what an empty manual Assistant lacks in its own words', async () => {
    const user = userEvent.setup()
    render(<ResultHost kind="assistant" onSubmit={vi.fn().mockResolvedValue('assistant-1')} />)

    await createManually(user)

    expect(
      await screen.findByRole('heading', { name: 'library.config.dialogs.create.result.assistant_title' })
    ).toBeVisible()
    expect(summaryValue(TOOLS_ROW)).toHaveTextContent(`${RESULT}.empty.not_enabled`)
    expect(summaryValue(MCP_ROW)).toHaveTextContent(`${RESULT}.empty.not_added`)
    expect(summaryValue(KNOWLEDGE_ROW)).toHaveTextContent(`${RESULT}.empty.not_linked`)
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
    await createManually(user)

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
    await createManually(user)

    await user.click(await screen.findByRole('button', { name: ADJUST }))

    expect(await screen.findByTestId('edit-host')).toHaveTextContent('agent:agent-1')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onStartConversation).not.toHaveBeenCalled()
  })
})

describe('ResourceCreateWizard uploaded avatar', () => {
  const request = () => vi.mocked(window.api.ipcApi.request)
  const avatarImage = () => screen.queryByRole('img', { name: 'common.avatar' })

  beforeEach(() => {
    request().mockReset().mockResolvedValue({ ok: true, data: undefined })
  })

  it('saves the uploaded image onto the new Agent after create and shows it on the result page', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue('agent-1')
    render(<ResultHost kind="agent" onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'upload avatar' }))
    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: MANUAL }))
    await walkToLastStep(user)
    await user.click(screen.getByRole('button', { name: CREATE }))

    await screen.findByRole('heading', { name: 'library.config.dialogs.create.result.agent_title' })
    expect(request()).toHaveBeenCalledWith('agent.set_avatar', {
      agentId: 'agent-1',
      avatar: { kind: 'image', data: UPLOADED_AVATAR.data }
    })
    // The image only lands on a resource that exists.
    expect(onSubmit.mock.invocationCallOrder[0]).toBeLessThan(request().mock.invocationCallOrder[0])
    expect(avatarImage()).toHaveAttribute('src', UPLOADED_AVATAR.previewUrl)
  })

  it('keeps the result page with the emoji and says so when the image cannot be saved', async () => {
    request().mockRejectedValue(new Error('disk full'))
    const user = userEvent.setup()
    render(<ResultHost kind="assistant" onSubmit={vi.fn().mockResolvedValue('assistant-1')} />)

    await user.click(screen.getByRole('button', { name: 'upload avatar' }))
    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: MANUAL }))
    await walkToLastStep(user)
    await user.click(screen.getByRole('button', { name: CREATE }))

    await screen.findByRole('heading', { name: 'library.config.dialogs.create.result.assistant_title' })
    expect(request()).toHaveBeenCalledWith(
      'assistant.set_avatar',
      expect.objectContaining({ assistantId: 'assistant-1' })
    )
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('library.config.dialogs.create.avatar_save_failed')
    )
    expect(avatarImage()).not.toBeInTheDocument()
    expect(screen.getByText('💬')).toBeVisible()
  })

  it('keeps an uploaded image over the emoji auto create generates', async () => {
    modelHook.defaultModel = makeModel()
    autoConfigure.installFeaturedMcpServers.mockImplementation(async (ids) => ids)
    autoConfigure.generate.mockResolvedValue({
      name: 'PR Reviewer',
      emoji: '🔍',
      description: 'Reviews pull requests',
      prompt: 'You review pull requests.',
      knowledgeBaseIds: [],
      mcpServerIds: [],
      skillIds: [],
      enableWebSearch: false
    })
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue('agent-1')
    render(<ResultHost kind="agent" onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'upload avatar' }))
    await user.type(screen.getByRole('textbox', { name: 'draft description' }), 'Review my GitHub PRs')
    await user.click(screen.getByRole('button', { name: 'fill model' }))
    await user.click(screen.getByRole('button', { name: AUTO }))

    await screen.findByRole('heading', { name: 'library.config.dialogs.create.result.agent_title' })
    // The generated emoji is still stored as the fallback behind the image.
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ avatar: '🔍' }))
    expect(request()).toHaveBeenCalledWith('agent.set_avatar', {
      agentId: 'agent-1',
      avatar: { kind: 'image', data: UPLOADED_AVATAR.data }
    })
    expect(avatarImage()).toHaveAttribute('src', UPLOADED_AVATAR.previewUrl)
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
