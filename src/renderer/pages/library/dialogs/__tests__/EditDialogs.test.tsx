import type * as CherryStudioUi from '@cherrystudio/ui'
import type { AgentDetail } from '@renderer/pages/library/types'
import type { Assistant } from '@shared/data/types/assistant'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { EDIT_DIALOG_PROMPT_MAX_HEIGHT, EDIT_DIALOG_PROMPT_MIN_HEIGHT } from '../edit/EditDialogShared'

const {
  ensureTagsMock,
  fetchGenerateMock,
  toggleSkillMock,
  updateAgentMock,
  updateAssistantMock,
  useMutationMock,
  useQueryMock
} = vi.hoisted(() => ({
  ensureTagsMock: vi.fn(),
  fetchGenerateMock: vi.fn(),
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
    placeholder
  }: {
    actions?: ReactNode
    label?: ReactNode
    labelAddon?: ReactNode
    value: string
    onChange: (value: string) => void
    placeholder?: string
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
    tools: [
      {
        id: 'Read',
        name: 'Read',
        description: 'Read files',
        origin: 'builtin'
      }
    ],
    isLoading: false,
    error: undefined
  })
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatusMap: () => ({})
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

vi.mock('@renderer/services/ApiService', () => ({
  fetchGenerate: fetchGenerateMock
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) =>
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
          'library.config.agent.field.soul_enabled.help': 'Use soul.md.',
          'library.config.agent.field.soul_enabled.label': 'Soul',
          'library.config.agent.field.instructions.label': 'Instructions',
          'library.config.agent.field.instructions.placeholder': 'Tell this agent how to work',
          'library.config.agent.field.env_vars.help': 'One KEY=VALUE per line',
          'library.config.agent.field.env_vars.label': 'Environment variables',
          'library.config.agent.field.env_vars.placeholder': 'KEY=value\nANOTHER_KEY=another_value',
          'library.config.agent.field.max_turns.help': '0 means default',
          'library.config.agent.field.max_turns.label': 'Max turns',
          'library.config.agent.field.permission_mode.label': 'Permission mode',
          'library.config.agent.field.permission_mode.option.acceptEdits': 'Accept edits',
          'library.config.agent.field.permission_mode.option.bypassPermissions': 'Bypass permissions',
          'library.config.agent.field.permission_mode.option.default': 'Default',
          'library.config.agent.field.permission_mode.option.plan': 'Plan mode',
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
          'library.config.prompt.tokens_label': 'Tokens: ',
          'library.config.prompt.variables_title': 'Variables',
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
          'settings.mcp.runtimeStatus.unavailable': 'Unavailable'
        })[key] ?? key
    })
  }
})

import { AgentEditDialog } from '../edit/AgentEditDialog'
import { AssistantEditDialog } from '../edit/AssistantEditDialog'

const ASSISTANT: Assistant = {
  id: 'assistant-1',
  source: 'user',
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
  allowedTools: [],
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
              documentCount: 3
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

function expectHelpTrigger(label: string, description: string) {
  expect(screen.getByRole('button', { name: `${label} Help` })).toBeInTheDocument()
  expect(screen.queryByText(description)).not.toBeInTheDocument()
}

async function expectVariablesHelpOnHover() {
  const trigger = screen.getByRole('button', { name: 'Variables' })
  expect(trigger).toHaveClass('size-4')
  fireEvent.pointerMove(trigger, { pointerType: 'mouse' })
  await waitFor(() => expect(screen.getAllByText('{{date}}').length).toBeGreaterThan(0))
}

describe('edit dialogs', () => {
  it('submits assistant name, description, and model changes as a PATCH', async () => {
    const onSaved = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated Assistant' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated assistant description' } })
    const modelTrigger = screen.getByRole('button', { name: 'Model' })
    expect(modelTrigger).toHaveClass('h-8', 'rounded-md', 'bg-muted/45')
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

  it('submits assistant tag changes through ensureTags', async () => {
    ensureTagsMock.mockResolvedValueOnce([
      { id: 'tag-work', name: 'work', color: '#8b5cf6' },
      { id: 'tag-personal', name: 'personal', color: '#10b981' }
    ])
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'work' }))
    fireEvent.click(await screen.findByText('personal'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(ensureTagsMock).toHaveBeenCalledWith(['work', 'personal']))
    expect(updateAssistantMock).toHaveBeenCalledWith({
      body: expect.objectContaining({
        tagIds: ['tag-work', 'tag-personal']
      })
    })
  })

  it('does not render search or offer free-text tag creation in assistant editing', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'work' }))

    expect(screen.queryByPlaceholderText('Search tags')).not.toBeInTheDocument()
    expect(screen.queryByText('new-tag')).not.toBeInTheDocument()
  })

  it('submits agent instructions and model changes as a PATCH', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    selectTab('Prompt')
    await expectVariablesHelpOnHover()
    const instructionsInput = screen.getByLabelText('Instructions')
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

  it('submits assistant knowledge, MCP, and model parameter changes', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.queryByRole('tab', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-expanded', 'true')
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

  it('submits agent permission, tool, and advanced changes', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.queryByRole('tab', { name: 'Permission' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox', { name: 'Permission mode' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Plan mode' }))

    selectTab('Advanced')
    await waitFor(() => expect(screen.getByText('Max turns')).toBeVisible())
    expectHelpTrigger('Max turns', '0 means default')
    expectHelpTrigger('Environment variables', 'One KEY=VALUE per line')
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } })
    fireEvent.blur(screen.getByRole('spinbutton'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'FOO=bar' } })

    selectTab('Built-in tools')
    await waitFor(() => expect(screen.getByText('Read')).toBeVisible())
    fireEvent.click(screen.getByRole('switch', { name: 'Read' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          allowedTools: ['Read'],
          configuration: expect.objectContaining({
            env_vars: { FOO: 'bar' },
            max_turns: 7,
            permission_mode: 'plan'
          })
        })
      })
    )
  })

  it('uses the left tools submenu to switch agent tool categories', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.queryByRole('tab', { name: 'Tools' })).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-expanded', 'true')
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
