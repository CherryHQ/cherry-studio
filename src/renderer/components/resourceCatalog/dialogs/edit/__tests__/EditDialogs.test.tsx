vi.mock('@renderer/components/cherryCloud/CherryCloudModelSelector', async () => {
  const selector = await import('@renderer/components/ModelSelector')
  return {
    CherryCloudModelSelector: selector.ModelSelector
  }
})

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { useState } from 'react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type * as UseModelModule from '@renderer/hooks/useModel'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { AgentDetail } from '@renderer/types/resourceCatalog'
import { checkEntityImageSize, prepareEntityImageBytes } from '@renderer/utils/image'
import { AGENT_INSTRUCTIONS_SLOT } from '@shared/ai/agentPromptSections'
import type { Assistant } from '@shared/data/types/assistant'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

vi.mock('@renderer/utils/image', () => ({ checkEntityImageSize: vi.fn(() => null), prepareEntityImageBytes: vi.fn() }))
// An upload now opens the crop dialog; the test confirms it with a fixed frame.
const FRAMED = { x: 10, y: 20, width: 64, height: 64 }
vi.mock('@renderer/components/Avatar/AvatarCropPopup', () => ({
  AvatarCropPopup: { show: vi.fn(async () => FRAMED) }
}))
// The real picker's `:has()` styles break jsdom's selector engine for later pointer checks.
vi.mock('@renderer/components/EmojiPicker', () => ({
  EmojiPicker: ({ onEmojiClick }: { onEmojiClick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onEmojiClick('🎓')}>
      Graduation cap
    </button>
  )
}))

