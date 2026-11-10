vi.mock('@renderer/components/cherryCloud/CherryCloudModelSelector', async () => {
  const selector = await import('@renderer/components/ModelSelector')
  return {
    CherryCloudModelSelector: selector.ModelSelector
  }
})

import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, expect, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { AgentDetail } from '@renderer/types/resourceCatalog'
import type { Assistant } from '@shared/data/types/assistant'

const {
  bindPromptMock,
  applyReorderedListMock,
  boundPromptsRefetchMock,
  createPromptMock,
  createGroupMock,
  fetchGenerateMock,
  invalidateCacheMock,
  installedSkillsState,
  ipcRequestMock,
  knowledgeBasesState,
  mcpStatusState,
  openSettingsTabMock,
  promptCatalogState,
  promptProcessorMock,
  settingsNavigateMock,
  skillCatalogPickerMock,
  updateAgentMock,
  updateAssistantMock,
  unbindPromptMock,
  useMutationMock,
  useQueryMock
} = vi.hoisted(() => ({
  bindPromptMock: vi.fn(),
  applyReorderedListMock: vi.fn(),
  boundPromptsRefetchMock: vi.fn(),
  createPromptMock: vi.fn(),
  createGroupMock: vi.fn(),
  fetchGenerateMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
  installedSkillsState: {
    current: {
      skills: [
        {
          id: 'skill-1',
          name: 'Skill One',
          description: 'Skill description',
          isEnabled: false
        }
      ],
      loading: false,
      refreshing: false
    }
  },
  ipcRequestMock: vi.fn(),
  knowledgeBasesState: {
    current: [
      {
        id: 'kb-1',
        name: 'Knowledge One',
        itemCount: 3
      }
    ]
  },
  mcpStatusState: { current: {} },
  openSettingsTabMock: vi.fn(),
  promptCatalogState: {
    current: {
      all: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          title: 'Reusable prompt',
          content: 'Reusable prompt content',
          visibility: 'restricted' as const,
          orderKey: 'a0',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z'
        }
      ],
      bound: [] as Array<{
        id: string
        title: string
        content: string
        visibility: 'global' | 'restricted'
        orderKey: string
        createdAt: string
        updatedAt: string
      }>
    }
  },
  promptProcessorMock: vi.fn(({ prompt }: { prompt: string }) => prompt),
  settingsNavigateMock: vi.fn(),
  skillCatalogPickerMock: vi.fn(),
  updateAgentMock: vi.fn(),
  updateAssistantMock: vi.fn(),
  unbindPromptMock: vi.fn(),
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

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({
    trigger,
    onSelect,
    onSettingsNavigate
  }: {
    trigger: ReactNode
    onSelect: (modelId: string | undefined) => void
    onSettingsNavigate?: (navigate: () => void) => void
  }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onSelect(MODEL.id)}>
        Pick model
      </button>
      <button type="button" onClick={() => onSettingsNavigate?.(settingsNavigateMock)}>
        Open model settings
      </button>
    </div>
  )
}))

