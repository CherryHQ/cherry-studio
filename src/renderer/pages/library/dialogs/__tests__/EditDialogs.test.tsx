import type * as CherryStudioUi from '@cherrystudio/ui'
import type { AgentDetail } from '@renderer/pages/library/types'
import type { Assistant } from '@shared/data/types/assistant'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { EDIT_DIALOG_PROMPT_MAX_HEIGHT, EDIT_DIALOG_PROMPT_MIN_HEIGHT } from '../edit/EditDialogShared'

const {
  agentTools,
  ensureTagsMock,
  fetchGenerateMock,
  mcpStatusState,
  openSettingsWindowMock,
  toastErrorMock,
  toggleSkillMock,
  updateAgentMock,
  updateAssistantMock,
  useMutationMock,
  useQueryMock
} = vi.hoisted(() => ({
  agentTools: [
    { id: 'Bash', name: 'Bash', description: 'Run shell commands', origin: 'builtin', approval: 'prompt' },
    { id: 'Edit', name: 'Edit', description: 'Edit files', origin: 'builtin', approval: 'prompt' },
    { id: 'Glob', name: 'Glob', description: 'Find files', origin: 'builtin', approval: 'auto' },
    { id: 'Grep', name: 'Grep', description: 'Search files', origin: 'builtin', approval: 'auto' },
    { id: 'MultiEdit', name: 'MultiEdit', description: 'Edit multiple ranges', origin: 'builtin', approval: 'prompt' },
    {
      id: 'NotebookEdit',
      name: 'NotebookEdit',
      description: 'Edit notebooks',
      origin: 'builtin',
      approval: 'prompt'
    },
    {
      id: 'NotebookRead',
      name: 'NotebookRead',
      description: 'Read notebooks',
      origin: 'builtin',
      approval: 'auto'
    },
    { id: 'Read', name: 'Read', description: 'Read files', origin: 'builtin', approval: 'auto' },
    { id: 'Task', name: 'Task', description: 'Run sub-agents', origin: 'builtin', approval: 'auto' },
    { id: 'TodoWrite', name: 'TodoWrite', description: 'Manage todos', origin: 'builtin', approval: 'auto' },
    { id: 'WebFetch', name: 'WebFetch', description: 'Fetch websites', origin: 'builtin', approval: 'prompt' },
    { id: 'WebSearch', name: 'WebSearch', description: 'Search web', origin: 'builtin', approval: 'prompt' },
    { id: 'Write', name: 'Write', description: 'Write files', origin: 'builtin', approval: 'prompt' }
  ],
  ensureTagsMock: vi.fn(),
  fetchGenerateMock: vi.fn(),
  mcpStatusState: { current: {} as Record<string, { state: string; lastCheckedAt: number }> },
  openSettingsWindowMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toggleSkillMock: vi.fn(),
  updateAgentMock: vi.fn(),
  updateAssistantMock: vi.fn(),
  useMutationMock: vi.fn(),
  useQueryMock: vi.fn()
}))

const MODEL = vi.hoisted(
  () =>
    ({
      id: 'provider::updated-model',
      providerId: 'provider',
      name: 'Updated Model',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    }) as const
)

vi.mock('@renderer/components/Selector/model', () => ({
  ModelSelector: ({ trigger, onSelect }: { trigger: ReactNode; onSelect: (modelId: string | undefined) => void }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onSelect(MODEL.id)}>
        Pick model
      </button>
    </div>
  )
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

vi.mock('@renderer/components/EmojiPicker', () => ({
  default: ({ onEmojiClick }: { onEmojiClick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onEmojiClick('🎓')}>
      Choose emoji
    </button>
  )
}))

vi.mock('@renderer/components/PromptEditorField', () => ({
  default: ({
    actions,
    label,
    labelAddon,
    value,
    onChange,
    placeholder,
    minHeight,
    maxHeight
  }: {
    actions?: ReactNode
    label?: ReactNode
    labelAddon?: ReactNode
    value: string
    onChange: (value: string) => void
    placeholder?: string
    minHeight?: string
    maxHeight?: string
  }) => (
    <div>
      <div>
        {label}
        {labelAddon}
        {actions}
      </div>
      <textarea
        aria-label="Prompt editor"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ minHeight, maxHeight }}
      />
    </div>
  )
}))

