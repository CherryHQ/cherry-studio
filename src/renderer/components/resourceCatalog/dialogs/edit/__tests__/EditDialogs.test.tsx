import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { useState } from 'react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'
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
  mcpStatusState: { current: {} as Record<string, { state: string; lastCheckedAt: number }> },
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
  return {
    ...actual,
    useTranslation: () => ({
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
          'agent.tools.builtin.read.description': 'Read files',
          'agent.tools.builtin.read.label': 'Read files',
          'library.config.agent.model_config': 'Model',
          'library.config.basic.field.description.hint': 'Short assistant summary.',
          'library.config.basic.field.description.placeholder': 'Describe this assistant',
          'library.config.basic.context_management': 'Customize context management',
          'library.config.basic.context_inherited': 'Following the global settings',
          'library.config.basic.context_count': 'Recent messages kept',
          'library.config.basic.context_truncate_threshold': 'Tool-output truncation threshold',
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
        (typeof fallbackOrOptions === 'string' ? fallbackOrOptions : undefined) ??
        key
    })
  }
})

import { PromptBindingTab } from '../../components/PromptBindingTab'
import { AgentEditDialog } from '../AgentEditDialog'
import { AssistantEditDialog } from '../AssistantEditDialog'

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
      return { trigger: updateAssistantMock, isLoading: false, error: undefined }
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
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