vi.mock('@data/hooks/useReorder', () => ({
  useReorder: () => ({ applyReorderedList: applyReorderedListMock, isPending: false })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

vi.mock('@renderer/components/EmojiPicker', () => ({
  EmojiPicker: ({ onEmojiClick }: { onEmojiClick: (emoji: string) => void }) => (
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
    previewValue,
    resetPreviewKey,
    minHeight,
    maxHeight
  }: {
    actions?: ReactNode
    label?: ReactNode
    labelAddon?: ReactNode
    value: string
    onChange: (value: string) => void
    placeholder?: string
    previewValue?: string
    resetPreviewKey?: number
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
      <output aria-label="Prompt preview">{previewValue}</output>
      <output data-testid="prompt-preview-reset-key">{resetPreviewKey}</output>
    </div>
  )
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/skill', () => ({
  SkillCatalogPicker: (props: {
    mode: 'create' | 'edit'
    skills: Array<{ id: string; name: string }>
    loading: boolean
    selectedIds: readonly string[]
    disabled?: boolean
    onSelectedIdsChange: (ids: string[]) => void
    trailingItem?: ReactNode
  }) => {
    skillCatalogPickerMock(props)

    return (
      <div data-testid="skill-catalog-picker" data-mode={props.mode} className="grid sm:grid-cols-2">
        {props.loading
          ? null
          : props.skills.map((skill) => {
              const selected = props.selectedIds.includes(skill.id)
              return (
                <button
                  key={skill.id}
                  type="button"
                  role="switch"
                  aria-checked={selected}
                  disabled={props.disabled}
                  onClick={() =>
                    props.onSelectedIdsChange(
                      selected
                        ? props.selectedIds.filter((selectedId) => selectedId !== skill.id)
                        : [...props.selectedIds, skill.id]
                    )
                  }>
                  {skill.name}
                </button>
              )
            })}
        {props.trailingItem}
      </div>
    )
  }
}))

vi.mock('@renderer/hooks/useGroups', () => ({
  useGroups: () => ({
    groups: [
      {
        id: 'group-work',
        entityType: 'assistant',
        name: 'work',
        orderKey: 'a0',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      },
      {
        id: 'group-personal',
        entityType: 'assistant',
        name: 'personal',
        orderKey: 'a1',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      }
    ]
  }),
  useGroupMutations: () => ({
    createGroup: createGroupMock
  })
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useDataChange: vi.fn(),
  useInvalidateCache: () => invalidateCacheMock,
  useInfiniteFlatItems: (pages: Array<{ items: unknown[] }> = []) => pages.flatMap((page) => page.items),
  useInfiniteQuery: () => ({
    pages: [{ items: knowledgeBasesState.current, total: knowledgeBasesState.current.length }],
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    hasNext: false,
    loadNext: vi.fn(),
    refresh: vi.fn()
  }),
  useMutation: useMutationMock,
  useQuery: useQueryMock
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatusMap: () => mcpStatusState.current
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock }
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useReconcileSkillsOnOpen: vi.fn(),
  useInstalledSkills: () => ({
    ...installedSkillsState.current,
    refresh: vi.fn()
  })
}))

vi.mock('@renderer/hooks/usePromptProcessor', () => ({
  usePromptProcessor: promptProcessorMock
}))

vi.mock('@renderer/utils/aiGeneration', () => ({
  fetchGenerate: fetchGenerateMock
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: openSettingsTabMock
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()
  const { createInstance } = await import('i18next')
  const { default: translations } = await import('@renderer/i18n/locales/en-us.json')
  const memoryI18n = createInstance()
  await memoryI18n.init({ lng: 'en', resources: { en: { translation: translations } }, keySeparator: false })
  return {
    ...actual,
    useTranslation: () => ({
      i18n: memoryI18n,
      // Second arg is a fallback string OR an interpolation options object;
      // an object resolves to the mapped value / key, never to itself.
      t: (key: string, fallbackOrOptions?: string | Record<string, unknown>) =>
        ({
          'agent.settings.tooling.preapproved.autoBadge': 'Added by mode',
          'agent.settings.tooling.preapproved.autoDisabledTooltip': 'Added by {{mode}}',
          // Permission-mode titles intentionally absent: they fall through to the card
          // definitions' own fallbacks, so copy changes need no edit here.
          'agent.settings.skills.addMore': 'Manage Skills',
          'common.avatar': 'Avatar',
          'common.add': 'Add',
          'common.cancel': 'Cancel',
          'common.more': 'More',
          'common.clear': 'Clear',
          'common.close': 'Close',
          'common.confirm': 'Confirm',
          'common.delete': 'Delete',
          'common.description': 'Description',
          'common.edit': 'Edit',
          'common.help': 'Help',
          'common.group.create': 'New Group',
          'common.group.create_failed': 'Failed to create group',
          'common.group.name_placeholder': 'Enter group name...',
          'common.group.name_required': 'Group name is required',
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
          'agent.tasks.timeout.label': 'Maximum Execution Time',
          'agent.tasks.intervalUnit': 'minutes',
          'library.config.agent.field.heartbeat_enabled.label': 'Heartbeat',
          'library.config.agent.field.heartbeat_interval.label': 'Heartbeat interval',
          'library.config.agent.field.model.hint': 'Primary agent model.',
          'library.config.agent.field.model.hint.claude_code': 'Pins the opus alias (ANTHROPIC_MODEL).',
          'library.config.agent.field.model.label': 'Model',
          'library.config.agent.field.model.label.claude_code': 'Model (Opus)',
          'library.config.agent.field.name.hint': 'Shown in the selector.',
          'library.config.agent.field.name.label': 'Name',
          'library.config.agent.field.name.placeholder': 'Name this agent',
          'library.config.agent.field.plan_model.hint': 'Plan model.',
          'library.config.agent.field.plan_model.label': 'Plan model',
          'library.config.agent.field.small_model.hint': 'Small model.',
          'library.config.agent.field.small_model.label': 'Small model',
          'library.config.agent.field.env_vars.help': 'One KEY=VALUE per line',
          'library.config.agent.field.env_vars.label': 'Environment variables',
          'library.config.agent.field.env_vars.placeholder': 'KEY=value\nANOTHER_KEY=another_value',
          'library.config.agent.field.permission_mode.label': 'Permission mode',
          'library.config.agent.field.runtime.immutable_hint': 'Cannot be changed after creation',
          'library.config.agent.section.permission.desc': 'Permission options.',
          'library.config.agent.section.permission.title': 'Permission',
          'library.config.agent.section.tools.add': 'Add',
          'library.config.agent.section.tools.no_builtin_enabled': 'No built-in tools enabled',
          'library.config.agent.section.tools.no_mcp_bound': 'No MCP servers bound',
          'library.config.agent.section.tools.no_skills_enabled': 'No skills enabled',
          'library.config.agent.section.tools.search_placeholder': 'Search tools',
          'library.config.agent.section.tools.skills_require_save': 'Save before skills',
          'library.config.agent.section.tools.tab.mcp': 'MCP',
          'library.config.agent.section.tools.tab.skills': '技能',
          'library.config.agent.section.tools.tab.tools': 'Built-in tools',
          'agent.tools.builtin.bash.description': 'Run shell commands',
          'agent.tools.builtin.bash.label': 'Run shell commands',
          'agent.tools.builtin.codemode.label': 'Code Mode',
          'agent.tools.builtin.read.description': 'Read files',
          'agent.tools.builtin.read.label': 'Read files',
          'library.config.agent.model_config': 'Model',
          'library.config.basic.field.description.hint': 'Short assistant summary.',
          'library.config.basic.field.description.placeholder': 'Describe this assistant',
          'library.config.basic.context_management': 'Customize context management',
          'library.config.basic.context_inherited': 'Following the global settings',
          'library.config.basic.context_count': 'Recent messages kept',
          'library.config.basic.context_truncate_threshold': 'Tool-output truncation threshold',
          'library.config.basic.context_compress_enabled': 'Compress the context when it fills up',
          'library.config.basic.context_compress_threshold': 'Compression trigger threshold',
          'library.config.basic.context_count_unlimited': 'Unlimited',
          'library.config.basic.custom_params': 'Custom parameters',
          'library.config.basic.custom_params_add': 'Add parameter',
          'library.config.basic.custom_params_name': 'Parameter name',
          'library.config.basic.custom_params_value': 'Parameter value',
          'library.config.basic.default_value': 'Model default',
          'library.config.basic.field.model.hint': 'Default chat model.',
          'library.config.basic.field.name.hint': 'Shown in the selector.',
          'library.config.basic.field.name.placeholder': 'Name this assistant',
          'library.config.basic.field.tags.hint': 'Group related assistants.',
          'library.config.basic.field.custom_params.hint': 'Extra provider parameters.',
          'library.config.basic.field.max_tokens.hint': 'Caps response length.',
          'library.config.basic.field.max_tool_calls.hint': 'Caps tool-call rounds at 1000.',
          'library.config.basic.field.stream_output.hint': 'Stream responses.',
          'library.config.basic.field.temperature.hint': 'Controls randomness.',
          'library.config.basic.field.top_p.hint': 'Controls nucleus sampling.',
          'library.config.basic.creative': 'Creative',
          'library.config.basic.json_invalid': 'Invalid JSON',
          'library.config.basic.max_tokens': 'Max tokens',
          'library.config.basic.max_tool_calls': 'Max tool call rounds',
          'library.config.basic.max_tool_calls_default': 'Default (100 rounds)',
          'library.config.basic.model_clear': 'Clear',
          'library.config.basic.model_pick': 'Pick model',
          'library.config.basic.model_not_found': 'Model {{id}} is unavailable.',
          'library.config.basic.precise': 'Precise',
          'library.config.basic.stream_output': 'Stream output',
          'library.config.basic.group': 'Group',
          'library.config.basic.group_empty': 'No groups',
          'library.config.basic.group_placeholder': 'Select group',
          'library.config.basic.tags': 'Tags',
          'library.config.basic.tag_empty': 'No tags',
          'library.config.basic.tag_placeholder': 'Select tag',
          'library.config.basic.tag_search': 'Search tags',
          'library.config.basic.mcp_mode': 'MCP Mode',
          'library.config.basic.temperature': 'Temperature',
          'library.config.basic.top_p': 'Top-P',
          'library.config.dialogs.edit.advanced_tab': 'Advanced',
          'library.config.prompt.label': 'System Prompt',
          'library.config.prompt.placeholder': 'Tell this assistant how to respond',
          'library.config.prompt.dblclick_hint': 'Double-click to edit',
          'library.config.prompt.generate': 'Generate prompt',
          'library.config.prompt.generate_failed_description': 'Check or change the default model, then try again.',
          'library.config.prompt.generate_failed_title': 'Failed to generate prompt',
          'library.config.prompt.polish': 'Polish prompt',
          'library.config.prompt.polish_failed_description': 'Check or change the default model, then try again.',
          'library.config.prompt.polish_failed_title': 'Failed to polish prompt',
          'library.config.prompt.polish_variables_changed_description': 'Prompt variables changed.',
          'library.config.prompt.polish_variables_changed_title': 'Could not apply polished prompt',
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
          'library.config.dialogs.create.avatar_name_label': 'Avatar and name',
          'library.config.dialogs.edit.agent_description': 'Edit the essentials for this agent.',
          'library.config.dialogs.edit.agent_title': 'Edit Agent',
          'library.config.dialogs.edit.assistant_description': 'Edit the essentials for this assistant.',
          'library.config.dialogs.edit.assistant_title': 'Edit Assistant',
          'library.config.dialogs.edit.basic_tab': 'Basic',
          'library.config.dialogs.edit.knowledge_tab': 'Knowledge',
          'library.config.dialogs.edit.permission_tab': 'Permission',
          'library.config.dialogs.edit.prompt_tab': 'System Prompt',
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
          'settings.prompts.add': 'Add prompt',
          'settings.prompts.binding.bind': 'Bind prompt',
          'settings.prompts.binding.noLinked': 'No prompts linked',
          'settings.prompts.binding.noMore': 'No more prompts available',
          'settings.prompts.binding.remove': `Remove prompt ${
            typeof fallbackOrOptions === 'object' && typeof fallbackOrOptions.title === 'string'
              ? fallbackOrOptions.title
              : ''
          }`.trim(),
          'settings.prompts.binding.search': 'Search prompts',
          'settings.prompts.binding.tabTitle': 'Prompts',
          'settings.prompts.binding.globalDescription':
            'Global prompts are available in every conversation and managed in Settings.',
          'settings.prompts.manageGlobal': 'Manage Global Prompts',
          'settings.quickPanel.scope.currentAgent': 'Current Agent',
          'settings.quickPanel.scope.currentAssistant': 'Current Assistant',
          'settings.prompts.contentLabel': 'Content',
          'settings.prompts.contentPlaceholder': 'Enter prompt content',
          'settings.prompts.errors.bindFailed': 'Failed to link prompt',
          'settings.prompts.errors.createFailed': 'Failed to create prompt',
          'settings.prompts.errors.loadFailed': 'Failed to load prompts',
          'settings.prompts.errors.unbindFailed': 'Failed to unlink prompt',
          'settings.prompts.noPrompts': 'No prompts',
          'settings.prompts.titleLabel': 'Title',
          'settings.prompts.titlePlaceholder': 'Enter a title',
          'settings.prompts.variablePlaceholder': '${variable}',
          'settings.prompts.visibility.global.label': 'Use globally',
          'settings.title': 'Settings'
        })[key] ??
        (key.startsWith('agent.memory.')
          ? memoryI18n.t(key, typeof fallbackOrOptions === 'object' ? fallbackOrOptions : {})
          : undefined) ??
        (typeof fallbackOrOptions === 'string' ? fallbackOrOptions : undefined) ??
        key
    })
  }
})

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
    enableGenerateImage: false,
    customParameters: []
  },
  modelId: 'provider::old-model',
  orderKey: 'a0',
  mcpServerIds: [],
  knowledgeBaseIds: [],
  groupId: 'group-work',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
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
    heartbeat_enabled: true,
    heartbeat_interval: 30
  },
  orderKey: 'a0',
  modelName: 'Old Model',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
}