const {
  applyReorderedListMock,
  createGroupMock,
  fetchGenerateMock,
  invalidateCacheMock,
  installedSkillsState,
  ipcRequestMock,
  knowledgeBasesState,
  mcpStatusState,
  openSettingsTabMock,
  promptProcessorMock,
  settingsNavigateMock,
  skillCatalogPickerMock,
  updateAgentMock,
  updateAssistantMock,
  useMutationMock,
  useQueryMock
} = vi.hoisted(() => ({
  applyReorderedListMock: vi.fn(),
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
  promptProcessorMock: vi.fn(({ prompt }: { prompt: string }) => prompt),
  settingsNavigateMock: vi.fn(),
  skillCatalogPickerMock: vi.fn(),
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

const DEFAULT_PROMPT_MODEL = vi.hoisted(
  () =>
    ({
      id: 'openai::gpt-4o',
      name: 'GPT-4o',
      providerId: 'openai'
    }) as const
)

const POLISH_PROMPT_BUTTON = 'Polish prompt · GPT-4o'
const GENERATE_PROMPT_BUTTON = 'Generate prompt · GPT-4o'

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
      <button type="button" onClick={() => onSelect('provider::old-model')}>
        Pick original model
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

vi.mock('@renderer/components/PromptEditorField', () => ({
  PromptEditorIconButton: ({
    label,
    disabled,
    onClick
  }: {
    label: string
    disabled?: boolean
    onClick: () => void
  }) => <button type="button" aria-label={label} disabled={disabled} onClick={onClick} />,
  default: ({
    actions,
    inlineActions,
    label,
    labelAddon,
    value,
    onChange,
    placeholder,
    previewValue,
    resetPreviewKey,
    minHeight,
    maxHeight,
    editorLabel,
    error
  }: {
    actions?: ReactNode
    inlineActions?: ReactNode
    label?: ReactNode
    labelAddon?: ReactNode
    value: string
    onChange: (value: string) => void
    placeholder?: string
    previewValue?: string
    resetPreviewKey?: number
    minHeight?: string
    maxHeight?: string
    editorLabel?: string
    error?: string
  }) => (
    <div>
      <div>
        {label}
        {labelAddon}
        {actions}
      </div>
      {inlineActions}
      <textarea
        aria-label={editorLabel ?? 'Prompt editor'}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ minHeight, maxHeight }}
      />
      <output aria-label="Prompt preview">{previewValue}</output>
      <output data-testid="prompt-preview-reset-key">{resetPreviewKey}</output>
      {error ? <p role="alert">{error}</p> : null}
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

vi.mock('@renderer/hooks/useModel', async (importOriginal) => {
  const actual = await importOriginal<typeof UseModelModule>()
  return {
    ...actual,
    useDefaultModel: () => ({ defaultModel: DEFAULT_PROMPT_MODEL })
  }
})

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
          'common.avatar': 'Avatar',
          'common.back': 'Back',
          'library.config.dialogs.create.avatar_upload': 'Image Upload',
          'library.config.dialogs.create.avatar_remove_image': 'Remove image',
          'common.add': 'Add',
          'common.cancel': 'Cancel',
          'common.more': 'More',
          'common.clear': 'Clear',
          'common.close': 'Close',
          'common.confirm': 'Confirm',
          'common.delete': 'Delete',
          'common.description': 'Description',
          'common.discard_changes': 'Discard changes',
          'common.discard_changes_title': 'Discard unsaved changes?',
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
          'library.config.agent.field.language.label': 'Reply language',
          'library.config.agent.field.language.inherit': 'Follow global',
          'library.config.agent.field.language.mode.off': 'No constraint',
          'library.config.agent.field.language.other': 'Other language…',
          'settings.agent.language.custom_label': 'Custom reply language',
          'library.config.agent.field.model.label': 'Model',
          'library.config.agent.field.name.hint': 'Shown in the selector.',
          'library.config.agent.field.name.label': 'Name',
          'library.config.agent.field.name.placeholder': 'Name this agent',
          'library.config.agent.field.env_vars.help': 'One KEY=VALUE per line',
          'library.config.agent.field.env_vars.label': 'Environment variables',
          'library.config.agent.field.env_vars.placeholder': 'KEY=value\nANOTHER_KEY=another_value',
          'library.config.agent.field.permission_mode.label': 'Permission mode',
          'library.config.agent.section.permission.desc': 'Permission options.',
          'library.config.agent.section.permission.title': 'Permission',
          'library.config.agent.section.tools.add': 'Add',
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
          'library.config.basic.temperature': 'Temperature',
          'library.config.basic.top_p': 'Top-P',
          'library.config.dialogs.edit.advanced_tab': 'Advanced',
          'library.config.prompt.label': 'System Prompt',
          'library.config.prompt.placeholder': 'Tell this assistant how to respond',
          'library.config.prompt.dblclick_hint': 'Double-click to edit',
          'library.config.prompt.cancel_with_model': `Cancel · ${
            typeof fallbackOrOptions === 'object' && fallbackOrOptions?.model != null
              ? String(fallbackOrOptions.model)
              : ''
          }`,
          'library.config.prompt.generate': 'Generate prompt',
          'library.config.prompt.generate_failed_description': 'Check or change the default model, then try again.',
          'library.config.prompt.generate_failed_title': 'Failed to generate prompt',
          'library.config.prompt.generate_with_model': `Generate prompt · ${
            typeof fallbackOrOptions === 'object' && fallbackOrOptions?.model != null
              ? String(fallbackOrOptions.model)
              : ''
          }`,
          'library.config.prompt.no_default_model': 'No default model',
          'library.config.prompt.open_default_model_settings': 'Open default model settings',
          'library.config.prompt.polish': 'Polish prompt',
          'library.config.prompt.polish_failed_description': 'Check or change the default model, then try again.',
          'library.config.prompt.polish_failed_title': 'Failed to polish prompt',
          'library.config.prompt.polish_variables_changed_description': 'Prompt variables changed.',
          'library.config.prompt.polish_variables_changed_title': 'Could not apply polished prompt',
          'library.config.prompt.polish_with_model': `Polish prompt · ${
            typeof fallbackOrOptions === 'object' && fallbackOrOptions?.model != null
              ? String(fallbackOrOptions.model)
              : ''
          }`,
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
          'library.config.dialogs.edit.knowledge_tab': 'Knowledge',
          'library.config.dialogs.edit.permission_tab': 'Permission',
          'library.config.dialogs.edit.save_failed': 'Save failed',
          'library.config.dialogs.edit.tools_tab': 'Tools',
          'library.config.knowledge.add': 'Add knowledge base',
          'library.config.knowledge.doc_count': '{{count}} docs',
          'library.config.knowledge.search': 'Search knowledge',
          'library.config.tools.add_mcp': 'Add MCP server',
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
          'settings.scheduledTasks.title': 'Scheduled Tasks',
          'settings.title': 'Settings'
        })[key] ??
        (key.startsWith('agent.memory.') || key.startsWith('library.config.dialogs.edit.')
          ? memoryI18n.t(key, typeof fallbackOrOptions === 'object' ? fallbackOrOptions : {})
          : undefined) ??
        (typeof fallbackOrOptions === 'string' ? fallbackOrOptions : undefined) ??
        key
    })
  }
})

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
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
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
  // The settings page reads the heartbeat document on open; IPC always answers with a promise.
  ipcRequestMock
    .mockReset()
    .mockImplementation(async (route: string) =>
      route === 'agent.system_prompt.preview' ? { blocks: [] } : { content: '' }
    )
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
    if (path === '/agent-channels') {
      return { data: [], isLoading: false, refetch: vi.fn(), mutate: vi.fn() }
    }
    return { data: { items: [] }, isLoading: false }
  })
  useMutationMock.mockImplementation((method: string, path: string) => {
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

/** The model selector's settings link: an action that closes the dialog before navigating. */
function settingsLink() {
  return screen.getByRole('button', { name: 'Open model settings' })
}

/** Opens a settings row's sub-page by the row's label. */
async function openSubPage(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${label}:`) }))
}

async function back(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Back' }))
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

describe('edit dialogs', () => {
  it.each(['agent', 'assistant'] as const)(
    'waits for a pending %s save before navigating to settings',
    async (type) => {
      const user = userEvent.setup()
      const save = createDeferred<AgentDetail | Assistant>()
      const update = type === 'agent' ? updateAgentMock : updateAssistantMock
      update.mockImplementationOnce(() => save.promise)
      function Host() {
        const [open, setOpen] = useState(true)
        return type === 'agent' ? (
          <AgentEditDialog open={open} resource={AGENT} onOpenChange={setOpen} />
        ) : (
          <AssistantEditDialog open={open} resource={ASSISTANT} onOpenChange={setOpen} />
        )
      }
      render(<Host />)
      await user.type(screen.getByLabelText('Name'), ' edited')
      const frames = mockDeferredAnimationFrames()
      try {
        await user.click(settingsLink())
        await waitFor(() => expect(update).toHaveBeenCalled())
        frames.flushAllFrames()
        expect(settingsNavigateMock).not.toHaveBeenCalled()
        expect(screen.getByRole('dialog')).toBeVisible()

        await act(async () => save.resolve(type === 'agent' ? AGENT : ASSISTANT))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        frames.flushAllFrames()
        expect(settingsNavigateMock).toHaveBeenCalled()
      } finally {
        frames.restore()
      }
    }
  )

  it.each([
    ['agent', 'navigation', 'success'],
    ['assistant', 'navigation', 'success'],
    ['agent', 'autosave', 'success'],
    ['assistant', 'autosave', 'success'],
    ['agent', 'navigation', 'failure'],
    ['assistant', 'navigation', 'failure']
  ] as const)(
    'guards reverted %s edits while %s is pending and the reversion ends in %s',
    async (type, source, outcome) => {
      const user = userEvent.setup()
      const firstSave = createDeferred<AgentDetail | Assistant>()
      const revertSave = createDeferred<AgentDetail | Assistant>()
      const update = type === 'agent' ? updateAgentMock : updateAssistantMock
      const resource = type === 'agent' ? AGENT : ASSISTANT
      update.mockImplementationOnce(() => firstSave.promise).mockImplementationOnce(() => revertSave.promise)
      function Host() {
        const [open, setOpen] = useState(true)
        return type === 'agent' ? (
          <AgentEditDialog open={open} resource={AGENT} onOpenChange={setOpen} />
        ) : (
          <AssistantEditDialog open={open} resource={ASSISTANT} onOpenChange={setOpen} />
        )
      }
      render(<Host />)
      await user.clear(screen.getByLabelText('Description'))
      await user.type(screen.getByLabelText('Description'), 'Temporary description')
      if (source === 'navigation') await user.click(settingsLink())
      await waitFor(() => expect(update).toHaveBeenCalled())
      await user.clear(screen.getByLabelText('Description'))
      if (resource.description) await user.type(screen.getByLabelText('Description'), resource.description)
      const frames = mockDeferredAnimationFrames()
      try {
        await user.click(settingsLink())
        frames.flushAllFrames()
        expect(screen.getByRole('dialog')).toBeVisible()
        expect(settingsNavigateMock).not.toHaveBeenCalled()

        await act(async () => firstSave.resolve({ ...resource, description: 'Temporary description' }))
        await waitFor(() =>
          expect(update).toHaveBeenLastCalledWith({
            body: expect.objectContaining({ description: resource.description })
          })
        )
        frames.flushAllFrames()
        expect(screen.getByRole('dialog')).toBeVisible()
        expect(settingsNavigateMock).not.toHaveBeenCalled()

        if (outcome === 'failure') {
          await act(async () => revertSave.reject(new Error('Reversion failed')))
          frames.flushAllFrames()
          expect(screen.getByRole('dialog')).toBeVisible()
          expect(screen.getByText('Save failed')).toBeVisible()
          expect(settingsNavigateMock).not.toHaveBeenCalled()
          await user.click(settingsLink())
          frames.flushAllFrames()
          expect(screen.getByRole('dialog')).toBeVisible()
          expect(settingsNavigateMock).not.toHaveBeenCalled()
          expect(screen.getByLabelText('Description')).toHaveValue(resource.description)
          await user.clear(screen.getByLabelText('Description'))
          await user.type(screen.getByLabelText('Description'), 'Recovered description')
          await user.click(settingsLink())
          expect(update).toHaveBeenLastCalledWith({
            body: expect.objectContaining({ description: 'Recovered description' })
          })
        } else {
          await act(async () => revertSave.resolve(resource))
        }
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        frames.flushAllFrames()
        expect(settingsNavigateMock).toHaveBeenCalled()
      } finally {
        frames.restore()
      }
    }
  )

  it('persists reverted assistant custom parameters before leaving a pending save', async () => {
    const user = userEvent.setup()
    const firstSave = createDeferred<Assistant>()
    const revertSave = createDeferred<Assistant>()
    const resource = {
      ...ASSISTANT,
      settings: { ...ASSISTANT.settings, customParameters: [{ name: 'stop', type: 'string' as const, value: 'END' }] }
    }
    updateAssistantMock.mockImplementationOnce(() => firstSave.promise).mockImplementationOnce(() => revertSave.promise)
    function Host() {
      const [open, setOpen] = useState(true)
      return <AssistantEditDialog open={open} resource={resource} onOpenChange={setOpen} />
    }
    render(<Host />)
    const editParameter = async (value: string) => {
      await openSubPage(user, 'Custom parameters')
      await user.clear(screen.getByRole('textbox', { name: 'Parameter value: stop' }))
      await user.type(screen.getByRole('textbox', { name: 'Parameter value: stop' }), value)
      await back(user)
    }
    await editParameter('TEMP')
    await user.click(settingsLink())
    await waitFor(() => expect(updateAssistantMock).toHaveBeenCalled())
    await editParameter('END')
    const frames = mockDeferredAnimationFrames()
    try {
      await user.click(settingsLink())
      frames.flushAllFrames()
      expect(screen.getByRole('dialog')).toBeVisible()
      expect(settingsNavigateMock).not.toHaveBeenCalled()
      await act(async () => firstSave.resolve(resource))
      await waitFor(() =>
        expect(updateAssistantMock).toHaveBeenLastCalledWith({
          body: { settings: { customParameters: resource.settings.customParameters } }
        })
      )
      frames.flushAllFrames()
      expect(screen.getByRole('dialog')).toBeVisible()
      expect(settingsNavigateMock).not.toHaveBeenCalled()
      await act(async () => revertSave.resolve(resource))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      frames.flushAllFrames()
      expect(settingsNavigateMock).toHaveBeenCalled()
    } finally {
      frames.restore()
    }
  })

  it.each([
    ['agent', ''],
    ['assistant', ''],
    ['agent', 'New name'],
    ['assistant', 'New name']
  ] as const)(
    'preserves newer %s edits with name "%s" made while settings navigation awaits a save',
    async (type, nextName) => {
      const user = userEvent.setup()
      const save = createDeferred<AgentDetail | Assistant>()
      const update = type === 'agent' ? updateAgentMock : updateAssistantMock
      update.mockImplementationOnce(() => save.promise)
      function Host() {
        const [open, setOpen] = useState(true)
        return type === 'agent' ? (
          <AgentEditDialog open={open} resource={AGENT} onOpenChange={setOpen} />
        ) : (
          <AssistantEditDialog open={open} resource={ASSISTANT} onOpenChange={setOpen} />
        )
      }
      render(<Host />)
      await user.clear(screen.getByLabelText('Description'))
      await user.type(screen.getByLabelText('Description'), 'First description')
      const frames = mockDeferredAnimationFrames()
      try {
        await user.click(settingsLink())
        await waitFor(() => expect(update).toHaveBeenCalled())
        const nameInput = screen.getByLabelText('Name')
        await user.clear(nameInput)
        if (nextName) await user.type(nameInput, nextName)
        await user.clear(screen.getByLabelText('Description'))
        await user.type(screen.getByLabelText('Description'), 'Newer description')

        await act(async () => save.resolve(type === 'agent' ? AGENT : ASSISTANT))
        frames.flushAllFrames()
        expect(screen.getByRole('dialog')).toBeVisible()
        expect(nameInput).toHaveValue(nextName)
        expect(screen.getByLabelText('Description')).toHaveValue('Newer description')
        expect(settingsNavigateMock).not.toHaveBeenCalled()

        if (!nextName) await user.type(nameInput, 'Corrected name')
        await user.click(settingsLink())
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        frames.flushAllFrames()
        expect(update).toHaveBeenLastCalledWith({
          body: expect.objectContaining({ name: nextName || 'Corrected name', description: 'Newer description' })
        })
        expect(settingsNavigateMock).toHaveBeenCalled()
      } finally {
        frames.restore()
      }
    }
  )

  it.each(['agent', 'assistant'] as const)(
    'preserves failed %s edits across repeated navigation clicks until a corrected edit saves',
    async (type) => {
      const user = userEvent.setup()
      const save = createDeferred<AgentDetail | Assistant>()
      const update = type === 'agent' ? updateAgentMock : updateAssistantMock
      update.mockImplementationOnce(() => save.promise)
      function Host() {
        const [open, setOpen] = useState(true)
        return type === 'agent' ? (
          <AgentEditDialog open={open} resource={AGENT} onOpenChange={setOpen} />
        ) : (
          <AssistantEditDialog open={open} resource={ASSISTANT} onOpenChange={setOpen} />
        )
      }
      render(<Host />)
      await user.type(screen.getByLabelText('Name'), ' edited')
      const frames = mockDeferredAnimationFrames()
      try {
        await user.click(settingsLink())
        await waitFor(() => expect(update).toHaveBeenCalled())
        await act(async () => save.reject(new Error('Network down')))
        expect(await screen.findByText('Save failed')).toBeVisible()
        frames.flushAllFrames()
        expect(screen.getByRole('dialog')).toBeVisible()
        expect(settingsNavigateMock).not.toHaveBeenCalled()

        for (let attempt = 0; attempt < 2; attempt++) {
          await user.click(settingsLink())
          frames.flushAllFrames()
          expect(screen.getByRole('dialog')).toBeVisible()
          expect(screen.getByText('Save failed')).toBeVisible()
          expect(settingsNavigateMock).not.toHaveBeenCalled()
        }

        const nameInput = screen.getByLabelText('Name')
        expect(nameInput).toHaveValue(`${type === 'agent' ? AGENT.name : ASSISTANT.name} edited`)
        await user.clear(nameInput)
        await user.type(nameInput, 'Corrected edit')
        await user.click(settingsLink())
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        frames.flushAllFrames()
        expect(update).toHaveBeenLastCalledWith({ body: expect.objectContaining({ name: 'Corrected edit' }) })
        expect(settingsNavigateMock).toHaveBeenCalled()
      } finally {
        frames.restore()
      }
    }
  )

  it.each(['agent', 'assistant'] as const)(
    'preserves failed %s edits when the required name is cleared before settings navigation',
    async (type) => {
      const user = userEvent.setup()
      const update = type === 'agent' ? updateAgentMock : updateAssistantMock
      update.mockRejectedValueOnce(new Error('Network down'))
      function Host() {
        const [open, setOpen] = useState(true)
        return type === 'agent' ? (
          <AgentEditDialog open={open} resource={AGENT} onOpenChange={setOpen} />
        ) : (
          <AssistantEditDialog open={open} resource={ASSISTANT} onOpenChange={setOpen} />
        )
      }
      render(<Host />)
      const descriptionInput = screen.getByLabelText('Description')
      await user.clear(descriptionInput)
      await user.type(descriptionInput, 'Unsaved description')
      await user.click(settingsLink())
      expect(await screen.findByText('Save failed')).toBeVisible()

      await user.clear(screen.getByLabelText('Name'))
      const frames = mockDeferredAnimationFrames()
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          await user.click(settingsLink())
          frames.flushAllFrames()
          expect(screen.getByRole('dialog')).toBeVisible()
          expect(screen.getByText('Save failed')).toBeVisible()
          expect(settingsNavigateMock).not.toHaveBeenCalled()
        }

        expect(screen.getByLabelText('Description')).toHaveValue('Unsaved description')
        expect(screen.getByLabelText('Name')).toHaveValue('')
        await user.click(screen.getByRole('button', { name: 'Close' }))
        await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(settingsNavigateMock).not.toHaveBeenCalled()
      } finally {
        frames.restore()
      }
    }
  )

  it('submits assistant name, description, and model changes as a PATCH', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated Assistant' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated assistant description' } })
    const modelTrigger = screen.getByRole('button', { name: 'Model' })
    expect(modelTrigger).toHaveTextContent('Old Model')

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
    for (const [payload] of updateAssistantMock.mock.calls) {
      expect(payload.body).not.toHaveProperty('emoji')
    }
  })

  it('saves avatar changes through IPC without a PATCH on immediate close', async () => {
    const data = new Uint8Array([1, 2, 3])
    vi.mocked(prepareEntityImageBytes).mockResolvedValue(data)
    ipcRequestMock.mockResolvedValue(undefined)
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { rerender } = render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Renamed assistant')
    await waitFor(() => expect(updateAssistantMock).toHaveBeenCalledTimes(1))
    expect(updateAssistantMock.mock.calls[0][0].body).not.toHaveProperty('emoji')
    await user.click(screen.getByRole('button', { name: 'Pick avatar' }))
    const file = new File(['image'], 'avatar.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Image Upload', { selector: 'input' }), file)
    await waitFor(() =>
      expect(ipcRequestMock).toHaveBeenCalledWith('assistant.set_avatar', {
        assistantId: ASSISTANT.id,
        avatar: { kind: 'image', data }
      })
    )
    expect(checkEntityImageSize).toHaveBeenCalledWith(file)
    expect(prepareEntityImageBytes).toHaveBeenCalledWith(file, FRAMED)
    expect(updateAssistantMock).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    rerender(<AssistantEditDialog open={false} resource={ASSISTANT} onOpenChange={onOpenChange} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(updateAssistantMock).toHaveBeenCalledTimes(1)
    expect(invalidateCacheMock).toHaveBeenCalledWith([`/assistants/${ASSISTANT.id}`, '/assistants'])
  })

  it('keeps a late avatar completion out of a reopened editing session without a PATCH', async () => {
    const pendingAvatar = createDeferred<void>()
    ipcRequestMock.mockReturnValueOnce(pendingAvatar.promise)
    const user = userEvent.setup()
    const resource = { ...ASSISTANT, avatarSrc: 'file:///saved.webp' }
    const { rerender } = render(<AssistantEditDialog open resource={resource} onOpenChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Pick avatar' }))
    await user.click(screen.getByRole('button', { name: 'Remove image' }))
    expect(ipcRequestMock).toHaveBeenCalledWith('assistant.set_avatar', {
      assistantId: ASSISTANT.id,
      avatar: { kind: 'default' }
    })
    rerender(<AssistantEditDialog open={false} resource={resource} onOpenChange={vi.fn()} />)
    rerender(<AssistantEditDialog open resource={resource} onOpenChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Pick avatar' }))
    await act(async () => pendingAvatar.resolve(undefined))
    expect(screen.getByRole('button', { name: 'Remove image' })).toBeVisible()
    expect(updateAssistantMock).not.toHaveBeenCalled()
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

  it('closes the group selector without closing the assistant edit dialog when clicking elsewhere inside it', async () => {
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    openGroupSelect()
    await screen.findByRole('option', { name: 'personal' })
    fireEvent.pointerDown(screen.getByText('Answers'))
    fireEvent.click(screen.getByText('Answers'))

    await waitFor(() => expect(screen.queryByRole('option', { name: 'personal' })).not.toBeInTheDocument())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('submits agent instructions and model changes as a PATCH', async () => {
    const user = userEvent.setup()
    const baseRequest = ipcRequestMock.getMockImplementation()
    ipcRequestMock.mockImplementation(
      async (route: string, input: { instructions: string; modelId: string | null }) => {
        if (route === 'agent.system_prompt.resolve_instructions') {
          return input.instructions.replaceAll('{{model_name}}', input.modelId === MODEL.id ? MODEL.name : 'Old Model')
        }
        return baseRequest?.(route, input)
      }
    )
    render(
      <AgentEditDialog
        open
        resource={{ ...AGENT, instructions: 'Original instructions {{model_name}}' }}
        onOpenChange={vi.fn()}
        initialTab="prompt"
      />
    )

    await user.click(screen.getByRole('button', { name: 'library.config.agent.prompt.block.instructions' }))
    expect(screen.getByRole('button', { name: 'System variables' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByLabelText('Prompt preview')).toHaveTextContent('Original instructions Old Model')
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'library.config.agent.prompt.instructions_label' }), {
      target: { value: 'Updated instructions {{model_name}}' }
    })
    await back(user)
    await back(user)
    const modelTrigger = screen.getByRole('button', { name: 'Model' })
    expect(modelTrigger).toHaveTextContent('Old Model')
    await user.click(screen.getByRole('button', { name: 'Pick model' }))
    await openSubPage(user, 'System Prompt')
    await user.click(screen.getByRole('button', { name: 'library.config.agent.prompt.block.instructions' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Prompt preview')).toHaveTextContent('Updated instructions Updated Model')
    )
    await waitFor(() =>
      expect(Object.assign({}, ...updateAgentMock.mock.calls.map(([{ body }]) => body))).toMatchObject({
        model: MODEL.id,
        instructions: 'Updated instructions {{model_name}}'
      })
    )
  })

  it('preserves saved tier models when the primary model is switched back before saving', async () => {
    const user = userEvent.setup()
    render(
      <AgentEditDialog
        open
        resource={{ ...AGENT, planModel: 'provider::plan', smallModel: 'provider::small' }}
        onOpenChange={vi.fn()}
      />
    )

    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.click(screen.getByRole('button', { name: 'Pick model' }))
    await user.click(screen.getByRole('button', { name: 'Pick original model' }))
    await user.type(name, 'Renamed Agent')

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledWith({ body: { name: 'Renamed Agent' } }))
    expect(updateAgentMock).toHaveBeenCalledTimes(1)
  })

  it("shows a Pi Durable Agent's full prompt and saves edits to its instructions and guidance", async () => {
    const onOpenChange = vi.fn()
    ipcRequestMock.mockImplementation(async (route: string) =>
      route === 'agent.system_prompt.preview'
        ? {
            blocks: [
              { key: 'agent_identity', kind: 'live', text: '<soul>Cedar</soul>' },
              { key: 'report_artifacts', kind: 'guidance', text: '## Reporting deliverables' },
              { key: 'instructions', kind: 'instructions', text: AGENT_INSTRUCTIONS_SLOT }
            ]
          }
        : undefined
    )
    render(
      <AgentEditDialog
        open
        resource={{ ...AGENT, type: 'pi-durable' }}
        onOpenChange={onOpenChange}
        initialTab="prompt"
      />
    )

    expect(
      await screen.findByRole('button', { name: /^library\.config\.agent\.prompt\.block\.agent_identity$/ })
    ).toBeInTheDocument()
    expect(ipcRequestMock).toHaveBeenCalledWith(
      'agent.system_prompt.preview',
      expect.objectContaining({ agentId: AGENT.id, instructions: 'Original instructions' })
    )

    // The Agent's own prompt opens on its own page too, titled in the dialog header.
    fireEvent.click(screen.getByRole('button', { name: 'library.config.agent.prompt.block.instructions' }))
    expect(screen.getByRole('heading', { name: 'library.config.agent.prompt.block.instructions' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'library.config.agent.prompt.instructions_label' }), {
      target: { value: 'Review pull requests.' }
    })

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({ instructions: 'Review pull requests.' })
      })
    )

    // Guidance opens on its own page, titled with the block, inside the dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: /^library\.config\.agent\.prompt\.block\.report_artifacts$/ }))
    expect(
      screen.getByRole('heading', { name: 'library.config.agent.prompt.block.report_artifacts' })
    ).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'library.config.agent.prompt.block.report_artifacts' }), {
      target: { value: 'Report your own way.' }
    })

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          configuration: expect.objectContaining({ prompt_overrides: { report_artifacts: 'Report your own way.' } })
        })
      })
    )

    // A saved override must count as saved, or the dialog refuses to close.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it.each(['pi', 'pi-durable', 'claude-code'] as const)('opens the same prompt editor on %s', (type) => {
    render(<AgentEditDialog open resource={{ ...AGENT, type }} onOpenChange={vi.fn()} initialTab="prompt" />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.agent.prompt.block.instructions' }))
    expect(screen.getByRole('textbox', { name: 'library.config.agent.prompt.instructions_label' })).toHaveValue(
      'Original instructions'
    )
  })

  it('saves the Claude Code native prompt switch independently of the Agent prompt', async () => {
    render(
      <AgentEditDialog open resource={{ ...AGENT, type: 'claude-code' }} onOpenChange={vi.fn()} initialTab="prompt" />
    )
    const toggle = screen.getByRole('switch', { name: 'library.config.agent.prompt.claude_code_native' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: { configuration: { claude_code_native_prompt_enabled: false } }
      })
    )
  })

  // The heartbeat tasks opened as a second, wider modal stacked on this dialog.
  it('edits the heartbeat tasks on a sub-page, and Back with an unsaved draft asks before leaving', async () => {
    const user = userEvent.setup()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'agent.heartbeat.edit' }))
    const editor = await screen.findByRole('textbox', { name: 'agent.heartbeat.tasks' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await waitFor(() => expect(editor).toBeEnabled())
    await user.type(editor, 'Check the inbox')

    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    await back(user)
    expect(editor).toHaveValue('Check the inbox')

    await back(user)
    expect(await screen.findByRole('button', { name: 'agent.heartbeat.edit' })).toBeVisible()
    expect(ipcRequestMock).not.toHaveBeenCalledWith('ai.agent.heartbeat.write', expect.anything())
  })

  it('persists a heartbeat timeout edit independently of the interval', async () => {
    const user = userEvent.setup()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="advanced" />)
    const field = screen.getByLabelText('Maximum Execution Time')
    expect(field).toHaveValue('2')

    await user.clear(field)
    await user.type(field, '10')
    await user.tab()

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: { configuration: { heartbeat_timeout_minutes: 10 } }
      })
    )
  })

  // The heartbeat is turned off by its switch, so an emptied interval is a retype,
  // not a value — a persisted 0 would be a heartbeat interval of zero minutes.
  it('does not persist a zero heartbeat interval when the field is cleared', async () => {
    const user = userEvent.setup()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="advanced" />)

    const field = screen.getByLabelText('Heartbeat interval')
    await user.clear(field)
    await user.tab()

    expect(field).toHaveValue('30')
    expect(updateAgentMock).not.toHaveBeenCalled()
  })

  it('reveals the heartbeat interval and timeout only once the switch is on, and saves them clamped', async () => {
    const user = userEvent.setup()
    const agent = { ...AGENT, configuration: { avatar: '🤖', heartbeat_enabled: false } }
    render(<AgentEditDialog open resource={agent} onOpenChange={vi.fn()} initialTab="advanced" />)
    expect(screen.queryByLabelText('Heartbeat interval')).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Heartbeat' }))
    const interval = screen.getByLabelText('Heartbeat interval')
    await user.clear(interval)
    await user.type(interval, '5000')
    const timeout = screen.getByLabelText('Maximum Execution Time')
    await user.clear(timeout)
    await user.type(timeout, '0')
    await user.tab()

    expect(interval).toHaveValue('1440')
    expect(timeout).toHaveValue('1')
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenLastCalledWith({
        body: {
          configuration: { heartbeat_enabled: true, heartbeat_interval: 1440, heartbeat_timeout_minutes: 1 }
        }
      })
    )
  })

  it.each([
    ['No constraint', null],
    ['English', 'English']
  ] as const)('saves the reply language option %s', async (option, language) => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="advanced" />)

    fireEvent.click(screen.getByRole('combobox', { name: 'Reply language' }))
    fireEvent.click(await screen.findByRole('option', { name: option }))

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledWith({ body: { configuration: { language } } }))
  })

  it('clears a custom reply language when following the global setting again', async () => {
    const agent = { ...AGENT, configuration: { ...AGENT.configuration, language: 'Svenska' } }
    render(<AgentEditDialog open resource={agent} onOpenChange={vi.fn()} initialTab="advanced" />)

    fireEvent.click(screen.getByRole('combobox', { name: 'Reply language' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Follow global' }))

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalled())
    const { configuration } = vi.mocked(updateAgentMock).mock.calls[0][0].body
    expect(configuration).toHaveProperty('language', undefined)
  })

  it('saves an "Other language" after editing and leaving the field', async () => {
    const user = userEvent.setup()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="advanced" />)

    expect(screen.queryByLabelText('Custom reply language')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox', { name: 'Reply language' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Other language…' }))
    const input = screen.getByLabelText('Custom reply language')
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)))
    expect(updateAgentMock).not.toHaveBeenCalled()

    // Typing a preset's name must not swap the input away mid-word.
    await user.type(input, 'Deutsch')
    expect(screen.getByLabelText('Custom reply language')).toHaveValue('Deutsch')
    await user.clear(input)
    await user.type(input, 'Svenska')
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)))
    expect(updateAgentMock).not.toHaveBeenCalled()
    fireEvent.blur(input)

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenLastCalledWith({ body: { configuration: { language: 'Svenska' } } })
    )
  })

  it('saves the Assistant reply language from the Answers card, starting from no constraint', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    const answers = await screen.findByRole('region', { name: 'Answers' })
    const select = within(answers).getByRole('combobox', { name: 'Reply language' })
    expect(select).toHaveTextContent('No constraint')
    fireEvent.click(select)
    fireEvent.click(await screen.findByRole('option', { name: 'Follow global' }))

    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({ body: { settings: { replyLanguage: { mode: 'inherit' } } } })
    )
  })

  it('cancels Full Access on authoritative editor refresh without losing other edits (inv_787184d14a5afca7)', async () => {
    const user = userEvent.setup()
    const agent = { ...AGENT, configuration: { ...AGENT.configuration, permission_mode: 'auto' as const } }
    const props = { open: true, onOpenChange: vi.fn() }
    const { rerender } = render(<AgentEditDialog {...props} resource={agent} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Local name' } })
    await waitFor(() => expect(updateAgentMock).toHaveBeenCalled())
    updateAgentMock.mockClear()
    await user.click(screen.getByRole('combobox', { name: 'Permission mode' }))
    await user.click(screen.getByRole('option', { name: /Full Access/ }))
    expect(screen.getByText('Enable Full Access?')).toBeInTheDocument()
    rerender(
      <AgentEditDialog
        {...props}
        resource={{ ...agent, configuration: { ...agent.configuration, permission_mode: 'plan' } }}
      />
    )
    await waitFor(() => expect(screen.queryByText('Enable Full Access?')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Name')).toHaveValue('Local name')
    expect(updateAgentMock).not.toHaveBeenCalled()
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
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Locally renamed' } })

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

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'First edit' } })
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

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'First edit' } })
    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(1))

    installedSkillsState.current = {
      ...installedSkillsState.current,
      skills: installedSkillsState.current.skills.map((skill) => ({ ...skill, isEnabled: true })),
      refreshing: false
    }
    rerender(<AgentEditDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /^技能:/ }))
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

  it('keeps Agent prompt undo after saving and leaving the prompt page', async () => {
    const user = userEvent.setup()
    fetchGenerateMock.mockResolvedValue('Polished agent instructions')
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="prompt" />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.agent.prompt.block.instructions' }))
    fireEvent.click(screen.getByRole('button', { name: POLISH_PROMPT_BUTTON }))

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'library.config.agent.prompt.instructions_label' })).toHaveValue(
        'Polished agent instructions'
      )
    )
    expect(fetchGenerateMock).toHaveBeenCalledWith({
      prompt: expect.any(String),
      content: 'Original instructions',
      model: DEFAULT_PROMPT_MODEL,
      throwOnError: true,
      signal: expect.any(AbortSignal)
    })

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({ instructions: 'Polished agent instructions' })
      })
    )
    await back(user)
    await back(user)
    await openSubPage(user, 'System Prompt')
    await user.click(screen.getByRole('button', { name: 'library.config.agent.prompt.block.instructions' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenLastCalledWith({ body: { instructions: 'Original instructions' } })
    )
  })

  it('generates agent instructions from the agent name when instructions are blank', async () => {
    fetchGenerateMock.mockResolvedValue('Generated agent instructions')
    render(
      <AgentEditDialog open resource={{ ...AGENT, instructions: '' }} onOpenChange={vi.fn()} initialTab="prompt" />
    )

    fireEvent.click(screen.getByRole('button', { name: 'library.config.agent.prompt.block.instructions' }))
    const generateButton = screen.getByRole('button', { name: GENERATE_PROMPT_BUTTON })
    expect(generateButton).toBeEnabled()
    fireEvent.click(generateButton)

    await waitFor(() =>
      expect(fetchGenerateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.any(String),
          content: 'Alpha Agent',
          model: DEFAULT_PROMPT_MODEL,
          throwOnError: true
        })
      )
    )
    expect(screen.getByRole('textbox', { name: 'library.config.agent.prompt.instructions_label' })).toHaveValue(
      'Generated agent instructions'
    )
  })

  it('allows closing and page navigation while an agent prompt action is in flight', async () => {
    fetchGenerateMock.mockReturnValueOnce(new Promise<string>(() => undefined))
    const onOpenChange = vi.fn()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} initialTab="prompt" />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.agent.prompt.block.instructions' }))
    fireEvent.click(screen.getByRole('button', { name: POLISH_PROMPT_BUTTON }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.getByRole('heading', { name: 'Edit Agent' })).toBeInTheDocument()
  })

  it('submits assistant knowledge, MCP, and model parameter changes', async () => {
    const user = userEvent.setup()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    await openSubPage(user, 'Knowledge')
    await user.click(await screen.findByRole('switch', { name: 'Knowledge One' }))
    await back(user)

    // The server list only exists for manual mode.
    expect(screen.queryByRole('button', { name: /^MCP servers:/ })).not.toBeInTheDocument()
    const mcpModeGroup = screen.getByRole('radiogroup', { name: 'MCP' })
    expect(within(mcpModeGroup).getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(mcpModeGroup).getByRole('radio', { name: 'Manual' }))
    await openSubPage(user, 'MCP servers')
    await user.click(screen.getByRole('switch', { name: 'MCP One' }))
    await back(user)

    await user.click(screen.getByRole('switch', { name: 'Temperature' }))
    // Edits across pages may land in more than one debounced save; together they persist all of them.
    await waitFor(() => {
      const saved = updateAssistantMock.mock.calls.reduce(
        (merged, [{ body }]) => ({ ...merged, ...body, settings: { ...merged.settings, ...body.settings } }),
        { settings: {} }
      )
      expect(saved).toMatchObject({
        knowledgeBaseIds: ['kb-1'],
        mcpServerIds: ['mcp-1'],
        settings: { enableTemperature: true, mcpMode: 'manual' }
      })
    })
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

    fireEvent.click(screen.getByRole('button', { name: /^Custom parameters:/ }))

    expect(await screen.findByRole('textbox', { name: 'Parameter value: stop' })).toHaveValue('END')
    expect(screen.getByRole('spinbutton', { name: 'Parameter value' })).toHaveValue('0')
  })

  // `-` and `1e` are viable prefixes the field holds without reporting them, so the
  // last thing the live callback saw was the clear that preceded them. Abandoning
  // such an edit has to settle back to what it started from, not keep that clear.
  it('restores a custom numeric parameter abandoned mid-keystroke', async () => {
    const user = userEvent.setup()
    render(
      <AssistantEditDialog
        open
        resource={{
          ...ASSISTANT,
          settings: {
            ...ASSISTANT.settings,
            customParameters: [{ name: 'temperature', type: 'number', value: 5 }]
          }
        }}
        onOpenChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /^Custom parameters:/ }))

    const input = await screen.findByRole('spinbutton', { name: 'Parameter value: temperature' })
    await user.clear(input)
    await user.type(input, '-')
    await user.tab()

    expect(input).toHaveValue('5')
  })

  it('names the context override for what it does and states what is inherited while off', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /^Custom context:/ }))

    // The switch overrides the globals — it does not turn context management
    // off, so it must not be named after the feature.
    const overrideSwitch = await screen.findByRole('switch', { name: 'Customize context management' })
    expect(overrideSwitch).not.toBeChecked()

    // Offload/compression fields belong to the override and stay hidden…
    expect(screen.queryByLabelText('Tool-output truncation threshold')).not.toBeInTheDocument()

    fireEvent.click(overrideSwitch)

    expect(await screen.findByLabelText('Tool-output truncation threshold')).toBeInTheDocument()
  })

  it('restores the same custom context settings after turning them off and reopening the page', async () => {
    const user = userEvent.setup()
    const contextSettings = {
      truncateThreshold: 8000,
      compress: { enabled: false, modelId: 'provider::compression', thresholdPercent: 67 }
    }
    render(
      <AssistantEditDialog
        open
        resource={{ ...ASSISTANT, settings: { ...ASSISTANT.settings, contextSettings } }}
        onOpenChange={vi.fn()}
      />
    )

    await openSubPage(user, 'Custom context')
    await user.click(screen.getByRole('switch', { name: 'Customize context management' }))
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({ body: { settings: { contextSettings: null } } })
    )
    await back(user)
    await openSubPage(user, 'Custom context')
    await user.click(screen.getByRole('switch', { name: 'Customize context management' }))

    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenLastCalledWith({ body: { settings: { contextSettings } } })
    )
  })

  // The compression trigger is a three-state override: empty means inherit, and the
  // unit is a standing label on the field rather than part of any value.
  it('offers the compression trigger as an inheritable field carrying its unit', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /^Custom context:/ }))

    fireEvent.click(await screen.findByRole('switch', { name: 'Customize context management' }))
    const compress = await screen.findByRole('switch', { name: 'Compress the context when it fills up' })
    if (compress.getAttribute('aria-checked') !== 'true') fireEvent.click(compress)

    const threshold = await screen.findByRole('spinbutton', { name: 'Compression trigger threshold' })
    expect(threshold).toHaveValue('')
    expect(threshold).toHaveAttribute('aria-valuemin', '20')
    expect(threshold).toHaveAttribute('aria-valuemax', '100')
    expect(screen.getByText('%')).toBeVisible()
  })

  it('expresses "no message limit" as an empty named field rather than a second switch', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /^Custom context:/ }))

    const input = await screen.findByLabelText('Recent messages kept')
    // No stored override → unlimited, shown as an empty field with a placeholder.

    // The limit is one control, not a switch plus a number.

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)
    expect(input).toHaveValue('5')
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

  it('normalizes unsafe max tokens before auto-save persistence', async () => {
    render(
      <AssistantEditDialog
        open
        resource={{
          ...ASSISTANT,
          settings: { ...ASSISTANT.settings, enableMaxTokens: true }
        }}
        onOpenChange={vi.fn()}
      />
    )

    const maxTokensInput = await screen.findByRole('spinbutton', { name: 'Max tokens value' })

    fireEvent.focus(maxTokensInput)
    fireEvent.change(maxTokensInput, { target: { value: String(Number.MAX_SAFE_INTEGER + 1) } })
    fireEvent.blur(maxTokensInput)

    expect(maxTokensInput).toHaveValue(String(Number.MAX_SAFE_INTEGER))
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: { settings: { maxTokens: Number.MAX_SAFE_INTEGER } }
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

    const maxToolCallsSwitch = await screen.findByRole('switch', { name: 'Max tool call rounds' })

    expect(maxToolCallsSwitch).not.toBeChecked()

    fireEvent.click(maxToolCallsSwitch)
    const maxToolCallsInput = await screen.findByDisplayValue('20')

    fireEvent.focus(maxToolCallsInput)
    fireEvent.change(maxToolCallsInput, { target: { value: '0' } })
    fireEvent.blur(maxToolCallsInput)
    expect(maxToolCallsInput).toHaveValue('1')

    fireEvent.focus(maxToolCallsInput)
    fireEvent.change(maxToolCallsInput, { target: { value: '1001' } })
    fireEvent.blur(maxToolCallsInput)

    expect(maxToolCallsInput).toHaveValue('1000')
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

  it('finishes polishing off-page and restores the Assistant prompt when returning', async () => {
    const user = userEvent.setup()
    const generation = Promise.withResolvers<string>()
    fetchGenerateMock.mockReturnValueOnce(generation.promise)
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} initialTab="prompt" />)

    await expectVariablesHelpOnOpen()
    const polishButton = screen.getByRole('button', { name: POLISH_PROMPT_BUTTON })

    await user.click(polishButton)
    await back(user)
    generation.resolve('Polished assistant prompt')
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({ body: { prompt: 'Polished assistant prompt' } })
    )
    await openSubPage(user, 'System Prompt')
    expect(screen.getByLabelText('Prompt editor')).toHaveValue('Polished assistant prompt')
    expect(fetchGenerateMock).toHaveBeenCalledWith({
      prompt: expect.any(String),
      content: 'Original prompt',
      model: DEFAULT_PROMPT_MODEL,
      throwOnError: true,
      signal: expect.any(AbortSignal)
    })

    const undoButton = screen.getByRole('button', { name: 'Undo' })
    fireEvent.click(undoButton)

    expect(screen.getByLabelText('Prompt editor')).toHaveValue('Original prompt')
  })

  it('generates an assistant prompt from its name when the prompt is blank', async () => {
    render(
      <AssistantEditDialog open resource={{ ...ASSISTANT, prompt: '' }} onOpenChange={vi.fn()} initialTab="prompt" />
    )

    const generateButton = screen.getByRole('button', { name: GENERATE_PROMPT_BUTTON })
    fireEvent.click(generateButton)

    await waitFor(() => expect(screen.getByLabelText('Prompt editor')).toHaveValue('Generated prompt'))
    expect(fetchGenerateMock).toHaveBeenCalledWith({
      prompt: expect.any(String),
      content: 'Alpha Assistant',
      model: DEFAULT_PROMPT_MODEL,
      throwOnError: true,
      signal: expect.any(AbortSignal)
    })

    expect(screen.getByRole('button', { name: POLISH_PROMPT_BUTTON })).toBeInTheDocument()
  })

  it('allows closing and page navigation while an assistant prompt action is in flight', async () => {
    fetchGenerateMock.mockReturnValueOnce(new Promise<string>(() => undefined))
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} initialTab="prompt" />)

    fireEvent.click(screen.getByRole('button', { name: POLISH_PROMPT_BUTTON }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.getByRole('heading', { name: 'Edit Assistant' })).toBeInTheDocument()
  })

  it('submits agent permission defaults and advanced changes', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="advanced" />)

    fireEvent.click(screen.getByRole('combobox', { name: 'Permission mode' }))
    // Name matches loosely: each option renders its title and its description.
    fireEvent.click(await screen.findByRole('option', { name: /Plan Only/ }))

    fireEvent.change(screen.getByRole('textbox', { name: 'Environment variables' }), { target: { value: 'FOO=bar' } })

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

  it('projects pi capabilities without exposing Claude-only fields', async () => {
    render(<AgentEditDialog open resource={PI_AGENT} onOpenChange={vi.fn()} initialTab="tools.builtin" />)

    fireEvent.click(screen.getByRole('switch', { name: 'Run shell commands' }))

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({ body: expect.objectContaining({ disabledTools: ['bash'] }) })
    )
  })

  it('keeps old MCP restrictions until the user explicitly removes them, preserving file restrictions', async () => {
    const user = userEvent.setup()
    render(
      <AgentEditDialog
        open
        resource={{ ...PI_AGENT, disabledTools: ['read', 'legacy-dsh:mcp__unknown__tool'] }}
        onOpenChange={vi.fn()}
        initialTab="tools.mcp"
      />
    )
    expect(screen.getByText('mcp__unknown__tool')).toBeVisible()
    expect(updateAgentMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'library.config.tools.legacy_restrictions.remove' }))
    await waitFor(() => expect(screen.queryByText('mcp__unknown__tool')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({ body: expect.objectContaining({ disabledTools: ['read'] }) })
    )
  })

  it('lets users enable Code Mode when its legacy tool was disabled', async () => {
    const user = userEvent.setup()
    render(
      <AgentEditDialog
        open
        resource={{ ...PI_AGENT, disabledTools: ['tool_exec'] }}
        onOpenChange={vi.fn()}
        initialTab="tools.builtin"
      />
    )
    const toggle = screen.getByRole('switch', { name: 'Code Mode' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(updateAgentMock).not.toHaveBeenCalled()
    await user.click(toggle)
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({ body: expect.objectContaining({ disabledTools: [] }) })
    )
  })

  it('removes deleted knowledge bases from an open agent form', async () => {
    const boundAgent = { ...AGENT, knowledgeBaseIds: ['kb-1'] }
    const { rerender } = render(
      <AgentEditDialog open resource={boundAgent} onOpenChange={vi.fn()} initialTab="tools.builtin" />
    )
    expect(screen.getByText('Knowledge Search')).toBeInTheDocument()

    knowledgeBasesState.current = []
    rerender(
      <AgentEditDialog
        open
        resource={{ ...boundAgent, knowledgeBaseIds: [] }}
        onOpenChange={vi.fn()}
        initialTab="tools.builtin"
      />
    )

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

    fireEvent.click(screen.getByRole('switch', { name: 'Knowledge One' }))
    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('switch', { name: 'Knowledge One' }))
    rerender(<AgentEditDialog {...props} resource={{ ...boundAgent, knowledgeBaseIds: [] }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: /^Built-in tools:/ }))
    expect(screen.getByText('Knowledge Search')).toBeInTheDocument()

    resolveFirstSave?.()
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenLastCalledWith({
        body: expect.objectContaining({ knowledgeBaseIds: ['kb-1'] })
      })
    )
  })

  // AC1: the Agent dialog opens on its settings page; runtime, plan model, and small model are gone.
  it('opens the agent on its settings page with identity, model, and cards but no runtime or extra models', () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Edit Agent' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pick avatar' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue(AGENT.name)
    expect(screen.getByLabelText('Description')).toHaveValue(AGENT.description)
    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Old Model')
    for (const label of ['Plan model', 'Small model', 'Model (Opus)']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
    expect(screen.queryByText('Cannot be changed after creation')).not.toBeInTheDocument()
    for (const section of ['Capabilities', 'Run', 'Heartbeat', 'Advanced']) {
      expect(screen.getByRole('region', { name: section })).toBeInTheDocument()
    }
  })

  // AC3: the counting rules — tool gating, builtin skills, live knowledge bases, no browser server.
  it('summarizes each agent capability with the Spec counting rules', async () => {
    const user = userEvent.setup()
    knowledgeBasesState.current = [
      { id: 'kb-1', name: 'Knowledge One', itemCount: 3 },
      { id: 'kb-2', name: 'Knowledge Two', itemCount: 1 }
    ]
    installedSkillsState.current = {
      skills: [
        { id: 'builtin', name: 'Builtin', source: 'builtin', isEnabled: false, isGlobalEnabled: true },
        { id: 'picked', name: 'Picked', source: 'local', isEnabled: true, isGlobalEnabled: true },
        { id: 'unpicked', name: 'Unpicked', source: 'local', isEnabled: false, isGlobalEnabled: true },
        { id: 'off', name: 'Globally off', source: 'local', isEnabled: true, isGlobalEnabled: false }
      ],
      loading: false,
      refreshing: false
    } as unknown as typeof installedSkillsState.current
    const baseQuery = useQueryMock.getMockImplementation()!
    const listed = (data: unknown) => ({ data, isLoading: false, refetch: vi.fn(), mutate: vi.fn() })
    useQueryMock.mockImplementation((path: string, ...rest: unknown[]) =>
      path === '/agent-channels'
        ? listed([
            { id: 'c1', name: 'On', isActive: true },
            { id: 'c2', name: 'Off', isActive: false }
          ])
        : path === '/agents/:agentId/tasks'
          ? listed({
              items: [
                { id: 't1', status: 'active' },
                { id: 't2', status: 'paused' },
                { id: 't3', status: 'completed' }
              ],
              total: 3,
              activeTotal: 1
            })
          : path === '/mcp-servers'
            ? {
                data: {
                  items: [
                    { id: 'mcp-1', name: 'MCP One', isActive: true },
                    { id: 'mcp-2', name: 'MCP Two', isActive: true },
                    { id: 'browser', name: BuiltinMcpServerNames.browser, type: 'inMemory', isActive: true }
                  ]
                },
                isLoading: false
              }
            : baseQuery(path, ...rest)
    )
    const agent = {
      ...AGENT,
      knowledgeBaseIds: ['kb-1', 'kb-deleted'],
      mcps: ['mcp-1', 'browser'],
      // Browser control is its own group, so disabling it does not change the tool count.
      disabledTools: ['Bash', 'mcp__browser']
    }
    render(<AgentEditDialog open resource={agent} onOpenChange={vi.fn()} initialTab="advanced" />)

    const toolCount = () => {
      const label = screen.getByRole('button', { name: /^Built-in tools:/ }).getAttribute('aria-label')!
      const [, on, total] = /Enabled (\d+) \/ (\d+)/.exec(label)!.map(Number)
      return { on, total }
    }
    const withKnowledge = toolCount()
    expect(withKnowledge.on).toBe(withKnowledge.total - 1)
    expect(screen.getByRole('button', { name: '技能: Enabled 1 / 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Knowledge: Linked 1 / 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MCP servers: Enabled 1 / 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Channels: Enabled 1 / 2' })).toBeInTheDocument()
    // Only active tasks run, so paused and completed ones are not counted as enabled.
    expect(screen.getByRole('button', { name: 'Scheduled Tasks: Enabled 1 / 3' })).toBeInTheDocument()

    // Unlinking every knowledge base hides the knowledge tools from the count.
    await openSubPage(user, 'Knowledge')
    await user.click(screen.getByRole('switch', { name: 'Knowledge One' }))
    await back(user)
    expect(toolCount().total).toBeLessThan(withKnowledge.total)
  })

  // Catches a request queued in this window, which a detached window's main-window composer never receives.
  it('hands Create with Agent to the conversation through main, with the request as its draft', async () => {
    ipcRequestMock.mockImplementation(async (route: string) =>
      route === 'ai.agent.session.reuse_or_create'
        ? { session: { id: 'session-1', name: 'Session' }, deletedDuplicateSessionIds: [] }
        : undefined
    )
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="tasks" />)

    fireEvent.click(screen.getByRole('button', { name: 'Create with Agent' }))

    await waitFor(() =>
      expect(ipcRequestMock).toHaveBeenCalledWith(
        'navigation.focus_or_open_conversation',
        expect.objectContaining({
          target: { conversationType: 'agent', conversationId: 'session-1' },
          draft: expect.objectContaining({ text: 'chat.profile_pane.tasks.new_prompt' })
        })
      )
    )
  })

  // AC4: an emptied Agent name says it is required and is never sent.
  it('never saves an empty agent name and marks it required', async () => {
    const user = userEvent.setup()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    await user.clear(screen.getByLabelText('Name'))

    expect(await screen.findByText('Required')).toBeVisible()
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)))
    expect(updateAgentMock).not.toHaveBeenCalled()
  })

  // AC10: each existing deep-link ID still opens the page the Spec maps it to.
  it.each([
    [undefined, 'Edit Agent'],
    ['basic', 'Edit Agent'],
    ['prompt', 'System Prompt'],
    ['tools.builtin', 'Built-in tools'],
    ['tools.skills', '技能'],
    ['tools.knowledge', 'Knowledge'],
    ['tools.mcp', 'MCP servers'],
    ['advanced', 'Edit Agent'],
    ['memory', 'Memory'],
    ['channels', 'Channels'],
    ['tasks', 'Scheduled Tasks'],
    ['prompts', 'Edit Agent']
  ])('opens the agent deep link %s on the %s page', (initialTab, title) => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab={initialTab} />)

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
  })

  // A sealed builtin role has no skills page, so its deep link lands on the settings page.
  it('opens the settings page for a skills deep link on an Agent without a skills page', () => {
    const sealed = { ...AGENT, configuration: { ...AGENT.configuration, builtin_role: 'support' as const } }
    render(<AgentEditDialog open resource={sealed} onOpenChange={vi.fn()} initialTab="tools.skills" />)

    expect(screen.getByRole('heading', { name: 'Edit Agent' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^技能:/ })).not.toBeInTheDocument()
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

  // AC1: one settings page carries the identity block above the cards, with nothing to go back to.
  it('opens the assistant on its settings page with avatar, name, description, model, and cards', () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Edit Assistant' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pick avatar' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue(ASSISTANT.name)
    expect(screen.getByLabelText('Description')).toHaveValue(ASSISTANT.description)
    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Old Model')
    for (const section of ['Capabilities', 'Answers', 'Advanced']) {
      expect(screen.getByRole('region', { name: section })).toBeInTheDocument()
    }
  })

  // AC2: a sub-page's back returns to the settings page inside the dialog and keeps unsaved edits.
  it('returns from a sub-page to the settings page without closing or losing edits', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Draft name')
    await user.type(screen.getByLabelText('Description'), ' draft')
    await openSubPage(user, 'System Prompt')
    expect(screen.getByRole('heading', { name: 'System Prompt' })).toBeInTheDocument()
    await back(user)

    expect(screen.getByRole('heading', { name: 'Edit Assistant' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Draft name')
    expect(screen.getByLabelText('Description')).toHaveValue(`${ASSISTANT.description} draft`)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  // AC3: knowledge counts only bases that still exist; MCP leaves out the browser server.
  it('summarizes linked knowledge bases and enabled MCP servers on the assistant rows', () => {
    knowledgeBasesState.current = [
      { id: 'kb-1', name: 'Knowledge One', itemCount: 3 },
      { id: 'kb-2', name: 'Knowledge Two', itemCount: 1 }
    ]
    const baseQuery = useQueryMock.getMockImplementation()!
    useQueryMock.mockImplementation((path: string, ...rest: unknown[]) =>
      path === '/mcp-servers'
        ? {
            data: {
              items: [
                { id: 'mcp-1', name: 'MCP One', description: 'MCP description', isActive: true },
                { id: 'browser', name: BuiltinMcpServerNames.browser, type: 'inMemory', isActive: true }
              ]
            },
            isLoading: false
          }
        : baseQuery(path, ...rest)
    )
    const resource = {
      ...ASSISTANT,
      knowledgeBaseIds: ['kb-1', 'kb-deleted'],
      mcpServerIds: ['mcp-1', 'browser'],
      settings: { ...ASSISTANT.settings, mcpMode: 'manual' as const }
    }
    render(<AssistantEditDialog open resource={resource} onOpenChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Knowledge: Linked 1 / 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MCP servers: Enabled 1 / 1' })).toBeInTheDocument()
  })

  // AC4: an emptied name says it is required and is never sent.
  it('never saves an empty assistant name and marks it required', async () => {
    const user = userEvent.setup()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    await user.clear(screen.getByLabelText('Name'))

    expect(await screen.findByText('Required')).toBeVisible()
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)))
    expect(updateAssistantMock).not.toHaveBeenCalled()
  })

  // AC10: each existing deep-link ID still opens the page the Spec maps it to.
  it.each([
    [undefined, 'Edit Assistant'],
    ['basic', 'Edit Assistant'],
    ['prompt', 'System Prompt'],
    ['tools.builtin', 'Edit Assistant'],
    ['tools.knowledge', 'Knowledge'],
    ['tools.mcp', 'Edit Assistant'],
    ['advanced', 'Edit Assistant'],
    ['memory', 'Edit Assistant']
  ])('opens the assistant deep link %s on the %s page', (initialTab, title) => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} initialTab={initialTab} />)

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
  })

  it('auto-saves agent skill toggles after a debounce', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="tools.skills" />)

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

  it('binds an MCP server from the shared list in assistant and agent editing', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'MCP' })).getByRole('radio', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('button', { name: /^MCP servers:/ }))
    expect(screen.getByRole('switch', { name: 'MCP One' })).not.toBeChecked()

    cleanup()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^MCP servers:/ }))
    fireEvent.click(screen.getByRole('switch', { name: 'MCP One' }))

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({ body: expect.objectContaining({ mcps: ['mcp-1'] }) })
    )
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

  it('opens the agent avatar picker from its only avatar control', async () => {
    const user = userEvent.setup()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    const dialog = screen.getByRole('dialog')
    const avatarControls = within(dialog).getAllByRole('button', { name: 'Pick avatar' })
    expect(avatarControls).toHaveLength(1)
    await user.click(avatarControls[0])

    expect(screen.getByRole('button', { name: 'Graduation cap' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Image Upload' })).toBeVisible()
  })

  it('keeps popover content inside the dialog container', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    const dialog = screen.getByRole('dialog')
    fireEvent.click(screen.getByLabelText('Pick avatar'))

    expect(dialog).toContainElement(screen.getByRole('button', { name: 'Graduation cap' }))
  })

  it('keeps edited agent values while moving between pages before save', async () => {
    const user = userEvent.setup()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft Agent' } })
    await openSubPage(user, 'System Prompt')
    await back(user)

    expect(screen.getByLabelText('Name')).toHaveValue('Draft Agent')
  })

  it('lets the user explicitly discard after a background auto-save fails', async () => {
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
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))

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

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))

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

    const nameInput = screen.getByLabelText('Name')
    fireEvent.change(nameInput, { target: { value: 'Closing Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('Save failed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    const saveAttemptsAfterFailure = updateAgentMock.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))

    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(updateAgentMock).toHaveBeenCalledTimes(saveAttemptsAfterFailure)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('retries saving the agent when the form changes after a failed close', async () => {
    updateAgentMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} />)

    const nameInput = screen.getByLabelText('Name')
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

describe('Agent configuration memory', () => {
  const files = [
    { key: 'soul', name: 'SOUL.md', content: 'Original persona' },
    { key: 'user', name: 'USER.md', content: 'User details' },
    { key: 'fact', name: 'FACT.md', content: 'Durable facts' },
    { key: 'journal', name: 'JOURNAL.jsonl', content: '{"event":"remembered"}' }
  ].map((file) => ({
    ...file,
    path: `/agents/agent-1/${file.name}`,
    exists: true,
    size: 20,
    updatedAt: null,
    version: 'v1',
    truncated: false
  }))

  beforeEach(() => {
    ipcRequestMock.mockImplementation(async (route: string, input: { key?: string; content?: string }) => {
      if (route === 'agent.memory.read') return { directory: '/agents/agent-1', files }
      if (route === 'agent.memory.write')
        return { ...files.find((file) => file.key === input.key), content: input.content, version: 'v2' }
      return undefined
    })
  })

  function Harness() {
    const [open, setOpen] = useState(true)
    return <AgentEditDialog open={open} resource={AGENT} onOpenChange={setOpen} />
  }

  // Catches accidental autosaving of memory drafts through the Agent config form.
  it('opens memory from configuration and saves only the explicitly submitted file revision', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Memory' }))
    await user.click(await screen.findByRole('button', { name: 'Persona' }))
    const editor = await screen.findByRole('textbox', { name: 'Edit SOUL.md' })
    await user.clear(editor)
    await user.type(editor, 'Updated persona')
    expect(ipcRequestMock.mock.calls.filter(([route]) => route === 'agent.memory.write')).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument())
    expect(ipcRequestMock).toHaveBeenCalledWith('agent.memory.write', {
      agentId: AGENT.id,
      key: 'soul',
      content: 'Updated persona',
      expectedVersion: 'v1'
    })
    expect(updateAgentMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(await screen.findByRole('button', { name: /^Event log/ }))
    expect(screen.queryByRole('textbox', { name: 'Edit JOURNAL.jsonl' })).not.toBeInTheDocument()
    expect(screen.getByText('{"event":"remembered"}')).toBeVisible()
  })

  // Catches the identity page of a Pi Durable System Prompt offering a second place to edit the memory files.
  it('shows the identity block read-only and sends its edits to the Memory page', async () => {
    ipcRequestMock.mockImplementation(async (route: string) => {
      if (route === 'agent.system_prompt.preview')
        return {
          blocks: [
            { key: 'agent_identity', kind: 'live', text: '<soul>Original persona</soul>' },
            { key: 'instructions', kind: 'instructions', text: AGENT_INSTRUCTIONS_SLOT }
          ]
        }
      if (route === 'agent.memory.read') return { directory: '/agents/agent-1', files }
      return undefined
    })
    const user = userEvent.setup()
    render(
      <AgentEditDialog open resource={{ ...AGENT, type: 'pi-durable' }} onOpenChange={vi.fn()} initialTab="prompt" />
    )
    await user.click(
      await screen.findByRole('button', { name: /^library\.config\.agent\.prompt\.block\.agent_identity$/ })
    )

    expect(await screen.findByText('<soul>Original persona</soul>')).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Edit SOUL.md' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'library.config.agent.prompt.edit_in_memory' }))
    expect(await screen.findByRole('button', { name: 'Persona' })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Event log/ })).toBeVisible()
  })

  it('shows refresh and open folder as buttons on the memory file list', async () => {
    const user = userEvent.setup()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="memory" />)
    await screen.findByRole('button', { name: 'Persona' })
    const reads = ipcRequestMock.mock.calls.filter(([route]) => route === 'agent.memory.read').length
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() =>
      expect(ipcRequestMock.mock.calls.filter(([route]) => route === 'agent.memory.read').length).toBe(reads + 1)
    )
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    expect(ipcRequestMock).toHaveBeenCalledWith('agent.memory.open_folder', { agentId: AGENT.id })
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
  })

  it('shows copy and folder actions as buttons on a memory file page', async () => {
    const user = userEvent.setup()
    const writeClipboard = vi.spyOn(navigator.clipboard, 'writeText')
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="memory" />)
    await user.click(await screen.findByRole('button', { name: 'Persona' }))
    await user.click(screen.getByRole('button', { name: 'Copy content' }))
    expect(writeClipboard).toHaveBeenCalledWith('Original persona')
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    expect(ipcRequestMock).toHaveBeenCalledWith('agent.memory.open_folder', { agentId: AGENT.id })
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    writeClipboard.mockRestore()
  })

  // Catches a Refresh that read the file before a Save and resolves after it, putting the old revision back.
  it('keeps the saved revision when a refresh started before the save resolves after it', async () => {
    const user = userEvent.setup()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="memory" />)
    await user.click(await screen.findByRole('button', { name: 'Persona' }))
    const editor = await screen.findByRole('textbox', { name: 'Edit SOUL.md' })
    await user.clear(editor)
    await user.type(editor, 'Saved persona')

    const staleRead = createDeferred<{ directory: string; files: typeof files }>()
    const respond = ipcRequestMock.getMockImplementation()!
    ipcRequestMock.mockImplementation(async (route: string, input: unknown) => {
      if (route !== 'agent.memory.read') return respond(route, input)
      ipcRequestMock.mockImplementation(respond)
      return staleRead.promise
    })
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument())

    await act(async () => staleRead.resolve({ directory: '/agents/agent-1', files }))
    expect(screen.getByRole('textbox', { name: 'Edit SOUL.md' })).toHaveValue('Saved persona')
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()

    await user.type(screen.getByRole('textbox', { name: 'Edit SOUL.md' }), '!')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(ipcRequestMock).toHaveBeenLastCalledWith('agent.memory.write', {
        agentId: AGENT.id,
        key: 'soul',
        content: 'Saved persona!',
        expectedVersion: 'v2'
      })
    )
  })

  // Catches Save submitting a draft the write route rejects for length, which only surfaced as a generic failure.
  it('blocks saving a draft longer than the write limit and says why', async () => {
    const user = userEvent.setup()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="memory" />)
    await user.click(await screen.findByRole('button', { name: 'Persona' }))
    const editor = await screen.findByRole('textbox', { name: 'Edit SOUL.md' })

    fireEvent.change(editor, { target: { value: 'a'.repeat(1_000_001) } })
    expect(screen.getByRole('alert')).toHaveTextContent('1,000,001 / 1,000,000')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    fireEvent.change(editor, { target: { value: 'a'.repeat(1_000_000) } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  // Catches Copy putting the saved revision on the clipboard while the editor shows an unsaved draft.
  it('copies the text the editor is showing, including a draft of a new file', async () => {
    ipcRequestMock.mockImplementation(async (route: string) => {
      if (route === 'agent.memory.read')
        return {
          directory: '/agents/agent-1',
          files: files.map((file) =>
            file.key === 'user' ? { ...file, exists: false, size: 0, content: '', version: 'missing' } : file
          )
        }
      return undefined
    })
    const user = userEvent.setup()
    const writeClipboard = vi.spyOn(navigator.clipboard, 'writeText')
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Memory' }))
    await user.click(await screen.findByRole('button', { name: 'Persona' }))
    await user.type(await screen.findByRole('textbox', { name: 'Edit SOUL.md' }), ' draft')
    await user.click(screen.getByRole('button', { name: 'Copy content' }))
    expect(writeClipboard).toHaveBeenLastCalledWith('Original persona draft')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(await screen.findByRole('button', { name: 'User profile' }))
    expect(screen.getByRole('button', { name: 'Copy content' })).toBeDisabled()
    await user.type(await screen.findByRole('textbox', { name: 'Edit USER.md' }), 'New profile')
    await user.click(screen.getByRole('button', { name: 'Copy content' }))
    expect(writeClipboard).toHaveBeenLastCalledWith('New profile')
    writeClipboard.mockRestore()
  })

  // AC11: catches losing an unsaved memory draft when going back to the file list or closing configuration.
  it.each(['back', 'close'] as const)(
    'protects memory drafts on %s and leaves only after explicit discard',
    async (destination) => {
      const user = userEvent.setup()
      render(<Harness />)
      await user.click(screen.getByRole('button', { name: 'Memory' }))
      await user.click(await screen.findByRole('button', { name: 'Persona' }))
      await user.type(await screen.findByRole('textbox', { name: 'Edit SOUL.md' }), ' unsaved')
      const leave = () =>
        destination === 'back' ? user.click(screen.getByRole('button', { name: 'Back' })) : user.keyboard('{Escape}')
      await leave()
      const confirmation = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })
      await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('textbox', { name: 'Edit SOUL.md' })).toHaveValue('Original persona unsaved')
      await leave()
      await user.click(
        within(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', {
          name: 'Discard changes'
        })
      )
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit SOUL.md' })).not.toBeInTheDocument())
      if (destination === 'back') expect(screen.getByRole('button', { name: 'User profile' })).toBeInTheDocument()
      else expect(screen.queryByRole('dialog', { name: 'Edit Agent' })).not.toBeInTheDocument()
      expect(ipcRequestMock.mock.calls.filter(([route]) => route === 'agent.memory.write')).toEqual([])
    }
  )
})