describe('edit dialogs', () => {
  it('binds a prompt to the assistant being edited', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Prompts')
    expect(within(screen.getByRole('tabpanel', { name: 'Prompts' })).getByText('Prompts')).toBeInTheDocument()
    expect(useQueryMock).toHaveBeenCalledWith('/prompts', { enabled: true, query: { visibility: 'restricted' } })
    expect(useQueryMock).toHaveBeenCalledWith('/prompt-bindings/:targetType/:targetId', {
      enabled: true,
      params: { targetType: 'assistant', targetId: ASSISTANT.id }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Bind prompt' }))
    fireEvent.click(await screen.findByText('Reusable prompt'))

    await waitFor(() =>
      expect(bindPromptMock).toHaveBeenCalledWith({
        params: {
          id: '00000000-0000-4000-8000-000000000001',
          targetType: 'assistant',
          targetId: ASSISTANT.id
        }
      })
    )
    expect(unbindPromptMock).not.toHaveBeenCalled()
  })

  it('unbinds a prompt from the agent being edited', async () => {
    const user = userEvent.setup()
    promptCatalogState.current.bound = [...promptCatalogState.current.all]
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    selectTab('Prompts')
    expect(screen.getByText('Reusable prompt')).toBeInTheDocument()
    const removeButton = screen.getByRole('button', { name: 'Remove prompt Reusable prompt' })
    await user.hover(removeButton)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Remove prompt Reusable prompt')
    await user.click(removeButton)

    await waitFor(() =>
      expect(unbindPromptMock).toHaveBeenCalledWith({
        params: {
          id: '00000000-0000-4000-8000-000000000001',
          targetType: 'agent',
          targetId: AGENT.id
        }
      })
    )
    expect(bindPromptMock).not.toHaveBeenCalled()
  })

  it('keeps a new target binding locked when the previous target request settles', async () => {
    const previousBinding = createDeferred<void>()
    const currentBinding = createDeferred<void>()
    bindPromptMock.mockReturnValueOnce(previousBinding.promise).mockReturnValueOnce(currentBinding.promise)
    const { rerender } = render(<PromptBindingTab enabled target={{ type: 'assistant', id: 'assistant-old' }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Bind prompt' }))
    fireEvent.click(await screen.findByText('Reusable prompt'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bind prompt' })).toBeDisabled())

    rerender(<PromptBindingTab enabled target={{ type: 'assistant', id: 'assistant-new' }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bind prompt' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Bind prompt' }))
    fireEvent.click(await screen.findByText('Reusable prompt'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bind prompt' })).toBeDisabled())

    await act(async () => {
      previousBinding.resolve(undefined)
      await previousBinding.promise
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: 'Bind prompt' })).toBeDisabled()

    await act(async () => {
      currentBinding.resolve(undefined)
      await currentBinding.promise
    })
  })

  it('creates a selected prompt and binds it to the assistant being edited', async () => {
    const user = userEvent.setup()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Prompts')
    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    const createDialog = screen.getByRole('dialog', { name: 'Add prompt' })
    await user.type(within(createDialog).getByLabelText('Title'), 'Created prompt')
    await user.type(within(createDialog).getByLabelText('Prompt editor'), 'Created prompt content')
    await user.click(within(createDialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(createPromptMock).toHaveBeenCalledWith({
        body: {
          title: 'Created prompt',
          content: 'Created prompt content',
          visibility: 'restricted',
          bindingTarget: { type: 'assistant', id: ASSISTANT.id }
        }
      })
    )
  })

  it('creates a global prompt without binding it to the assistant being edited', async () => {
    const user = userEvent.setup()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Prompts')
    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    const createDialog = screen.getByRole('dialog', { name: 'Add prompt' })
    await user.type(within(createDialog).getByLabelText('Title'), 'Global prompt')
    await user.type(within(createDialog).getByLabelText('Prompt editor'), 'Global prompt content')
    await user.click(within(createDialog).getByRole('switch', { name: 'Use globally' }))
    await user.click(within(createDialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(createPromptMock).toHaveBeenCalledWith({
        body: {
          title: 'Global prompt',
          content: 'Global prompt content',
          visibility: 'global'
        }
      })
    )
  })

  it('disables prompt visibility while a create request is pending', async () => {
    const user = userEvent.setup()
    const pendingCreate = createDeferred<void>()
    createPromptMock.mockReturnValueOnce(pendingCreate.promise)
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Prompts')
    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    const createDialog = screen.getByRole('dialog', { name: 'Add prompt' })
    await user.type(within(createDialog).getByLabelText('Title'), 'Pending prompt')
    await user.type(within(createDialog).getByLabelText('Prompt editor'), 'Pending prompt content')
    await user.click(within(createDialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(within(createDialog).getByRole('switch', { name: 'Use globally' })).toBeDisabled()
    })

    await act(async () => {
      pendingCreate.resolve(undefined)
      await pendingCreate.promise
    })
  })

  it('submits assistant name, description, and model changes as a PATCH', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated Assistant' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated assistant description' } })
    const modelTrigger = screen.getByRole('button', { name: 'Model' })
    expect(modelTrigger).toHaveTextContent('Old Model')
    expect(modelTrigger).not.toHaveTextContent('Provider')
    fireEvent.click(modelTrigger)
    fireEvent.click(screen.getByRole('button', { name: 'Pick model' }))
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          name: 'Updated Assistant',
          description: 'Updated assistant description',
          modelId: MODEL.id
        })
      })
    )
  })

  it('shows the clear model affordance beside the chevron and clears the selected model', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    const modelTrigger = screen.getByRole('button', { name: 'Model' })
    const clearButton = screen.getByRole('button', { name: 'Model Clear' })

    expect(modelTrigger).toBeInTheDocument()

    fireEvent.click(clearButton)
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          modelId: null
        })
      })
    )
  })

  it('submits assistant group changes directly', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    openGroupSelect()
    fireEvent.click(await screen.findByRole('option', { name: 'personal' }))
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          groupId: 'group-personal'
        })
      })
    )
  })

  it('creates and selects an assistant group from the group field', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    openGroupSelect()
    fireEvent.click(await screen.findByRole('option', { name: 'New Group' }))

    const createDialog = screen.getByRole('dialog', { name: 'New Group' })
    fireEvent.change(within(createDialog).getByLabelText('Name'), { target: { value: '  created  ' } })
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(createGroupMock).toHaveBeenCalledWith('created'))
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          groupId: 'group-created'
        })
      })
    )
  })

  it('clears the assistant group from the single-select group field', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    const clearButton = screen.getByRole('button', { name: 'Group Clear' })
    fireEvent.click(clearButton)
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          groupId: null
        })
      })
    )
  })

  it('keeps assistant grouping single-select while exposing the shared create action', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    openGroupSelect()
    expect(screen.queryByPlaceholderText('Search groups')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'No group' })).not.toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'New Group' })).toBeInTheDocument()
  })

  it('closes the group selector without closing the assistant edit dialog when clicking elsewhere inside it', async () => {
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    openGroupSelect()
    await screen.findByRole('option', { name: 'personal' })
    fireEvent.pointerDown(screen.getByLabelText('Name'))
    fireEvent.click(screen.getByLabelText('Name'))

    await waitFor(() => expect(screen.queryByRole('option', { name: 'personal' })).not.toBeInTheDocument())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('submits agent instructions and model changes as a PATCH', async () => {
    promptProcessorMock.mockImplementation(({ prompt, modelName }: { prompt: string; modelName?: string }) =>
      prompt.replaceAll('{{model_name}}', modelName ?? '')
    )
    render(
      <AgentEditDialog
        open
        resource={{ ...AGENT, instructions: 'Original instructions {{model_name}}' }}
        onOpenChange={vi.fn()}
      />
    )

    selectTab('System Prompt')
    expect(screen.getByRole('button', { name: 'System variables' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('tabpanel', { name: 'System Prompt' })).getByText('System Prompt')
    ).toBeInTheDocument()
    const instructionsInput = screen.getByLabelText('Prompt editor')
    expect(instructionsInput).toHaveAttribute('placeholder', 'Tell this assistant how to respond')
    expect(screen.getByLabelText('Prompt preview')).toHaveTextContent('Original instructions Old Model')
    expect(promptProcessorMock).toHaveBeenLastCalledWith({
      prompt: 'Original instructions {{model_name}}',
      modelName: 'Old Model'
    })
    fireEvent.change(instructionsInput, { target: { value: 'Updated instructions {{model_name}}' } })
    selectTab('Basic')
    const modelTrigger = screen.getByRole('button', { name: 'Model' })
    expect(modelTrigger).toHaveTextContent('Old Model')
    expect(modelTrigger).not.toHaveTextContent('Provider')
    fireEvent.click(modelTrigger)
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick model' })[0])
    selectTab('System Prompt')
    await waitFor(() =>
      expect(screen.getByLabelText('Prompt preview')).toHaveTextContent('Updated instructions Updated Model')
    )
    expect(promptProcessorMock).toHaveBeenLastCalledWith({
      prompt: 'Updated instructions {{model_name}}',
      modelName: 'Updated Model'
    })
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          model: MODEL.id,
          instructions: 'Updated instructions {{model_name}}'
        })
      })
    )
  })

  it('does not turn externally refreshed agent fields into stale PATCH values', async () => {
    const props = { open: true, onOpenChange: vi.fn() }
    const { rerender } = render(<AgentEditDialog {...props} resource={AGENT} />)

    rerender(
      <AgentEditDialog
        {...props}
        resource={{
          ...AGENT,
          configuration: { ...AGENT.configuration, permission_mode: 'plan' }
        }}
      />
    )
    fireEvent.change(screen.getByLabelText('Avatar and name'), { target: { value: 'Locally renamed' } })

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: { name: 'Locally renamed' }
      })
    )
  })

  it('advances the agent form baseline before a queued follow-up save', async () => {
    let resolveFirstSave: (() => void) | undefined
    updateAgentMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = () => resolve({ ...AGENT, name: 'First edit' })
        })
    )
    const onOpenChange = vi.fn()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Avatar and name'), { target: { value: 'First edit' } })
    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Second edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    resolveFirstSave?.()

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(2))
    expect(updateAgentMock.mock.calls[1][0]).toEqual({
      body: { description: 'Second edit' }
    })
  })

  it('preserves skill baseline initialization while an unrelated save is pending', async () => {
    installedSkillsState.current = {
      ...installedSkillsState.current,
      refreshing: true
    }
    let resolveFirstSave: (() => void) | undefined
    updateAgentMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = () => resolve({ ...AGENT, name: 'First edit' })
        })
    )
    const props = { open: true, resource: AGENT, onOpenChange: vi.fn() }
    const { rerender } = render(<AgentEditDialog {...props} />)

    fireEvent.change(screen.getByLabelText('Avatar and name'), { target: { value: 'First edit' } })
    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(1))

    installedSkillsState.current = {
      ...installedSkillsState.current,
      skills: installedSkillsState.current.skills.map((skill) => ({ ...skill, isEnabled: true })),
      refreshing: false
    }
    rerender(<AgentEditDialog {...props} />)
    selectTab('技能')
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Skill One' })).toBeChecked()
      expect(screen.getByRole('switch', { name: 'Skill One' })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('switch', { name: 'Skill One' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    resolveFirstSave?.()

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(2))
    expect(updateAgentMock.mock.calls[1][0]).toEqual({
      body: { skillUpdates: [{ skillId: 'skill-1', isEnabled: false }] }
    })
  })

  it('polishes agent instructions and auto-saves the polished value', async () => {
    fetchGenerateMock.mockResolvedValue('Polished agent instructions')
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    selectTab('System Prompt')
    fireEvent.click(screen.getByRole('button', { name: 'Polish prompt' }))

    await waitFor(() => expect(screen.getByLabelText('Prompt editor')).toHaveValue('Polished agent instructions'))
    expect(fetchGenerateMock).toHaveBeenCalledWith({
      prompt: expect.stringContaining('Improve the supplied system prompt without changing its intent or authority.'),
      content: 'Original instructions',
      throwOnError: true
    })

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({ instructions: 'Polished agent instructions' })
      })
    )
  })

  it('generates agent instructions from the agent name when instructions are blank', async () => {
    fetchGenerateMock.mockResolvedValue('Generated agent instructions')
    render(<AgentEditDialog open resource={{ ...AGENT, instructions: '' }} onOpenChange={vi.fn()} />)

    selectTab('System Prompt')
    expect(screen.getByTestId('prompt-preview-reset-key')).toHaveTextContent('0')
    const generateButton = screen.getByRole('button', { name: 'Generate prompt' })
    expect(generateButton).toBeEnabled()
    fireEvent.click(generateButton)

    await waitFor(() =>
      expect(fetchGenerateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('You are a Prompt Generator.'),
          content: 'Alpha Agent',
          throwOnError: true
        })
      )
    )
    expect(screen.getByLabelText('Prompt editor')).toHaveValue('Generated agent instructions')
    expect(screen.getByTestId('prompt-preview-reset-key')).toHaveTextContent('1')
  })

  it('allows closing and tab navigation while an agent prompt action is in flight', async () => {
    fetchGenerateMock.mockReturnValueOnce(new Promise<string>(() => undefined))
    const onOpenChange = vi.fn()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} />)

    selectTab('System Prompt')
    fireEvent.click(screen.getByRole('button', { name: 'Polish prompt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    selectTab('Basic')

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.getByRole('tab', { name: 'Basic' })).toHaveAttribute('aria-selected', 'true')
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
      if (path === '/prompts' || path.startsWith('/prompt-bindings/')) {
        return { data: [], isLoading: false, refetch: vi.fn() }
      }
      return { data: { items: [] }, isLoading: false }
    })

    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    selectTab('MCP')

    expect(await screen.findByText('@cherry/mcp-auto-install')).toBeInTheDocument()
    expect(screen.queryByText('Installs MCP servers automatically')).not.toBeInTheDocument()
    expect(screen.queryByText('https://mcp.example.com')).not.toBeInTheDocument()
    expect(screen.queryByText('npx')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '@cherry/mcp-auto-install' })).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('submits assistant knowledge, MCP, and model parameter changes', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'MCP' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Knowledge' })).toBeInTheDocument()

    selectTab('Knowledge')
    await waitFor(() => expect(screen.getByText('Linked knowledge')).toBeVisible())
    expectHelpTrigger('Linked knowledge', 'Choose knowledge bases.')
    const addKnowledgeButton = screen.getByRole('button', { name: 'Add knowledge base' })
    fireEvent.click(addKnowledgeButton)
    expect(screen.getByText('Knowledge One')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Knowledge One'))

    selectTab('MCP')
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'MCP Mode' })).toBeVisible())
    expect(screen.queryByRole('button', { name: 'Add MCP server' })).not.toBeInTheDocument()
    const mcpModeGroup = screen.getByRole('radiogroup', { name: 'MCP Mode' })
    expect(within(mcpModeGroup).getByRole('radio', { name: 'Disabled' })).toHaveAttribute('aria-checked', 'false')
    expect(within(mcpModeGroup).getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(mcpModeGroup).getByRole('radio', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('switch', { name: 'MCP One' }))

    selectTab('Model')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Temperature Help' })).toBeVisible())
    expectHelpTrigger('Temperature', 'Controls randomness.')
    expectHelpTrigger('Top-P', 'Controls nucleus sampling.')
    expectHelpTrigger('Max tokens', 'Caps response length.')
    expectHelpTrigger('Stream output', 'Stream responses.')
    expectHelpTrigger('Max tool call rounds', 'Caps tool-call rounds at 100.')
    expectHelpTrigger('Custom parameters', 'Extra provider parameters.')
    fireEvent.click(screen.getByRole('switch', { name: 'Temperature' }))
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

  it('names custom parameter value inputs for screen-reader users', async () => {
    render(
      <AssistantEditDialog
        open
        resource={{
          ...ASSISTANT,
          settings: {
            ...ASSISTANT.settings,
            customParameters: [
              { name: 'stop', type: 'string', value: 'END' },
              { name: '', type: 'number', value: 0 }
            ]
          }
        }}
        onOpenChange={vi.fn()}
      />
    )

    selectTab('Model')

    expect(await screen.findByRole('textbox', { name: 'Parameter value: stop' })).toHaveValue('END')
    expect(screen.getByRole('spinbutton', { name: 'Parameter value' })).toHaveValue(0)
  })

  it('names the context override for what it does and states what is inherited while off', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Model')

    // The switch overrides the globals — it does not turn context management
    // off, so it must not be named after the feature.
    const overrideSwitch = await screen.findByRole('switch', { name: 'Customize context management' })
    expect(overrideSwitch).not.toBeChecked()
    expect(screen.getByText('Following the global settings')).toBeVisible()
    // Offload/compression fields belong to the override and stay hidden…
    expect(screen.queryByLabelText('Tool-output truncation threshold')).not.toBeInTheDocument()

    fireEvent.click(overrideSwitch)

    expect(await screen.findByLabelText('Tool-output truncation threshold')).toBeInTheDocument()
    expect(screen.queryByText('Following the global settings')).not.toBeInTheDocument()
  })

  it('keeps the message limit outside the override, since scope is not an overflow policy', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Model')

    // …while the scope control is reachable with the override off.
    const overrideSwitch = await screen.findByRole('switch', { name: 'Customize context management' })
    expect(overrideSwitch).not.toBeChecked()
    expect(screen.getByLabelText('Recent messages kept')).toBeInTheDocument()
  })

  it('expresses "no message limit" as an empty named field rather than a second switch', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Model')

    const input = await screen.findByLabelText('Recent messages kept')
    // No stored override → unlimited, shown as an empty field with a placeholder.
    expect(input).toHaveValue(null)
    expect(input).toHaveAttribute('placeholder', 'Unlimited')
    // The limit is one control, not a switch plus a number.
    expect(screen.queryByRole('switch', { name: 'Recent messages kept' })).not.toBeInTheDocument()

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)
    expect(input).toHaveValue(5)
  })

  it('repairs invalid legacy max tokens when enabling the limit', async () => {
    render(
      <AssistantEditDialog
        open
        resource={{
          ...ASSISTANT,
          settings: { ...ASSISTANT.settings, maxTokens: 0, enableMaxTokens: false }
        }}
        onOpenChange={vi.fn()}
      />
    )

    selectTab('Model')
    fireEvent.click(await screen.findByRole('switch', { name: 'Max tokens' }))

    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: {
          settings: {
            maxTokens: 4096,
            enableMaxTokens: true
          }
        }
      })
    )
  })

  it('shows the default tool-call cap and clamps custom rounds at 1000', async () => {
    render(
      <AssistantEditDialog
        open
        resource={{
          ...ASSISTANT,
          settings: {
            ...ASSISTANT.settings,
            enableMaxToolCalls: false
          }
        }}
        onOpenChange={vi.fn()}
      />
    )

    selectTab('Model')
    const maxToolCallsSwitch = await screen.findByRole('switch', { name: 'Max tool call rounds' })

    expect(maxToolCallsSwitch).not.toBeChecked()
    expect(screen.getByText('Default (100 rounds)')).toBeVisible()

    fireEvent.click(maxToolCallsSwitch)
    const maxToolCallsInput = await screen.findByDisplayValue('20')
    expect(maxToolCallsInput).toHaveAttribute('min', '1')
    expect(maxToolCallsInput).toHaveAttribute('max', '1000')

    fireEvent.focus(maxToolCallsInput)
    fireEvent.change(maxToolCallsInput, { target: { value: '1001' } })
    fireEvent.blur(maxToolCallsInput)

    expect(maxToolCallsInput).toHaveValue(1000)
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          settings: expect.objectContaining({
            enableMaxToolCalls: true,
            maxToolCalls: 1000
          })
        })
      })
    )
  })

  it('polishes and restores assistant prompts through the shared action', async () => {
    fetchGenerateMock.mockResolvedValueOnce('Polished assistant prompt')
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('System Prompt')
    await expectVariablesHelpOnOpen()
    const polishButton = screen.getByRole('button', { name: 'Polish prompt' })
    expect(screen.getByTestId('prompt-preview-reset-key')).toHaveTextContent('0')
    fireEvent.click(polishButton)

    await waitFor(() => expect(screen.getByLabelText('Prompt editor')).toHaveValue('Polished assistant prompt'))
    expect(fetchGenerateMock).toHaveBeenCalledWith({
      prompt: expect.stringContaining('Improve the supplied system prompt without changing its intent or authority.'),
      content: 'Original prompt',
      throwOnError: true
    })
    expect(screen.getByTestId('prompt-preview-reset-key')).toHaveTextContent('1')

    const undoButton = screen.getByRole('button', { name: 'Undo' })
    fireEvent.click(undoButton)

    expect(screen.getByLabelText('Prompt editor')).toHaveValue('Original prompt')
    expect(screen.getByTestId('prompt-preview-reset-key')).toHaveTextContent('2')
  })

  it('generates an assistant prompt from its name when the prompt is blank', async () => {
    render(<AssistantEditDialog open resource={{ ...ASSISTANT, prompt: '' }} onOpenChange={vi.fn()} />)

    selectTab('System Prompt')
    const generateButton = screen.getByRole('button', { name: 'Generate prompt' })
    fireEvent.click(generateButton)

    await waitFor(() => expect(screen.getByLabelText('Prompt editor')).toHaveValue('Generated prompt'))
    expect(fetchGenerateMock).toHaveBeenCalledWith({
      prompt: expect.stringContaining('You are a Prompt Generator.'),
      content: 'Alpha Assistant',
      throwOnError: true
    })
    expect(fetchGenerateMock.mock.calls[0][0].prompt).not.toContain(
      'Create a useful system prompt from the supplied name or title.'
    )
    expect(screen.getByRole('button', { name: 'Polish prompt' })).toBeInTheDocument()
  })

  it('allows closing and tab navigation while an assistant prompt action is in flight', async () => {
    fetchGenerateMock.mockReturnValueOnce(new Promise<string>(() => undefined))
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    selectTab('System Prompt')
    fireEvent.click(screen.getByRole('button', { name: 'Polish prompt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    selectTab('Basic')

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.getByRole('tab', { name: 'Basic' })).toHaveAttribute('aria-selected', 'true')
  })

  it('submits agent permission defaults and advanced changes', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('tab', { name: 'Permission' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox', { name: 'Permission mode' }))
    // Name matches loosely: each option renders its title and its description.
    fireEvent.click(await screen.findByRole('option', { name: /Plan Only/ }))

    selectTab('Advanced')
    expectHelpTrigger('Environment variables', 'One KEY=VALUE per line')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'FOO=bar' } })

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalled())
    const body = vi.mocked(updateAgentMock).mock.calls[0][0].body
    expect(body).not.toHaveProperty('allowedTools')
    expect(body.configuration).toEqual(
      expect.objectContaining({
        env_vars: { FOO: 'bar' },
        permission_mode: 'plan'
      })
    )
  })

  it('shows agent tool categories directly in the left tab list', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Built-in tools' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByText('No built-in tools enabled')).not.toBeInTheDocument()

    selectTab('Built-in tools')
    expect(screen.getByRole('tab', { name: 'Built-in tools' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Read')).toBeInTheDocument()

    selectTab('MCP')
    expect(screen.getByText('MCP One')).toBeInTheDocument()

    selectTab('技能')
    expect(screen.getByText('Skill One')).toBeInTheDocument()
  })

  it('projects pi capabilities without exposing Claude-only fields', async () => {
    render(<AgentEditDialog open resource={PI_AGENT} onOpenChange={vi.fn()} />)

    expect(screen.queryByText('Plan model')).not.toBeInTheDocument()
    expect(screen.queryByText('Small model')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Knowledge' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'MCP' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '技能' })).toBeInTheDocument()

    selectTab('Built-in tools')
    expect(screen.getByRole('switch', { name: 'Read files' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Run shell commands' }))

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({ body: expect.objectContaining({ disabledTools: ['bash'] }) })
    )
  })

  it('removes deleted knowledge bases from an open agent form', async () => {
    const boundAgent = { ...AGENT, knowledgeBaseIds: ['kb-1'] }
    const { rerender } = render(<AgentEditDialog open resource={boundAgent} onOpenChange={vi.fn()} />)

    selectTab('Built-in tools')
    expect(screen.getByText('Knowledge Search')).toBeInTheDocument()

    knowledgeBasesState.current = []
    rerender(<AgentEditDialog open resource={{ ...boundAgent, knowledgeBaseIds: [] }} onOpenChange={vi.fn()} />)

    await waitFor(() => expect(screen.queryByText('Knowledge Search')).not.toBeInTheDocument())
    expect(updateAgentMock).not.toHaveBeenCalled()
  })

  it('preserves a knowledge-base re-selection made while its removal is saving', async () => {
    let resolveFirstSave: (() => void) | undefined
    updateAgentMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = () => resolve({ ...AGENT, knowledgeBaseIds: [] })
        })
    )
    const boundAgent = { ...AGENT, knowledgeBaseIds: ['kb-1'] }
    const props = { open: true, onOpenChange: vi.fn(), initialTab: 'tools.knowledge' }
    const { rerender } = render(<AgentEditDialog {...props} resource={boundAgent} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove knowledge base' }))
    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Add knowledge base' }))
    fireEvent.click(screen.getByText('Knowledge One'))
    rerender(<AgentEditDialog {...props} resource={{ ...boundAgent, knowledgeBaseIds: [] }} />)

    selectTab('Built-in tools')
    expect(screen.getByText('Knowledge Search')).toBeInTheDocument()

    resolveFirstSave?.()
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenLastCalledWith({
        body: expect.objectContaining({ knowledgeBaseIds: ['kb-1'] })
      })
    )
  })

  it('opens the agent edit dialog directly on the requested initial tab', () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="tools.skills" />)

    expect(screen.getByRole('tab', { name: '技能' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Skill One')).toBeInTheDocument()
  })

  it('opens Skill settings in an app tab without closing the agent edit dialog', () => {
    const onOpenChange = vi.fn()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} />)

    selectTab('技能')

    const manageSkillsButton = screen.getByRole('button', { name: 'Manage Skills' })

    fireEvent.click(manageSkillsButton)

    expect(openSettingsTabMock).toHaveBeenCalledWith('/settings/skills')
    expect(ipcRequestMock).not.toHaveBeenCalledWith('tab.detach', expect.anything())
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('reuses the shared skill catalog in the agent edit dialog', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="tools.skills" />)

    await waitFor(() =>
      expect(skillCatalogPickerMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          mode: 'edit',
          skills: installedSkillsState.current.skills,
          loading: false,
          selectedIds: [],
          disabled: false
        })
      )
    )
    expect(screen.getByTestId('skill-catalog-picker')).toHaveAttribute('data-mode', 'edit')
  })

  it('waits for background skill refresh before initializing the editable baseline', async () => {
    installedSkillsState.current = {
      ...installedSkillsState.current,
      refreshing: true
    }
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} initialTab="tools.skills" />
    )

    expect(screen.getByText('Skill One')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Skill One' })).toBeDisabled()

    installedSkillsState.current = {
      ...installedSkillsState.current,
      skills: installedSkillsState.current.skills.map((skill) => ({ ...skill, isEnabled: true })),
      refreshing: false
    }
    rerender(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} initialTab="tools.skills" />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Skill One' })).toBeChecked()
      expect(screen.getByRole('switch', { name: 'Skill One' })).toBeEnabled()
    })
    expect(updateAgentMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('switch', { name: 'Skill One' }))

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          skillUpdates: [{ skillId: 'skill-1', isEnabled: false }]
        })
      })
    )
  })

  it('restores a globally re-enabled persisted skill without overwriting local or hidden selections', async () => {
    const hiddenSkill = {
      id: 'skill-hidden',
      name: 'Hidden Skill',
      description: 'Hidden while globally disabled',
      isEnabled: true
    }
    const localSkill = {
      id: 'skill-local',
      name: 'Local Edit Skill',
      description: 'Changed in this dialog',
      isEnabled: false
    }
    const reenabledSkill = {
      id: 'skill-reenabled',
      name: 'Re-enabled Skill',
      description: 'Disabled when the dialog opened',
      isEnabled: true
    }
    installedSkillsState.current = {
      skills: [hiddenSkill, localSkill],
      loading: false,
      refreshing: false
    }
    const props = { open: true, resource: AGENT, onOpenChange: vi.fn(), initialTab: 'tools.skills' as const }
    const { rerender } = render(<AgentEditDialog {...props} />)

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Hidden Skill' })).toBeChecked())

    installedSkillsState.current = {
      ...installedSkillsState.current,
      skills: [localSkill]
    }
    rerender(<AgentEditDialog {...props} />)
    expect(screen.queryByRole('switch', { name: 'Hidden Skill' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Local Edit Skill' }))

    installedSkillsState.current = {
      ...installedSkillsState.current,
      skills: [hiddenSkill, localSkill, reenabledSkill]
    }
    rerender(<AgentEditDialog {...props} />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Hidden Skill' })).toBeChecked()
      expect(screen.getByRole('switch', { name: 'Local Edit Skill' })).toBeChecked()
      expect(screen.getByRole('switch', { name: 'Re-enabled Skill' })).toBeChecked()
    })
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenNthCalledWith(1, {
        body: { skillUpdates: [{ skillId: 'skill-local', isEnabled: true }] }
      })
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Re-enabled Skill' }))

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenNthCalledWith(2, {
        body: { skillUpdates: [{ skillId: 'skill-reenabled', isEnabled: false }] }
      })
    )
  })

  it('opens the assistant edit dialog directly on the requested initial tab', () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} initialTab="tools.mcp" />)

    expect(screen.getByRole('tab', { name: 'MCP' })).toHaveAttribute('aria-selected', 'true')
  })

  it('auto-saves agent skill toggles after a debounce', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    selectTab('技能')

    fireEvent.click(screen.getByRole('switch', { name: 'Skill One' }))
    // Not persisted synchronously — the debounce is still pending.
    expect(updateAgentMock).not.toHaveBeenCalled()

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          skillUpdates: [{ skillId: 'skill-1', isEnabled: true }]
        })
      })
    )
  })

  it('uses the same MCP server list presentation in assistant and agent editing', async () => {
    const onAssistantOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onAssistantOpenChange} />)

    selectTab('MCP')
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'MCP Mode' })).getByRole('radio', { name: 'Manual' }))

    expect(screen.getByText('MCP services')).toBeInTheDocument()
    expect(screen.getByText('MCP One')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'MCP services Settings' }))
    expect(openSettingsTabMock).toHaveBeenCalledWith('/settings/mcp/servers')
    expect(onAssistantOpenChange).not.toHaveBeenCalled()

    cleanup()
    openSettingsTabMock.mockClear()
    const onAgentOpenChange = vi.fn()

    render(<AgentEditDialog open resource={AGENT} onOpenChange={onAgentOpenChange} />)

    selectTab('MCP')

    expect(screen.getByText('MCP services')).toBeInTheDocument()
    expect(screen.getByText('MCP One')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'MCP services Settings' }))
    expect(openSettingsTabMock).toHaveBeenCalledWith('/settings/mcp/servers')
    expect(onAgentOpenChange).not.toHaveBeenCalled()
  })

  it('closes the assistant edit dialog before running model settings navigation on the next frame', async () => {
    function Host() {
      const [open, setOpen] = useState(true)
      const [target, setTarget] = useState<Assistant | null>(ASSISTANT)

      const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen)
        if (!nextOpen) setTarget(null)
      }

      return <AssistantEditDialog open={open} resource={target} onOpenChange={handleOpenChange} />
    }

    render(<Host />)
    const frames = mockDeferredAnimationFrames()

    fireEvent.click(screen.getByRole('button', { name: 'Open model settings' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(settingsNavigateMock).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
    })
    expect(frames.pendingCount()).toBeGreaterThan(0)
    frames.flushAllFrames()

    expect(settingsNavigateMock).toHaveBeenCalledTimes(1)
    frames.restore()
  })

  it('closes the agent edit dialog before running model settings navigation on the next frame', async () => {
    function Host() {
      const [open, setOpen] = useState(true)
      const [target, setTarget] = useState<AgentDetail | null>(AGENT)

      const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen)
        if (!nextOpen) setTarget(null)
      }

      return <AgentEditDialog open={open} resource={target} onOpenChange={handleOpenChange} />
    }

    render(<Host />)
    const frames = mockDeferredAnimationFrames()

    fireEvent.click(screen.getAllByRole('button', { name: 'Open model settings' })[0])

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(settingsNavigateMock).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
    })
    expect(frames.pendingCount()).toBeGreaterThan(0)
    frames.flushAllFrames()

    expect(settingsNavigateMock).toHaveBeenCalledTimes(1)
    frames.restore()
  })

  it('keeps popover content inside the dialog container', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    const dialog = screen.getByRole('dialog')
    fireEvent.click(screen.getByLabelText('Pick avatar'))

    expect(dialog).toContainElement(screen.getByRole('button', { name: 'Choose emoji' }))
  })

  it('keeps edited values while switching tabs before save', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Avatar and name'), { target: { value: 'Draft Agent' } })
    selectTab('System Prompt')
    selectTab('Basic')

    expect(screen.getByLabelText('Avatar and name')).toHaveValue('Draft Agent')
  })

  it('shows the immutable runtime guidance without requiring hover or focus', () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    expect(screen.getByText('Cannot be changed after creation')).toBeVisible()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows an auto-save error and still allows the dialog to close', async () => {
    updateAssistantMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    const nameInput = screen.getByLabelText('Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Broken Assistant')
    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('Save failed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the dialog open after a successful auto-save', async () => {
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Saved Assistant' } })
    await waitFor(() => expect(updateAssistantMock).toHaveBeenCalled())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.queryByText('Save failed')).not.toBeInTheDocument()
  })

  it('flushes a pending change and closes when the dialog is closed', async () => {
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated Assistant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({ name: 'Updated Assistant' })
      })
    )
    // The close now awaits the flush and only closes once it settles.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('persists the latest edit made while an earlier save is still in flight', async () => {
    let resolveFirstSave: (() => void) | undefined
    updateAssistantMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = () => resolve({ ...ASSISTANT, name: 'First Edit' })
        })
    )
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    const nameInput = screen.getByLabelText('Name')
    fireEvent.change(nameInput, { target: { value: 'First Edit' } })
    await waitFor(() => expect(updateAssistantMock).toHaveBeenCalledTimes(1))
    expect(updateAssistantMock).toHaveBeenNthCalledWith(1, {
      body: expect.objectContaining({ name: 'First Edit' })
    })

    // Keep editing while the first PATCH is still in flight.
    fireEvent.change(nameInput, { target: { value: 'Second Edit' } })
    // Let the debounce fire; the in-flight guard must queue — not drop — this edit.
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(updateAssistantMock).toHaveBeenCalledTimes(1)

    resolveFirstSave?.()
    await waitFor(() => expect(updateAssistantMock).toHaveBeenCalledTimes(2))
    expect(updateAssistantMock).toHaveBeenNthCalledWith(2, {
      body: expect.objectContaining({ name: 'Second Edit' })
    })
  })

  it('allows discarding an unchanged failed assistant save without retrying it', async () => {
    updateAssistantMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    const nameInput = screen.getByLabelText('Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Closing Edit')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('Save failed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    const saveAttemptsAfterFailure = updateAssistantMock.mock.calls.length

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(updateAssistantMock).toHaveBeenCalledTimes(saveAttemptsAfterFailure)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('retries saving when the form changes after a failed close', async () => {
    updateAssistantMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    const nameInput = screen.getByLabelText('Name')
    fireEvent.change(nameInput, { target: { value: 'First Closing Edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await screen.findByText('Save failed', undefined, { timeout: 5000 })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    const saveAttemptsAfterFailure = updateAssistantMock.mock.calls.length

    fireEvent.change(nameInput, { target: { value: 'Retry Closing Edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(updateAssistantMock.mock.calls.length).toBeGreaterThan(saveAttemptsAfterFailure))
    expect(updateAssistantMock).toHaveBeenLastCalledWith({
      body: expect.objectContaining({ name: 'Retry Closing Edit' })
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('clears the failed assistant save snapshot when reopened within the exit-animation window', async () => {
    // The host (useResourceCatalogController) keeps this dialog instance mounted for
    // DIALOG_EXIT_ANIMATION_MS after `open` goes false, so a reopen within that window
    // reuses the SAME component instance instead of remounting — simulate that with
    // `rerender` rather than a fresh `render`.
    updateAssistantMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    const { rerender } = render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Repro Edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await screen.findByText('Save failed', undefined, { timeout: 5000 })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    // Simulate an external close, then reopen on the same instance before it unmounts.
    rerender(<AssistantEditDialog open={false} resource={ASSISTANT} onOpenChange={onOpenChange} />)
    rerender(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)
    const saveAttemptsBeforeRetry = updateAssistantMock.mock.calls.length

    // Make the exact same edit again. The new editing session must not mistake it
    // for the prior session's failed snapshot and block the save.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Repro Edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(updateAssistantMock.mock.calls.length).toBeGreaterThan(saveAttemptsBeforeRetry)
    expect(updateAssistantMock).toHaveBeenLastCalledWith({
      body: expect.objectContaining({ name: 'Repro Edit' })
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('reuses the in-flight save when closing mid-save instead of racing a second one', async () => {
    let resolveSave: (() => void) | undefined
    updateAssistantMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = () => resolve({ ...ASSISTANT, name: 'Mid Save' })
        })
    )
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mid Save' } })
    await waitFor(() => expect(updateAssistantMock).toHaveBeenCalledTimes(1))

    // Close while that save is still in flight: no second concurrent save, and the
    // dialog must not close until the in-flight save settles.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(updateAssistantMock).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    resolveSave?.()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(updateAssistantMock).toHaveBeenCalledTimes(1)
  })

  it('allows discarding an unchanged failed agent save without retrying it', async () => {
    updateAgentMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} />)

    const nameInput = screen.getByLabelText('Avatar and name')
    fireEvent.change(nameInput, { target: { value: 'Closing Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('Save failed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    const saveAttemptsAfterFailure = updateAgentMock.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(updateAgentMock).toHaveBeenCalledTimes(saveAttemptsAfterFailure)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('retries saving the agent when the form changes after a failed close', async () => {
    updateAgentMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} />)

    const nameInput = screen.getByLabelText('Avatar and name')
    fireEvent.change(nameInput, { target: { value: 'Closing Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await screen.findByText('Save failed', undefined, { timeout: 5000 })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    const saveAttemptsAfterFailure = updateAgentMock.mock.calls.length

    fireEvent.change(nameInput, { target: { value: 'Retry Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(updateAgentMock.mock.calls.length).toBeGreaterThan(saveAttemptsAfterFailure))
    expect(updateAgentMock).toHaveBeenLastCalledWith({
      body: expect.objectContaining({ name: 'Retry Agent' })
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