vi.mock('@renderer/hooks/useTags', () => ({
  useEnsureTags: () => ({ ensureTags: ensureTagsMock }),
  useTagList: () => ({
    tags: [
      {
        id: 'tag-work',
        name: 'work',
        color: '#8b5cf6',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      },
      {
        id: 'tag-personal',
        name: 'personal',
        color: '#10b981',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      }
    ]
  })
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock
}))

vi.mock('@renderer/hooks/agents/useAgentTools', () => ({
  useAgentTools: () => ({
    tools: agentTools,
    isLoading: false,
    error: undefined
  })
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatusMap: () => mcpStatusState.current
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useInstalledSkills: () => ({
    skills: [
      {
        id: 'skill-1',
        name: 'Skill One',
        description: 'Skill description',
        isEnabled: false
      }
    ],
    loading: false,
    toggle: toggleSkillMock
  })
}))

vi.mock('@renderer/hooks/usePromptProcessor', () => ({
  usePromptProcessor: ({ prompt }: { prompt: string }) => prompt
}))

vi.mock('@renderer/components/TopView/toast', () => ({
  useToasts: () => ({ error: toastErrorMock })
}))

vi.mock('@renderer/services/ApiService', () => ({
  fetchGenerate: fetchGenerateMock
}))

vi.mock('@renderer/services/SettingsWindowService', () => ({
  openSettingsWindow: openSettingsWindowMock
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) =>
        ({
          'agent.cherryClaw.heartbeat.enabledHelper': 'Send heartbeat messages.',
          'agent.cherryClaw.heartbeat.intervalHelper': 'Heartbeat interval.',
          'agent.settings.tooling.preapproved.autoBadge': 'Added by mode',
          'agent.settings.tooling.preapproved.autoDisabledTooltip': 'Added by {{mode}}',
          'common.avatar': 'Avatar',
          'common.cancel': 'Cancel',
          'common.clear': 'Clear',
          'common.delete': 'Delete',
          'common.description': 'Description',
          'common.edit': 'Edit',
          'common.help': 'Help',
          'common.loading': 'Loading',
          'common.model': 'Model',
          'common.name': 'Name',
          'common.preview': 'Preview',
          'common.remove': 'Remove',
          'common.required_field': 'Required',
          'common.save': 'Save',
          'common.undo': 'Undo',
          'error.no_response': 'No response',
          'library.action.enable': 'Enable',
          'library.config.agent.field.description.hint': 'Short agent summary.',
          'library.config.agent.field.description.label': 'Description',
          'library.config.agent.field.description.placeholder': 'Describe this agent',
          'library.config.agent.field.heartbeat_enabled.label': 'Heartbeat',
          'library.config.agent.field.heartbeat_interval.label': 'Heartbeat interval',
          'library.config.agent.field.model.hint': 'Primary agent model.',
          'library.config.agent.field.model.label': 'Model',
          'library.config.agent.field.name.hint': 'Shown in the selector.',
          'library.config.agent.field.name.label': 'Name',
          'library.config.agent.field.name.placeholder': 'Name this agent',
          'library.config.agent.field.plan_model.hint': 'Plan model.',
          'library.config.agent.field.plan_model.label': 'Plan model',
          'library.config.agent.field.small_model.hint': 'Small model.',
          'library.config.agent.field.small_model.label': 'Small model',
          'library.config.agent.field.soul_enabled.help': 'Use workspace soul files and autonomous tools.',
          'library.config.agent.field.soul_enabled.label': 'Autonomous mode',
          'library.config.agent.field.instructions.label': 'Instructions',
          'library.config.agent.field.instructions.placeholder': 'Tell this agent how to work',
          'library.config.agent.field.env_vars.help': 'One KEY=VALUE per line',
          'library.config.agent.field.env_vars.label': 'Environment variables',
          'library.config.agent.field.env_vars.placeholder': 'KEY=value\nANOTHER_KEY=another_value',
          'library.config.agent.field.permission_mode.label': 'Permission mode',
          'library.config.agent.field.permission_mode.option.acceptEdits': 'Auto-edit Mode',
          'library.config.agent.field.permission_mode.option.bypassPermissions': 'Full Auto Mode',
          'library.config.agent.field.permission_mode.option.default': 'Normal Mode',
          'library.config.agent.field.permission_mode.option.plan': 'Plan Mode',
          'library.config.agent.section.permission.desc': 'Permission options.',
          'library.config.agent.section.permission.title': 'Permission',
          'library.config.agent.section.tools.add': 'Add',
          'library.config.agent.section.tools.no_builtin_enabled': 'No built-in tools enabled',
          'library.config.agent.section.tools.no_mcp_bound': 'No MCP servers bound',
          'library.config.agent.section.tools.no_skills_enabled': 'No skills enabled',
          'library.config.agent.section.tools.search_placeholder': 'Search tools',
          'library.config.agent.section.tools.skills_require_save': 'Save before skills',
          'library.config.agent.section.tools.tab.mcp': 'MCP',
          'library.config.agent.section.tools.tab.skills': 'Skills',
          'library.config.agent.section.tools.tab.tools': 'Built-in tools',
          'library.config.agent.model_config': 'Model configuration',
          'library.config.basic.field.description.hint': 'Short assistant summary.',
          'library.config.basic.field.description.placeholder': 'Describe this assistant',
          'library.config.basic.custom_params': 'Custom parameters',
          'library.config.basic.custom_params_add': 'Add parameter',
          'library.config.basic.custom_params_name': 'Parameter name',
          'library.config.basic.default_value': 'Model default',
          'library.config.basic.field.model.hint': 'Default chat model.',
          'library.config.basic.field.name.hint': 'Shown in the selector.',
          'library.config.basic.field.name.placeholder': 'Name this assistant',
          'library.config.basic.field.tags.hint': 'Group related assistants.',
          'library.config.basic.field.custom_params.hint': 'Extra provider parameters.',
          'library.config.basic.field.max_tokens.hint': 'Caps response length.',
          'library.config.basic.field.max_tool_calls.hint': 'Caps tool loops.',
          'library.config.basic.field.stream_output.hint': 'Stream responses.',
          'library.config.basic.field.temperature.hint': 'Controls randomness.',
          'library.config.basic.field.top_p.hint': 'Controls nucleus sampling.',
          'library.config.basic.creative': 'Creative',
          'library.config.basic.json_invalid': 'Invalid JSON',
          'library.config.basic.max_tokens': 'Max tokens',
          'library.config.basic.max_tool_calls': 'Max tool calls',
          'library.config.basic.model_clear': 'Clear',
          'library.config.basic.model_pick': 'Pick model',
          'library.config.basic.model_not_found': 'Model {{id}} is unavailable.',
          'library.config.basic.precise': 'Precise',
          'library.config.basic.stream_output': 'Stream output',
          'library.config.basic.tag_empty': 'No tags',
          'library.config.basic.tag_placeholder': 'Select tags',
          'library.config.basic.tag_search': 'Search tags',
          'library.config.basic.mcp_mode': 'MCP Mode',
          'library.config.basic.temperature': 'Temperature',
          'library.config.basic.top_p': 'Top-P',
          'library.config.basic.unlimited': 'Unlimited',
          'library.config.dialogs.edit.advanced_tab': 'Advanced',
          'library.config.prompt.label': 'Prompt',
          'library.config.prompt.placeholder': 'Tell this assistant how to respond',
          'library.config.prompt.dblclick_hint': 'Double-click to edit',
          'library.config.prompt.generate': 'Generate prompt',
          'library.config.prompt.generate_failed_description': 'Check or change the default model, then try again.',
          'library.config.prompt.generate_failed_title': 'Failed to generate prompt',
          'library.config.prompt.tokens_label': 'Tokens: ',
          'library.config.prompt.variables_description':
            'Insert these system variables into the system prompt; before each assistant reply, they are filled with the current information.',
          'library.config.prompt.variables_example': 'Example: Today is {{date}}, and the current date is used.',
          'library.config.prompt.variables_title': 'System variables',
          'library.config.prompt.vars.arch': 'Architecture',
          'library.config.prompt.vars.date': 'Date',
          'library.config.prompt.vars.datetime': 'Datetime',
          'library.config.prompt.vars.language': 'Language',
          'library.config.prompt.vars.model_name': 'Model name',
          'library.config.prompt.vars.os': 'OS',
          'library.config.prompt.vars.time': 'Time',
          'library.config.prompt.vars.username': 'Username',
          'library.config.dialogs.create.avatar_aria': 'Pick avatar',
          'library.config.dialogs.edit.agent_description': 'Edit the essentials for this agent.',
          'library.config.dialogs.edit.agent_title': 'Edit Agent',
          'library.config.dialogs.edit.assistant_description': 'Edit the essentials for this assistant.',
          'library.config.dialogs.edit.assistant_title': 'Edit Assistant',
          'library.config.dialogs.edit.basic_tab': 'Basic',
          'library.config.dialogs.edit.knowledge_tab': 'Knowledge',
          'library.config.dialogs.edit.permission_tab': 'Permission',
          'library.config.dialogs.edit.prompt_tab': 'Prompt',
          'library.config.dialogs.edit.save_failed': 'Save failed',
          'library.config.dialogs.edit.tools_tab': 'Tools',
          'library.config.knowledge.add': 'Add knowledge base',
          'library.config.knowledge.doc_count': '{{count}} docs',
          'library.config.knowledge.empty_desc': 'No knowledge description',
          'library.config.knowledge.empty_title': 'No knowledge bases linked',
          'library.config.knowledge.invalid_suffix': ' unavailable',
          'library.config.knowledge.linked': 'Linked knowledge',
          'library.config.knowledge.linked_hint': 'Choose knowledge bases.',
          'library.config.knowledge.no_more': 'No more knowledge bases',
          'library.config.knowledge.remove_aria': 'Remove knowledge base',
          'library.config.knowledge.search': 'Search knowledge',
          'library.config.tools.add_mcp': 'Add MCP server',
          'library.config.tools.added': 'MCP services',
          'library.config.tools.added_hint': 'Manual mode only uses these.',
          'library.config.tools.empty_desc': 'No MCP description',
          'library.config.tools.empty_title': 'No MCP servers added',
          'library.config.tools.inactive_badge': 'Inactive',
          'library.config.tools.info_main': 'MCP info.',
          'library.config.tools.info_sub': 'MCP sub info.',
          'library.config.tools.mode.auto.desc': 'Auto desc',
          'library.config.tools.mode.auto.label': 'Auto',
          'library.config.tools.mode.disabled.desc': 'Disabled desc',
          'library.config.tools.mode.disabled.label': 'Disabled',
          'library.config.tools.mode.manual.desc': 'Manual desc',
          'library.config.tools.mode.manual.label': 'Manual',
          'library.config.tools.no_more': 'No more servers',
          'library.config.tools.search': 'Search servers',
          'library.no_match': 'No match',
          'settings.mcp.runtimeStatus.connected': 'Connected',
          'settings.mcp.runtimeStatus.connecting': 'Connecting',
          'settings.mcp.runtimeStatus.unavailable': 'Unavailable',
          'settings.title': 'Settings'
        })[key] ??
        fallback ??
        key
    })
  }
})