const PI_AGENT: AgentDetail = {
  ...AGENT,
  id: 'pi-agent-1',
  type: 'pi',
  name: 'Pi Agent'
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
  promptProcessorMock.mockReset().mockImplementation(({ prompt }: { prompt: string }) => prompt)
  installedSkillsState.current = {
    skills: [
      {
        id: 'skill-1',
        name: 'Skill One',
        description: 'Skill description',
        isEnabled: false
      }
    ],
    loading: false,
    refreshing: false
  }
  mcpStatusState.current = {
    'mcp-1': { state: 'connected', lastCheckedAt: 1 }
  }
  promptCatalogState.current.bound = []
  boundPromptsRefetchMock.mockResolvedValue(undefined)
  bindPromptMock.mockResolvedValue(undefined)
  createPromptMock.mockResolvedValue(promptCatalogState.current.all[0])
  unbindPromptMock.mockResolvedValue(undefined)
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
          items: knowledgeBasesState.current
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
    if (path === '/prompts') {
      return {
        data: promptCatalogState.current.all,
        isLoading: false,
        refetch: vi.fn()
      }
    }
    if (path.startsWith('/prompt-bindings/')) {
      return {
        data: promptCatalogState.current.bound,
        isLoading: false,
        refetch: boundPromptsRefetchMock
      }
    }
    return { data: { items: [] }, isLoading: false }
  })
  useMutationMock.mockImplementation((method: string, path: string) => {
    if (method === 'POST' && path === '/prompts') {
      return { trigger: createPromptMock, isLoading: false, error: undefined }
    }
    if (method === 'PATCH' && path.startsWith('/assistants/')) {
      return {
        trigger: ({ body }: { body: unknown }) => updateAssistantMock({ body }),
        isLoading: false,
        error: undefined
      }
    }
    if (method === 'PATCH' && path.startsWith('/agents/')) {
      return { trigger: updateAgentMock, isLoading: false, error: undefined }
    }
    if (method === 'PUT' && path === '/prompts/:id/bindings/:targetType/:targetId') {
      return { trigger: bindPromptMock, isLoading: false, error: undefined }
    }
    if (method === 'DELETE' && path === '/prompts/:id/bindings/:targetType/:targetId') {
      return { trigger: unbindPromptMock, isLoading: false, error: undefined }
    }
    return { trigger: vi.fn(), isLoading: false, error: undefined }
  })
  updateAssistantMock.mockResolvedValue({ ...ASSISTANT, name: 'Updated Assistant' })
  createGroupMock.mockResolvedValue({
    id: 'group-created',
    entityType: 'assistant',
    name: 'created',
    orderKey: 'a2',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  })
  updateAgentMock.mockResolvedValue({ ...AGENT, instructions: 'Updated instructions' })
  fetchGenerateMock.mockResolvedValue('Generated prompt')
  knowledgeBasesState.current = [
    {
      id: 'kb-1',
      name: 'Knowledge One',
      itemCount: 3
    }
  ]
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