import { AgentEditDialog } from '../edit/AgentEditDialog'
import { AssistantEditDialog } from '../edit/AssistantEditDialog'

const ASSISTANT: Assistant = {
  id: 'assistant-1',
  name: 'Alpha Assistant',
  prompt: 'Original prompt',
  emoji: '💬',
  description: 'Original assistant description',
  settings: {
    temperature: 1,
    enableTemperature: false,
    topP: 1,
    enableTopP: false,
    maxTokens: 4096,
    enableMaxTokens: false,
    streamOutput: true,
    reasoning_effort: 'default',
    mcpMode: 'auto',
    maxToolCalls: 20,
    enableMaxToolCalls: true,
    enableWebSearch: false,
    customParameters: []
  },
  modelId: 'provider::old-model',
  orderKey: 'a0',
  mcpServerIds: [],
  knowledgeBaseIds: [],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  tags: [
    {
      id: 'tag-work',
      name: 'work',
      color: '#8b5cf6',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    }
  ],
  modelName: 'Old Model'
}

const AGENT: AgentDetail = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Alpha Agent',
  description: 'Original agent description',
  instructions: 'Original instructions',
  model: 'provider::old-model',
  planModel: undefined,
  smallModel: undefined,
  mcps: [],
  configuration: {
    avatar: '🤖',
    soul_enabled: false,
    heartbeat_enabled: true,
    heartbeat_interval: 30
  },
  orderKey: 'a0',
  modelName: 'Old Model',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
}

beforeAll(() => {
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
  HTMLElement.prototype.scrollIntoView = () => {}
})

beforeEach(() => {
  mcpStatusState.current = {
    'mcp-1': { state: 'connected', lastCheckedAt: 1 }
  }
  useQueryMock.mockImplementation((path: string) => {
    if (path.startsWith('/models/')) {
      const id = path.slice('/models/'.length)
      return {
        data: {
          ...MODEL,
          id,
          name: id === MODEL.id ? MODEL.name : 'Old Model'
        },
        isLoading: false
      }
    }
    if (path === '/providers/:providerId') {
      return {
        data: { id: 'provider', name: 'Provider' },
        isLoading: false
      }
    }
    if (path === '/knowledge-bases') {
      return {
        data: {
          items: [
            {
              id: 'kb-1',
              name: 'Knowledge One',
              itemCount: 3
            }
          ]
        },
        isLoading: false
      }
    }
    if (path === '/mcp-servers') {
      return {
        data: {
          items: [
            {
              id: 'mcp-1',
              name: 'MCP One',
              description: 'MCP description',
              isActive: true
            }
          ]
        },
        isLoading: false
      }
    }
    return { data: { items: [] }, isLoading: false }
  })
  useMutationMock.mockImplementation((method: string, path: string) => {
    if (method === 'PATCH' && path.startsWith('/assistants/')) {
      return { trigger: updateAssistantMock, isLoading: false, error: undefined }
    }
    if (method === 'PATCH' && path.startsWith('/agents/')) {
      return { trigger: updateAgentMock, isLoading: false, error: undefined }
    }
    return { trigger: vi.fn(), isLoading: false, error: undefined }
  })
  updateAssistantMock.mockResolvedValue({ ...ASSISTANT, name: 'Updated Assistant' })
  updateAgentMock.mockResolvedValue({ ...AGENT, instructions: 'Updated instructions' })
  ensureTagsMock.mockResolvedValue([{ id: 'tag-work', name: 'work', color: '#8b5cf6' }])
  fetchGenerateMock.mockResolvedValue('Generated prompt')
  openSettingsWindowMock.mockResolvedValue('settings-window')
  toggleSkillMock.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function selectTab(name: string) {
  const tab = screen.getByRole('tab', { name })
  fireEvent.pointerDown(tab, { button: 0, ctrlKey: false })
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
  fireEvent.click(tab)
  fireEvent.keyDown(tab, { key: 'Enter', code: 'Enter' })
}

function expandToolsMenu() {
  const toolsButton = screen.getByRole('button', { name: 'Tools' })
  if (toolsButton.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(toolsButton)
  }
}

function expectHelpTrigger(label: string, description: string) {
  expect(screen.getByRole('button', { name: `${label} Help` })).toBeInTheDocument()
  expect(screen.queryByText(description)).not.toBeInTheDocument()
}

async function expectVariablesHelpOnHover() {
  const trigger = screen.getByRole('button', { name: 'System variables' })
  expect(trigger).toHaveClass('size-4')
  fireEvent.pointerMove(trigger, { pointerType: 'mouse' })
  await waitFor(() => {
    expect(
      screen.getAllByText(
        'Insert these system variables into the system prompt; before each assistant reply, they are filled with the current information.'
      )
    ).not.toHaveLength(0)
  })
  expect(screen.getAllByText('Example: Today is {{date}}, and the current date is used.')).not.toHaveLength(0)
  await waitFor(() => expect(screen.getAllByText('{{date}}').length).toBeGreaterThan(0))
}

function openTagCombobox() {
  const removeTagButton = screen.getByRole('button', { name: 'Remove work' })
  const combobox = removeTagButton.closest('[role="combobox"]')
  if (!combobox) {
    throw new Error('Tag combobox trigger not found')
  }
  fireEvent.click(combobox)
}

describe('edit dialogs', () => {
  it('submits assistant name, description, and model changes as a PATCH', async () => {
    const onSaved = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated Assistant' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated assistant description' } })
    const modelTrigger = screen.getByRole('button', { name: 'Model' })
    expect(modelTrigger).toHaveClass('h-8', 'rounded-md', 'border-input', 'bg-background')
    expect(screen.getByText(/Old Model/)).toBeInTheDocument()
    fireEvent.click(modelTrigger)
    fireEvent.click(screen.getByRole('button', { name: 'Pick model' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          name: 'Updated Assistant',
          description: 'Updated assistant description',
          modelId: MODEL.id
        })
      })
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('shows the clear model affordance beside the chevron and clears the selected model', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    const modelTrigger = screen.getByRole('button', { name: 'Model' })
    const clearButton = screen.getByRole('button', { name: 'Model Clear' })

    expect(modelTrigger).toHaveClass('hover:bg-background')
    expect(modelTrigger).not.toHaveClass('pr-7')
    expect(clearButton).toHaveClass('right-1.5', 'rounded-full', 'bg-transparent', 'hover:bg-muted', 'opacity-0')

    fireEvent.click(clearButton)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          modelId: null
        })
      })
    )
  })

  it('submits assistant tag changes through ensureTags', async () => {
    ensureTagsMock.mockResolvedValueOnce([
      { id: 'tag-work', name: 'work', color: '#8b5cf6' },
      { id: 'tag-personal', name: 'personal', color: '#10b981' }
    ])
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    openTagCombobox()
    fireEvent.click(await screen.findByText('personal'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(ensureTagsMock).toHaveBeenCalledWith(['work', 'personal']))
    expect(updateAssistantMock).toHaveBeenCalledWith({
      body: expect.objectContaining({
        tagIds: ['tag-work', 'tag-personal']
      })
    })
  })

  it('creates and binds a new tag typed in assistant editing', async () => {
    ensureTagsMock.mockResolvedValueOnce([
      { id: 'tag-work', name: 'work', color: '#8b5cf6' },
      { id: 'tag-new', name: 'new-tag', color: '#10b981' }
    ])
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    openTagCombobox()
    fireEvent.change(screen.getByPlaceholderText('Search tags'), { target: { value: 'new-tag' } })
    fireEvent.click(await screen.findByText('new-tag'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(ensureTagsMock).toHaveBeenCalledWith(['work', 'new-tag']))
    expect(updateAssistantMock).toHaveBeenCalledWith({
      body: expect.objectContaining({
        tagIds: ['tag-work', 'tag-new']
      })
    })
  })

  it('does not expose typed tag names beyond the server-side max length', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)
    // Open the combobox popover (CommandInput only mounts once the trigger is active)
    openTagCombobox()
    const atLimit = 'y'.repeat(64) // TagNameSchema.max(64)
    const tooLong = 'x'.repeat(65) // one over the limit — server would reject
    const searchInput = screen.getByPlaceholderText('Search tags')

    fireEvent.change(searchInput, { target: { value: tooLong } })
    expect(screen.queryByText(tooLong)).not.toBeInTheDocument()

    fireEvent.change(searchInput, { target: { value: atLimit } })
    expect(await screen.findByText(atLimit)).toBeInTheDocument()
  })

  it('submits agent instructions and model changes as a PATCH', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    selectTab('Prompt')
    await expectVariablesHelpOnHover()
    expect(screen.getByText('Instructions')).toBeInTheDocument()
    const instructionsInput = screen.getByLabelText('Prompt editor')
    expect(instructionsInput).toHaveAttribute('placeholder', 'Tell this agent how to work')
    expect(instructionsInput).toHaveStyle({
      minHeight: EDIT_DIALOG_PROMPT_MIN_HEIGHT,
      maxHeight: EDIT_DIALOG_PROMPT_MAX_HEIGHT
    })
    fireEvent.change(instructionsInput, { target: { value: 'Updated instructions' } })
    selectTab('Basic')
    fireEvent.click(screen.getByRole('button', { name: 'Model' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick model' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          model: MODEL.id,
          instructions: 'Updated instructions'
        })
      })
    )
  })

  it('keeps MCP catalog rows compact without detail text', async () => {
    mcpStatusState.current = {
      'mcp-command-only': { state: 'connected', lastCheckedAt: 1 }
    }
    useQueryMock.mockImplementation((path: string) => {
      if (path === '/mcp-servers') {
        return {
          data: {
            items: [
              {
                id: 'mcp-command-only',
                name: '@cherry/mcp-auto-install',
                description: 'Installs MCP servers automatically',
                baseUrl: 'https://mcp.example.com',
                command: 'npx',
                isActive: true
              }
            ]
          },
          isLoading: false
        }
      }
      return { data: { items: [] }, isLoading: false }
    })

    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    expandToolsMenu()
    selectTab('MCP')

    expect(await screen.findByText('@cherry/mcp-auto-install')).toBeInTheDocument()
    expect(screen.queryByText('Installs MCP servers automatically')).not.toBeInTheDocument()
    expect(screen.queryByText('https://mcp.example.com')).not.toBeInTheDocument()
    expect(screen.queryByText('npx')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '@cherry/mcp-auto-install' })).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('submits assistant knowledge, MCP, and model parameter changes', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.queryByRole('tab', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-expanded', 'false')
    expandToolsMenu()
    expect(screen.getByRole('tab', { name: 'MCP' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Knowledge' })).toBeInTheDocument()

    selectTab('Knowledge')
    await waitFor(() => expect(screen.getByText('Linked knowledge')).toBeVisible())
    expectHelpTrigger('Linked knowledge', 'Choose knowledge bases.')
    const addKnowledgeButton = screen.getByRole('button', { name: 'Add knowledge base' })
    expect(addKnowledgeButton).toHaveClass('w-fit')
    fireEvent.click(addKnowledgeButton)
    expect(screen.getByText('Knowledge One')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Knowledge One'))
    expect(screen.getByText('Knowledge One').closest('.group')).toHaveClass('rounded-md')
    expect(screen.getByRole('button', { name: 'Remove knowledge base' })).toHaveClass('rounded-md')

    selectTab('MCP')
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Enable MCP' })).toBeVisible())
    expect(screen.queryByRole('button', { name: 'Add MCP server' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox', { name: 'MCP Mode' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('switch', { name: 'MCP One' }))

    selectTab('Model configuration')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Temperature Help' })).toBeVisible())
    expectHelpTrigger('Temperature', 'Controls randomness.')
    expectHelpTrigger('Top-P', 'Controls nucleus sampling.')
    expectHelpTrigger('Max tokens', 'Caps response length.')
    expectHelpTrigger('Stream output', 'Stream responses.')
    expectHelpTrigger('Max tool calls', 'Caps tool loops.')
    expectHelpTrigger('Custom parameters', 'Extra provider parameters.')
    fireEvent.click(screen.getByRole('switch', { name: 'Temperature' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          knowledgeBaseIds: ['kb-1'],
          mcpServerIds: ['mcp-1'],
          settings: expect.objectContaining({
            enableTemperature: true,
            mcpMode: 'manual'
          })
        })
      })
    )
  })

  it('generates and restores assistant prompts inside the dialog', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    selectTab('Prompt')
    await expectVariablesHelpOnHover()
    fireEvent.click(screen.getByRole('button', { name: 'Generate prompt' }))

    await waitFor(() => expect(screen.getByLabelText('Prompt editor')).toHaveValue('Generated prompt'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(screen.getByLabelText('Prompt editor')).toHaveValue('Original prompt')
  })

  it('shows a toast when assistant prompt generation fails', async () => {
    fetchGenerateMock.mockRejectedValueOnce(new Error('Model failed'))

    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    selectTab('Prompt')
    fireEvent.click(screen.getByRole('button', { name: 'Generate prompt' }))

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith({
        description: 'Check or change the default model, then try again.',
        title: 'Failed to generate prompt'
      })
    )
    expect(screen.getByLabelText('Prompt editor')).toHaveValue('Original prompt')
    expect(fetchGenerateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Original prompt',
        throwOnError: true
      })
    )
  })

  it('shows a toast when assistant prompt generation returns no response', async () => {
    fetchGenerateMock.mockResolvedValueOnce('')

    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    selectTab('Prompt')
    fireEvent.click(screen.getByRole('button', { name: 'Generate prompt' }))

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith({
        description: 'Check or change the default model, then try again.',
        title: 'Failed to generate prompt'
      })
    )
    expect(screen.getByLabelText('Prompt editor')).toHaveValue('Original prompt')
  })

  it('submits agent permission defaults and advanced changes', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.queryByRole('tab', { name: 'Permission' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox', { name: 'Permission mode' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Plan Mode' }))

    selectTab('Advanced')
    expect(screen.queryByText('Max turns')).not.toBeInTheDocument()
    expectHelpTrigger('Environment variables', 'One KEY=VALUE per line')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'FOO=bar' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalled())
    const body = vi.mocked(updateAgentMock).mock.calls[0][0].body
    expect(body).not.toHaveProperty('allowedTools')
    expect(body).toEqual(
      expect.objectContaining({
        configuration: expect.not.objectContaining({ max_turns: expect.anything() })
      })
    )
    expect(body.configuration).toEqual(
      expect.objectContaining({
        env_vars: { FOO: 'bar' },
        permission_mode: 'plan'
      })
    )
  })

  it('hides permission mode while autonomous mode is enabled', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'Permission mode' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Autonomous mode' }))

    expect(screen.queryByRole('combobox', { name: 'Permission mode' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          configuration: expect.objectContaining({
            permission_mode: 'bypassPermissions',
            soul_enabled: true
          })
        })
      })
    )
  })

  it('uses the left tools submenu to switch agent tool categories', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.queryByRole('tab', { name: 'Tools' })).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-expanded', 'false')
    expandToolsMenu()
    expect(screen.getByRole('tab', { name: 'Built-in tools' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByText('No built-in tools enabled')).not.toBeInTheDocument()

    selectTab('Built-in tools')
    expect(screen.getByRole('tab', { name: 'Built-in tools' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Read')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
    expect(screen.getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('tab', { name: 'Built-in tools' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
    selectTab('MCP')
    expect(screen.getByText('MCP One')).toBeInTheDocument()

    selectTab('Skills')
    expect(screen.getByText('Skill One')).toBeInTheDocument()
  })

  it('uses the same MCP server list presentation in assistant and agent editing', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    expandToolsMenu()
    selectTab('MCP')
    fireEvent.click(screen.getByRole('combobox', { name: 'MCP Mode' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Manual' }))

    expect(screen.getByText('MCP services')).toBeInTheDocument()
    expect(screen.getByText('MCP One')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'MCP services Settings' }))
    expect(openSettingsWindowMock).toHaveBeenCalledWith('/settings/mcp/servers')

    cleanup()
    openSettingsWindowMock.mockClear()

    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    expandToolsMenu()
    selectTab('MCP')

    expect(screen.getByText('MCP services')).toBeInTheDocument()
    expect(screen.getByText('MCP One')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'MCP services Settings' }))
    expect(openSettingsWindowMock).toHaveBeenCalledWith('/settings/mcp/servers')
  })

  it('keeps popover content inside the dialog container', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    const dialog = screen.getByRole('dialog')
    fireEvent.click(screen.getByLabelText('Pick avatar'))

    expect(dialog).toContainElement(screen.getByRole('button', { name: 'Choose emoji' }))
  })

  it('keeps edited values while switching tabs before save', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft Agent' } })
    selectTab('Prompt')
    selectTab('Basic')

    expect(screen.getByLabelText('Name')).toHaveValue('Draft Agent')
  })

  it('keeps the dialog open and shows an error when save fails', async () => {
    updateAssistantMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} onSaved={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Broken Assistant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('does not show a save error when the post-save callback fails', async () => {
    const onOpenChange = vi.fn()
    const onSaved = vi.fn().mockRejectedValue(new Error('Refresh failed'))
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Saved Assistant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateAssistantMock).toHaveBeenCalled())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(screen.queryByText('Save failed')).not.toBeInTheDocument()
  })

  it('closes after a successful save', async () => {
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} onSaved={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated Assistant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