async function expectVariablesHelpOnOpen() {
  const trigger = screen.getByRole('button', { name: 'System variables' })
  fireEvent.click(trigger)
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

function openGroupSelect() {
  const select = screen.getByRole('combobox', { name: 'Group' })
  fireEvent.pointerDown(select)
  fireEvent.click(select)
}

function mockDeferredAnimationFrames() {
  const callbacks: FrameRequestCallback[] = []
  const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.push(callback)
    return callbacks.length
  })
  const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)

  return {
    pendingCount: () => callbacks.length,
    flushAllFrames: () => {
      while (callbacks.length > 0) {
        const pendingCallbacks = callbacks.splice(0)
        act(() => {
          for (const callback of pendingCallbacks) {
            callback(0)
          }
        })
      }
    },
    restore: () => {
      requestAnimationFrameSpy.mockRestore()
      cancelAnimationFrameSpy.mockRestore()
    }
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}
export {
  bindPromptMock,
  createPromptMock,
  openSettingsTabMock,
  promptCatalogState,
  updateAgentMock,
  updateAssistantMock,
  unbindPromptMock,
  useQueryMock,
  ASSISTANT,
  AGENT,
  selectTab,
  mockDeferredAnimationFrames,
  createDeferred,
  createGroupMock,
  fetchGenerateMock,
  installedSkillsState,
  mcpStatusState,
  promptProcessorMock,
  MODEL,
  expectHelpTrigger,
  openGroupSelect,
  ipcRequestMock,
  knowledgeBasesState,
  settingsNavigateMock,
  skillCatalogPickerMock,
  PI_AGENT,
  expectVariablesHelpOnOpen
}
