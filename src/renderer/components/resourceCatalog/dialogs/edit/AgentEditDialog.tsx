import type { TFunction } from 'i18next'
import { ExternalLink } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm, type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  Button,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  InputNumber,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { PermissionModeSelect } from '@renderer/components/PermissionModeOption'
import PromptEditorField from '@renderer/components/PromptEditorField'
import { AgentLanguageField } from '@renderer/components/resourceCatalog/dialogs/components/AgentLanguageField'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgentMutationsById } from '@renderer/hooks/resourceCatalog'
import { useCloseBeforeAction } from '@renderer/hooks/useCloseBeforeAction'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useMcpRuntimeStatusMap } from '@renderer/hooks/useMcpRuntimeStatus'
import { useModelById } from '@renderer/hooks/useModel'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { useInstalledSkills, useReconcileSkillsOnOpen } from '@renderer/hooks/useSkills'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import type { AgentDetail } from '@renderer/types/resourceCatalog'
import { getPermissionModeCards } from '@renderer/utils/agent'
import { type AgentLanguageMode, resolveAgentLanguagePreview } from '@renderer/utils/agent/agentLanguage'
import {
  type AgentFormState,
  applyAgentFormPatch,
  buildInitialAgentFormState,
  diffAgentSaveIntent,
  RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT
} from '@renderer/utils/resourceCatalog'
import {
  MAX_HEARTBEAT_INTERVAL_MINUTES,
  MAX_HEARTBEAT_TIMEOUT_MINUTES,
  MIN_HEARTBEAT_INTERVAL_MINUTES
} from '@shared/ai/agentHeartbeat'
import { AGENT_RUNTIME_CAPABILITIES, type AgentRuntimeCapabilities } from '@shared/ai/agentRuntimeCapabilities'
import { BROWSER_TOOL_GROUP } from '@shared/ai/browserTools'
import {
  CLAUDE_KNOWLEDGE_TOOL_NAMES,
  CLAUDE_TOOL_CATEGORIES,
  type ClaudeToolCategory
} from '@shared/ai/claudecode/toolRegistry'
import { COMPUTER_USE_TOOL_GROUP } from '@shared/ai/computerUseTools'
import { AGENT_PROMPT } from '@shared/ai/prompts'
import { LEGACY_DSH_TOOL_PREFIX } from '@shared/ai/retiredAgentRuntime'
import type { UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { AgentType } from '@shared/data/types/agent'
import type { UniqueModelId } from '@shared/data/types/model'
import type { InstalledSkill } from '@shared/types/skill'
import { isBrowserMcpServer } from '@shared/utils/mcp'

import { EmojiAvatarPicker } from '../components/DialogFormFields'
import {
  CompactModelField,
  EDIT_DIALOG_PROMPT_MAX_HEIGHT,
  EDIT_DIALOG_PROMPT_MIN_HEIGHT,
  type EditDialogBaseProps,
  type EditDialogTab,
  FieldLabelWithHelp,
  type ModelLabels,
  PromptVariablesPopover,
  settingsFormRowClassName,
  settingsFormRowLabelClassName,
  useDebouncedAutoSave
} from '../components/EditDialogShared'
import { PromptBindingTab } from '../components/PromptBindingTab'
import { PromptPolishActions } from '../components/PromptPolishActions'
import { AgentSettingsShell, SettingsGroup, SettingsNavRow, SettingsRow } from './AgentSettingsShell'
import { HeartbeatEditorDialog } from './HeartbeatEditorDialog'
import { type SettingsPickerSection, SettingsPickerPopover } from './SettingsPickerPopover'

export type AgentEditDialogProps = EditDialogBaseProps & {
  resource: AgentDetail | null
  isModelDisabled?: ModelSelectorFilter
  /** Shown as a back step on the main settings page, e.g. to return to the profile card. */
  onBack?: () => void
}

type AgentEditFormValues = {
  avatar: string
  name: string
  description: string
  modelId: UniqueModelId | null
  planModelId: UniqueModelId | ''
  smallModelId: UniqueModelId | ''
  instructions: string
  mcps: string[]
  knowledgeBaseIds: string[]
  skillIds: string[]
  disabledTools: string[]
  permissionMode: string
  envVarsText: string
  heartbeatEnabled: boolean
  heartbeatInterval: number
  heartbeatTimeoutMinutes: number
  languageMode: AgentLanguageMode
  languageCustom: string
}

type ToolTab = 'tools.builtin' | 'tools.knowledge' | 'tools.mcp' | 'tools.skills'

const logger = loggerService.withContext('AgentEditDialog')
const SKILLS_SETTINGS_PATH = '/settings/skills'

function openSkillsSettingsTab() {
  openSettingsTab(SKILLS_SETTINGS_PATH)
}

const CATEGORY_LABEL_KEYS: Record<ClaudeToolCategory, string> = {
  file: 'library.config.agent.section.tools.category.file',
  shell: 'library.config.agent.section.tools.category.shell',
  search: 'library.config.agent.section.tools.category.search',
  context: 'library.config.agent.section.tools.category.context',
  orchestration: 'library.config.agent.section.tools.category.orchestration',
  media: 'library.config.agent.section.tools.category.media'
}
const CATEGORY_LABEL_FALLBACKS: Record<ClaudeToolCategory, string> = {
  file: 'File',
  shell: 'Shell',
  search: 'Search',
  context: 'Context',
  orchestration: 'Orchestration',
  media: 'Media'
}

function isToolTab(value: string): value is ToolTab {
  return value === 'tools.builtin' || value === 'tools.knowledge' || value === 'tools.mcp' || value === 'tools.skills'
}

function getLeafTabIds(tabs: EditDialogTab[]) {
  return tabs.flatMap((tab) => (tab.children?.length ? tab.children.map((child) => child.id) : [tab.id]))
}

function defaultValuesForAgent(resource: AgentDetail): AgentEditFormValues {
  const form = buildInitialAgentFormState(resource)
  return {
    avatar: form.avatar || '🤖',
    name: form.name,
    description: form.description,
    modelId: form.model || null,
    planModelId: form.planModel,
    smallModelId: form.smallModel,
    instructions: form.instructions,
    mcps: [...form.mcps],
    knowledgeBaseIds: [...form.knowledgeBaseIds],
    skillIds: [...form.skillIds],
    disabledTools: [...form.disabledTools],
    permissionMode: form.permissionMode,
    envVarsText: form.envVarsText,
    heartbeatEnabled: form.heartbeatEnabled,
    heartbeatInterval: form.heartbeatInterval,
    heartbeatTimeoutMinutes: form.heartbeatTimeoutMinutes,
    languageMode: form.languageMode,
    languageCustom: form.languageCustom
  }
}

function modelLabelsForAgent(resource: AgentDetail): ModelLabels {
  return {
    modelId: resource.modelName ?? null,
    planModelId: resource.planModel ?? null,
    smallModelId: resource.smallModel ?? null,
    contextCompressModelId: null
  }
}

function buildAgentFormState(baseline: AgentFormState, values: AgentEditFormValues): AgentFormState {
  return {
    ...baseline,
    avatar: values.avatar,
    name: values.name,
    description: values.description,
    model: values.modelId ?? '',
    planModel: values.planModelId || '',
    smallModel: values.smallModelId || '',
    instructions: values.instructions,
    mcps: [...values.mcps],
    knowledgeBaseIds: [...values.knowledgeBaseIds],
    skillIds: [...values.skillIds],
    disabledTools: [...values.disabledTools],
    permissionMode: values.permissionMode,
    envVarsText: values.envVarsText,
    heartbeatEnabled: values.heartbeatEnabled,
    heartbeatInterval: values.heartbeatInterval,
    heartbeatTimeoutMinutes: values.heartbeatTimeoutMinutes,
    languageMode: values.languageMode,
    languageCustom: values.languageCustom
  }
}

function serializeAgentSaveAttempt(values: AgentEditFormValues, payload: UpdateAgentDto): string {
  return JSON.stringify({ values, payload })
}

function advanceAgentFormBaseline(
  latest: AgentFormState,
  submitted: AgentFormState,
  payload: UpdateAgentDto
): AgentFormState {
  const next = { ...latest }
  const hasOwn = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key)

  if (hasOwn(payload, 'name')) next.name = submitted.name
  if (hasOwn(payload, 'description')) next.description = submitted.description
  if (hasOwn(payload, 'model')) next.model = submitted.model
  if (hasOwn(payload, 'planModel')) next.planModel = submitted.planModel
  if (hasOwn(payload, 'smallModel')) next.smallModel = submitted.smallModel
  if (hasOwn(payload, 'instructions')) next.instructions = submitted.instructions
  if (hasOwn(payload, 'mcps')) next.mcps = [...submitted.mcps]
  if (hasOwn(payload, 'knowledgeBaseIds')) next.knowledgeBaseIds = [...submitted.knowledgeBaseIds]
  if (hasOwn(payload, 'skillUpdates')) next.skillIds = [...submitted.skillIds]
  if (hasOwn(payload, 'disabledTools')) next.disabledTools = [...submitted.disabledTools]

  const configuration = payload.configuration
  if (configuration) {
    if (hasOwn(configuration, 'avatar')) next.avatar = submitted.avatar
    if (hasOwn(configuration, 'permission_mode')) next.permissionMode = submitted.permissionMode
    if (hasOwn(configuration, 'env_vars')) next.envVarsText = submitted.envVarsText
    if (hasOwn(configuration, 'heartbeat_enabled')) next.heartbeatEnabled = submitted.heartbeatEnabled
    if (hasOwn(configuration, 'heartbeat_interval')) next.heartbeatInterval = submitted.heartbeatInterval
    if (hasOwn(configuration, 'heartbeat_timeout_minutes'))
      next.heartbeatTimeoutMinutes = submitted.heartbeatTimeoutMinutes
    if (hasOwn(configuration, 'language')) {
      next.languageMode = submitted.languageMode
      next.languageCustom = submitted.languageCustom
    }
  }

  return next
}

function syncAgentFormState(form: UseFormReturn<AgentEditFormValues>, next: AgentFormState) {
  form.setValue('modelId', next.model || null, { shouldDirty: true })
  form.setValue('planModelId', next.planModel, { shouldDirty: true })
  form.setValue('smallModelId', next.smallModel, { shouldDirty: true })
  form.setValue('mcps', next.mcps, { shouldDirty: true })
  form.setValue('knowledgeBaseIds', next.knowledgeBaseIds, { shouldDirty: true })
  form.setValue('skillIds', next.skillIds, { shouldDirty: true })
  form.setValue('disabledTools', next.disabledTools, { shouldDirty: true })
  form.setValue('permissionMode', next.permissionMode, { shouldDirty: true })
  form.setValue('heartbeatEnabled', next.heartbeatEnabled, { shouldDirty: true })
  form.setValue('heartbeatInterval', next.heartbeatInterval, { shouldDirty: true })
  form.setValue('heartbeatTimeoutMinutes', next.heartbeatTimeoutMinutes, { shouldDirty: true })
  form.setValue('languageMode', next.languageMode, { shouldDirty: true })
  form.setValue('languageCustom', next.languageCustom, { shouldDirty: true })
}

export function AgentEditDialog({
  resource,
  open,
  onOpenChange,
  modelFilter,
  isModelDisabled,
  initialTab,
  onBack
}: AgentEditDialogProps) {
  if (!resource) return null

  return (
    <AgentEditDialogContent
      resource={resource}
      open={open}
      onOpenChange={onOpenChange}
      modelFilter={modelFilter}
      isModelDisabled={isModelDisabled}
      initialTab={initialTab}
      onBack={onBack}
    />
  )
}

function AgentEditDialogContent({
  resource,
  open,
  onOpenChange,
  modelFilter,
  isModelDisabled,
  initialTab,
  onBack
}: EditDialogBaseProps & { resource: AgentDetail; isModelDisabled?: ModelSelectorFilter; onBack?: () => void }) {
  const { t } = useTranslation()
  const caps = AGENT_RUNTIME_CAPABILITIES[resource.type]
  // Tool deep links open their picker over the main page; other tabs are sub-pages.
  const initialPage = initialTab && !isToolTab(initialTab) ? initialTab : 'basic'
  const initialPicker = initialTab && isToolTab(initialTab) ? initialTab : null
  const [activeTab, setActiveTab] = useState(initialPage)
  const [openPicker, setOpenPicker] = useState<ToolTab | null>(initialPicker)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [dialogContentElement, setDialogContentElement] = useState<HTMLDivElement | null>(null)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(() => modelLabelsForAgent(resource))
  const [formBaseline, setFormBaseline] = useState<AgentFormState>(() => buildInitialAgentFormState(resource))
  const formBaselineRef = useRef(formBaseline)
  const failedSaveKeyRef = useRef<string | null>(null)
  const [baselineSkillAgentId, setBaselineSkillAgentId] = useState<string | null>(null)
  const defaultValues = useMemo(() => defaultValuesForAgent(resource), [resource])
  const form = useForm<AgentEditFormValues>({ defaultValues })
  const values = form.watch()
  const { model: selectedAgentModel } = useModelById(values.modelId)
  const promptModelName =
    selectedAgentModel?.name ?? (values.modelId === resource.model ? resource.modelName : undefined)
  const replaceFormBaseline = useCallback((next: AgentFormState) => {
    formBaselineRef.current = next
    setFormBaseline(next)
  }, [])
  const patchAgentForm = useCallback(
    (patch: Partial<AgentFormState>) => {
      const current = buildAgentFormState(formBaselineRef.current, form.getValues())
      syncAgentFormState(form, applyAgentFormPatch(current, patch))
    },
    [form]
  )
  const { updateAgent } = useAgentMutationsById(resource.id)
  const { bases: knowledgeBases, isLoading: knowledgeBasesLoading } = useKnowledgeBases()
  const availableKnowledgeBaseIds = useMemo(() => new Set(knowledgeBases.map((base) => base.id)), [knowledgeBases])
  const {
    skills,
    loading: skillsLoading,
    refreshing: skillsRefreshing
  } = useInstalledSkills(resource.id || undefined, {
    enabled: open && Boolean(resource.id)
  })
  useReconcileSkillsOnOpen(open && openPicker === 'tools.skills')
  const skillIdsFromQueryKey = useMemo(
    () =>
      skills
        .filter((skill) => skill.isEnabled)
        .map((skill) => skill.id)
        .join('\0'),
    [skills]
  )
  const skillIdsFromQuery = useMemo(
    () => (skillIdsFromQueryKey ? skillIdsFromQueryKey.split('\0') : []),
    [skillIdsFromQueryKey]
  )
  const currentFormState = useMemo(() => buildAgentFormState(formBaseline, values), [formBaseline, values])
  const saveIntent = useMemo(() => {
    return diffAgentSaveIntent(currentFormState, formBaseline)
  }, [currentFormState, formBaseline])
  // Sub-pages behind the main settings page; tools, skills, MCP, and knowledge open as pickers instead.
  const tabs = useMemo<EditDialogTab[]>(
    () => [
      { id: 'basic', label: t('library.config.dialogs.edit.basic_tab') },
      { id: 'prompt', label: t('library.config.dialogs.edit.prompt_tab') },
      { id: 'prompts', label: t('settings.prompts.binding.bind') },
      // The advanced page only holds environment variables, so it is titled after them.
      { id: 'advanced', label: t('library.config.agent.field.env_vars.label') }
    ],
    [t]
  )
  const leafTabIds = useMemo(() => new Set(getLeafTabIds(tabs)), [tabs])

  const wasOpenRef = useRef(false)
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current
    wasOpenRef.current = open
    if (!justOpened) return

    form.reset(defaultValues)
    form.clearErrors()
    setActiveTab(initialPage)
    setOpenPicker(initialPicker)
    setEmojiPickerOpen(false)
    setModelLabels(modelLabelsForAgent(resource))
    replaceFormBaseline(buildInitialAgentFormState(resource))
    setBaselineSkillAgentId(null)
    failedSaveKeyRef.current = null
  }, [defaultValues, form, initialPage, initialPicker, open, replaceFormBaseline, resource])

  // Cached skill rows may render during revalidation, but the editable skill
  // baseline must come from the authoritative projection so later toggles diff
  // correctly.
  useEffect(() => {
    if (!open || skillsLoading || skillsRefreshing || baselineSkillAgentId === resource.id) return
    replaceFormBaseline({ ...formBaselineRef.current, skillIds: [...skillIdsFromQuery] })
    form.setValue('skillIds', skillIdsFromQuery, { shouldDirty: false })
    setBaselineSkillAgentId(resource.id)
  }, [
    baselineSkillAgentId,
    form,
    open,
    replaceFormBaseline,
    resource.id,
    skillIdsFromQuery,
    skillsLoading,
    skillsRefreshing
  ])

  useEffect(() => {
    if (!open || skillsLoading || skillsRefreshing || baselineSkillAgentId !== resource.id) return

    // A globally disabled skill is absent from the agent projection. If it is
    // re-enabled after this dialog initialized, restore the still-persisted
    // agent preference without overwriting local edits or hidden selections.
    const baselineSkillIds = formBaselineRef.current.skillIds
    const baselineSkillIdSet = new Set(baselineSkillIds)
    const newlyVisibleEnabledIds = skillIdsFromQuery.filter((id) => !baselineSkillIdSet.has(id))
    if (newlyVisibleEnabledIds.length === 0) return

    replaceFormBaseline({
      ...formBaselineRef.current,
      skillIds: [...baselineSkillIds, ...newlyVisibleEnabledIds]
    })
    const currentSkillIds = form.getValues('skillIds')
    const currentSkillIdSet = new Set(currentSkillIds)
    form.setValue(
      'skillIds',
      [...currentSkillIds, ...newlyVisibleEnabledIds.filter((id) => !currentSkillIdSet.has(id))],
      { shouldDirty: false }
    )
  }, [
    baselineSkillAgentId,
    form,
    open,
    replaceFormBaseline,
    resource.id,
    skillIdsFromQuery,
    skillsLoading,
    skillsRefreshing
  ])

  useEffect(() => {
    if (!open || knowledgeBasesLoading) return

    // Keep unrelated local edits while removing bindings that disappeared from
    // the knowledge-base directory after a delete. Agent projection refreshes
    // caused by this dialog's own saves must not overwrite newer form edits.
    const currentIds = form.getValues('knowledgeBaseIds')
    const convergedIds = currentIds.filter((id) => availableKnowledgeBaseIds.has(id))
    if (convergedIds.length !== currentIds.length) {
      replaceFormBaseline({
        ...formBaselineRef.current,
        knowledgeBaseIds: formBaselineRef.current.knowledgeBaseIds.filter((id) => availableKnowledgeBaseIds.has(id))
      })
      form.setValue('knowledgeBaseIds', convergedIds, { shouldDirty: false })
    }
  }, [availableKnowledgeBaseIds, form, knowledgeBasesLoading, open, replaceFormBaseline])

  useEffect(() => {
    if (leafTabIds.has(activeTab)) return
    setActiveTab('basic')
  }, [activeTab, leafTabIds])

  const rootError = form.formState.errors.root?.message
  const autoSaveChangeKey =
    saveIntent && values.name.trim().length > 0 ? serializeAgentSaveAttempt(values, saveIntent.payload) : null
  const saveFailedMessage = t('library.config.dialogs.edit.save_failed')

  const getCurrentSaveIntent = () =>
    diffAgentSaveIntent(buildAgentFormState(formBaselineRef.current, form.getValues()), formBaselineRef.current)

  const persist = async () => {
    // Recompute from refs at execution time: the serialized autosave queue may
    // start its follow-up pass before React has rendered the baseline state
    // advanced by the previous pass.
    const submittedValues = form.getValues()
    if (!submittedValues.name.trim()) return
    const submittedFormState = buildAgentFormState(formBaselineRef.current, submittedValues)
    const pending = diffAgentSaveIntent(submittedFormState, formBaselineRef.current)
    if (!pending) return
    const attemptedKey = serializeAgentSaveAttempt(submittedValues, pending.payload)

    // A close-triggered flush does not cancel the already scheduled debounce.
    // Keep both paths from resending an unchanged payload that already failed.
    if (failedSaveKeyRef.current === attemptedKey) return

    form.clearErrors('root')
    failedSaveKeyRef.current = null

    try {
      await updateAgent(pending.payload)
    } catch (error) {
      logger.error('Failed to auto-save agent edit dialog', error as Error, { agentId: resource.id })
      failedSaveKeyRef.current = attemptedKey
      form.setError('root', { message: saveFailedMessage })
      toast.error(saveFailedMessage)
      return
    }

    // Commit only fields this request actually submitted. Baseline updates that
    // landed while it was in flight (such as authoritative skill initialization)
    // must survive so queued edits still diff against the persisted state.
    replaceFormBaseline(advanceAgentFormBaseline(formBaselineRef.current, submittedFormState, pending.payload))
  }

  // Include the pending payload so a baseline update during an in-flight save
  // can queue a newly meaningful diff even when form values return to the
  // snapshot that save captured. Values remain in the key to distinguish DTO
  // clears represented by explicit `undefined`.
  const { flush, getPendingSave } = useDebouncedAutoSave({
    enabled: open,
    changeKey: autoSaveChangeKey,
    onSave: persist
  })

  // Keep failed saves visible and gate settings navigation on successful closure.
  const handleOpenChange = async (next: boolean, allowDiscard = true): Promise<boolean> => {
    if (next) {
      onOpenChange(next)
      return true
    }
    const valuesBeforeSave = JSON.stringify(form.getValues())
    const pendingSave = getPendingSave()
    if (pendingSave) await pendingSave
    if (JSON.stringify(form.getValues()) !== valuesBeforeSave) return false

    const currentValues = form.getValues()
    const pending = getCurrentSaveIntent()
    if (!pending || (!currentValues.name.trim() && allowDiscard)) {
      onOpenChange(false)
      return true
    }
    if (!currentValues.name.trim()) return false
    if (failedSaveKeyRef.current === serializeAgentSaveAttempt(currentValues, pending.payload)) {
      toast.error(saveFailedMessage)
      if (!allowDiscard || pendingSave) return false
      onOpenChange(false)
      return true
    }
    await flush()
    if (
      failedSaveKeyRef.current !== null ||
      JSON.stringify(form.getValues()) !== valuesBeforeSave ||
      getCurrentSaveIntent()
    )
      return false
    onOpenChange(false)
    return true
  }
  const closeBeforeAction = useCloseBeforeAction((next) => handleOpenChange(next, false))
  // Leaving for the profile unmounts this form, so land any pending save first and stay on failure.
  const handleBack = onBack
    ? async () => {
        const pendingSave = getPendingSave()
        if (pendingSave) await pendingSave
        await flush()
        if (failedSaveKeyRef.current === null) onBack()
      }
    : undefined

  const subPage = activeTab === 'basic' ? null : tabs.find((tab) => tab.id === activeTab)
  const envVarCount = values.envVarsText.split('\n').filter((line) => line.includes('=')).length

  return (
    <AgentSettingsShell
      form={form}
      open={open}
      onOpenChange={handleOpenChange}
      pageKey={activeTab}
      onBack={subPage ? () => setActiveTab('basic') : handleBack}
      rootError={rootError}
      setDialogContentElement={setDialogContentElement}
      title={
        subPage ? (
          subPage.label
        ) : (
          <>
            {values.name.trim() || resource.name}
            <span className="text-muted-foreground"> · {t('library.config.agent.profile.more_settings')}</span>
          </>
        )
      }>
      <div hidden={activeTab !== 'basic'} className="flex flex-col gap-5">
        <SettingsGroup title={t('library.config.agent.settings.group.basic')}>
          <AgentIdentityRows
            form={form}
            emojiPickerOpen={emojiPickerOpen}
            setEmojiPickerOpen={setEmojiPickerOpen}
            portalContainer={dialogContentElement}
          />
          <SettingsNavRow
            label={t('library.config.dialogs.edit.prompt_tab')}
            value={
              values.instructions.trim()
                ? t('library.config.agent.settings.characters', { count: values.instructions.trim().length })
                : t('library.config.agent.settings.none')
            }
            onClick={() => setActiveTab('prompt')}
          />
        </SettingsGroup>
        <SettingsGroup title={t('common.model')}>
          <AgentModelRows
            form={form}
            modelFilter={modelFilter}
            isModelDisabled={isModelDisabled}
            portalContainer={dialogContentElement}
            modelLabels={modelLabels}
            setModelLabels={setModelLabels}
            patchAgentForm={patchAgentForm}
            onSettingsNavigate={closeBeforeAction}
            caps={caps}
          />
        </SettingsGroup>
        <SettingsGroup title={t('library.config.agent.settings.group.capabilities')}>
          <AgentCapabilityRows
            agent={resource}
            form={form}
            openPicker={openPicker}
            setOpenPicker={setOpenPicker}
            portalContainer={dialogContentElement}
            skills={skills}
            skillsReady={baselineSkillAgentId === resource.id}
            caps={caps}
          />
        </SettingsGroup>
        <SettingsGroup title={t('library.config.agent.settings.group.behavior')}>
          <AgentBehaviorRows
            form={form}
            portalContainer={dialogContentElement}
            patchAgentForm={patchAgentForm}
            caps={caps}
            agentType={resource.type}
            agentId={resource.id}
            permissionAuthorityKey={`${resource.id}:${resource.configuration?.permission_mode ?? 'default'}`}
            beforeHeartbeatOpen={async () => {
              await flush()
              return failedSaveKeyRef.current === null
            }}
          />
        </SettingsGroup>
        <SettingsGroup title={t('library.config.agent.settings.group.other')}>
          <SettingsNavRow label={t('settings.prompts.binding.bind')} onClick={() => setActiveTab('prompts')} />
          <SettingsNavRow
            label={t('library.config.agent.field.env_vars.label')}
            value={
              envVarCount > 0
                ? t('library.config.agent.settings.count', { count: envVarCount })
                : t('library.config.agent.settings.none')
            }
            onClick={() => setActiveTab('advanced')}
          />
        </SettingsGroup>
      </div>
      <div hidden={activeTab !== 'prompt'} className="flex h-full min-h-0 flex-col">
        <AgentPromptField form={form} modelName={promptModelName ?? null} portalContainer={dialogContentElement} />
      </div>
      <div hidden={activeTab !== 'prompts'}>
        <PromptBindingTab
          enabled={open && activeTab === 'prompts'}
          target={{ type: 'agent', id: resource.id }}
          onManageGlobal={() => closeBeforeAction(() => openSettingsTab('/settings/prompts'))}
          portalContainer={dialogContentElement}
        />
      </div>
      <div hidden={activeTab !== 'advanced'}>
        <AgentAdvancedFields form={form} />
      </div>
    </AgentSettingsShell>
  )
}

function AgentIdentityRows({
  form,
  emojiPickerOpen,
  setEmojiPickerOpen,
  portalContainer
}: {
  form: UseFormReturn<AgentEditFormValues>
  emojiPickerOpen: boolean
  setEmojiPickerOpen: (open: boolean) => void
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()

  return (
    <>
      <FormField
        control={form.control}
        name="name"
        rules={{ validate: (value) => value.trim().length > 0 || t('common.required_field') }}
        render={({ field }) => (
          <FormItem className={settingsFormRowClassName}>
            <FormLabel className={settingsFormRowLabelClassName}>
              {t('library.config.dialogs.create.avatar_name_label')}
            </FormLabel>
            <div className="flex min-w-0 items-center gap-2">
              <FormField
                control={form.control}
                name="avatar"
                render={({ field: avatarField }) => (
                  <EmojiAvatarPicker
                    value={avatarField.value}
                    fallback="🤖"
                    open={emojiPickerOpen}
                    onOpenChange={setEmojiPickerOpen}
                    onChange={avatarField.onChange}
                    ariaLabel={t('library.config.dialogs.create.avatar_aria')}
                    portalContainer={portalContainer}
                  />
                )}
              />
              <FormControl>
                <Input {...field} className="h-8" placeholder={t('library.config.agent.field.name.placeholder')} />
              </FormControl>
            </div>
            <FormMessage className="col-start-2" />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem className={settingsFormRowClassName}>
            <FormLabel className={settingsFormRowLabelClassName}>
              {t('library.config.agent.field.description.label')}
            </FormLabel>
            <FormControl>
              <Input {...field} className="h-8" placeholder={t('library.config.agent.field.description.placeholder')} />
            </FormControl>
          </FormItem>
        )}
      />
    </>
  )
}

function AgentModelRows({
  form,
  modelFilter,
  isModelDisabled,
  portalContainer,
  modelLabels,
  setModelLabels,
  patchAgentForm,
  onSettingsNavigate,
  caps
}: {
  form: UseFormReturn<AgentEditFormValues>
  modelFilter?: ModelSelectorFilter
  isModelDisabled?: ModelSelectorFilter
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
  patchAgentForm: (patch: Partial<AgentFormState>) => void
  onSettingsNavigate?: (navigate: () => void) => void
  caps: AgentRuntimeCapabilities
}) {
  const { t } = useTranslation()
  const shared = {
    form,
    includeAgentOnlyModels: true,
    filter: modelFilter,
    isModelDisabled,
    portalContainer,
    modelLabels,
    setModelLabels,
    onSettingsNavigate,
    layout: 'settings' as const,
    triggerClassName: 'w-full'
  }

  return (
    <>
      <CompactModelField
        {...shared}
        name="modelId"
        label={t(
          caps.modelTiers
            ? 'library.config.agent.field.model.label.claude_code'
            : 'library.config.agent.field.model.label'
        )}
        help={t(
          caps.modelTiers
            ? 'library.config.agent.field.model.hint.claude_code'
            : 'library.config.agent.field.model.hint'
        )}
        onModelChange={(modelId) => patchAgentForm({ model: modelId ?? '' })}
      />
      {caps.modelTiers ? (
        <>
          <CompactModelField
            {...shared}
            name="planModelId"
            label={t('library.config.agent.field.plan_model.label')}
            help={t('library.config.agent.field.plan_model.hint')}
            emptyLabel={t('library.config.agent.field.plan_model.empty')}
            allowClear
            onModelChange={(modelId) => patchAgentForm({ planModel: modelId ?? '' })}
          />
          <CompactModelField
            {...shared}
            name="smallModelId"
            label={t('library.config.agent.field.small_model.label')}
            help={t('library.config.agent.field.small_model.hint')}
            emptyLabel={t('library.config.agent.field.small_model.empty')}
            allowClear
            onModelChange={(modelId) => patchAgentForm({ smallModel: modelId ?? '' })}
          />
        </>
      ) : null}
      {/* The runtime is fixed at creation, so it is stated rather than offered as a control. */}
      <SettingsRow
        label={t('library.config.agent.field.runtime.label')}
        hint={t('library.config.agent.field.runtime.immutable_hint')}>
        <span className="truncate text-muted-foreground text-sm">{t(caps.labelKey, caps.labelFallback)}</span>
      </SettingsRow>
    </>
  )
}

function AgentBehaviorRows({
  form,
  portalContainer,
  patchAgentForm,
  caps,
  agentType,
  agentId,
  permissionAuthorityKey,
  beforeHeartbeatOpen
}: {
  form: UseFormReturn<AgentEditFormValues>
  portalContainer: HTMLElement | null
  patchAgentForm: (patch: Partial<AgentFormState>) => void
  caps: AgentRuntimeCapabilities
  agentType: AgentType
  agentId: string
  permissionAuthorityKey: string
  beforeHeartbeatOpen: () => Promise<boolean>
}) {
  const { t } = useTranslation()
  const heartbeatEnabled = useWatch({ control: form.control, name: 'heartbeatEnabled' })
  const [heartbeatOpen, setHeartbeatOpen] = useState(false)

  return (
    <>
      {/* Invalidate only the pending permission dialog when authoritative identity/mode changes. */}
      <PermissionModeField
        key={permissionAuthorityKey}
        form={form}
        portalContainer={portalContainer}
        patchAgentForm={patchAgentForm}
        permissionModeCards={getPermissionModeCards(agentType)}
      />
      <AgentLanguageOverrideField form={form} portalContainer={portalContainer} />
      {caps.heartbeat ? (
        <>
          <HeartbeatSettingsField
            form={form}
            enabled={heartbeatEnabled}
            onEnabledChange={(checked) => patchAgentForm({ heartbeatEnabled: checked })}
          />
          <SettingsNavRow
            label={t('agent.heartbeat.edit')}
            onClick={async () => {
              if (await beforeHeartbeatOpen()) setHeartbeatOpen(true)
            }}
          />
          {heartbeatOpen ? (
            <HeartbeatEditorDialog agentId={agentId} enabled={heartbeatEnabled} onOpenChange={setHeartbeatOpen} />
          ) : null}
        </>
      ) : null}
    </>
  )
}

function PermissionModeField({
  form,
  portalContainer,
  patchAgentForm,
  permissionModeCards
}: {
  form: UseFormReturn<AgentEditFormValues>
  portalContainer: HTMLElement | null
  patchAgentForm: (patch: Partial<AgentFormState>) => void
  permissionModeCards: ReturnType<typeof getPermissionModeCards>
}) {
  const { t } = useTranslation()
  const permissionMode = useWatch({ control: form.control, name: 'permissionMode' }) || 'default'
  const agentName = useWatch({ control: form.control, name: 'name' })
  const selectedPermissionModeCard = permissionModeCards.find((card) => card.mode === permissionMode)

  return (
    <FormField
      control={form.control}
      name="permissionMode"
      render={() => (
        <FormItem className={settingsFormRowClassName}>
          <FormLabel className={settingsFormRowLabelClassName}>
            {t('library.config.agent.field.permission_mode.label')}
          </FormLabel>
          <PermissionModeSelect
            cards={permissionModeCards}
            value={selectedPermissionModeCard?.mode ?? 'default'}
            onValueChange={(value) => patchAgentForm({ permissionMode: value })}
            portalContainer={portalContainer}
            ariaLabel={t('library.config.agent.field.permission_mode.label')}
            scopeName={agentName.trim() || undefined}
            t={t}
          />
          <FormMessage className="col-start-2" />
        </FormItem>
      )}
    />
  )
}

function AgentLanguageOverrideField({
  form,
  portalContainer
}: {
  form: UseFormReturn<AgentEditFormValues>
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const [globalLanguage] = usePreference('agent.language')
  const languageMode = useWatch({ control: form.control, name: 'languageMode' })
  const languageCustom = useWatch({ control: form.control, name: 'languageCustom' })
  const preview = resolveAgentLanguagePreview(languageMode, languageCustom, globalLanguage)
  const label = t('library.config.agent.field.language.label')

  return (
    <FormField
      control={form.control}
      name="languageMode"
      render={({ field }) => (
        <>
          <FormItem className={settingsFormRowClassName}>
            <div className="min-w-0">
              <FormLabel className={settingsFormRowLabelClassName}>{label}</FormLabel>
              <div className="text-muted-foreground text-xs">
                {preview
                  ? t('library.config.agent.field.language.effective_value', { language: preview })
                  : t('library.config.agent.field.language.effective_follow')}
              </div>
            </div>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger size="sm" className="w-full" aria-label={label}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent portalContainer={portalContainer} align="end">
                <SelectItem value="inherit">{t('library.config.agent.field.language.mode.inherit')}</SelectItem>
                <SelectItem value="off">{t('library.config.agent.field.language.mode.off')}</SelectItem>
                <SelectItem value="custom">{t('library.config.agent.field.language.mode.custom')}</SelectItem>
              </SelectContent>
            </Select>
          </FormItem>
          {field.value === 'custom' ? (
            <SettingsRow label={t('settings.agent.language.custom_label')}>
              <AgentLanguageField
                className="w-full"
                value={languageCustom.trim() ? languageCustom : null}
                onChange={(next) => {
                  if (next === null) field.onChange('inherit')
                  else form.setValue('languageCustom', next, { shouldDirty: true })
                }}
                nullOptionLabel={t('library.config.agent.field.language.mode.inherit')}
                customPlaceholder={t('settings.agent.language.custom_placeholder')}
                comboLabel={t('settings.agent.language.combo_label')}
                inputLabel={t('settings.agent.language.custom_label')}
              />
            </SettingsRow>
          ) : null}
        </>
      )}
    />
  )
}

function HeartbeatSettingsField({
  form,
  enabled,
  onEnabledChange
}: {
  form: UseFormReturn<AgentEditFormValues>
  enabled: boolean
  onEnabledChange: (checked: boolean) => void
}) {
  const { t } = useTranslation()
  const label = t('library.config.agent.field.heartbeat_enabled.label')

  return (
    <>
      <FormField
        control={form.control}
        name="heartbeatEnabled"
        render={({ field }) => (
          <FormItem className={settingsFormRowClassName}>
            <FormLabel className={settingsFormRowLabelClassName}>{label}</FormLabel>
            <FormControl>
              <div className="flex h-8 items-center justify-end">
                <Switch size="sm" checked={field.value} onCheckedChange={onEnabledChange} aria-label={label} />
              </div>
            </FormControl>
          </FormItem>
        )}
      />
      {enabled ? (
        <>
          <FormField
            control={form.control}
            name="heartbeatInterval"
            render={({ field }) => (
              <FormItem className={settingsFormRowClassName}>
                <FormLabel className={settingsFormRowLabelClassName}>
                  {t('library.config.agent.field.heartbeat_interval.label')}
                </FormLabel>
                <FormControl>
                  <InputNumber
                    min={MIN_HEARTBEAT_INTERVAL_MINUTES}
                    max={MAX_HEARTBEAT_INTERVAL_MINUTES}
                    step={1}
                    className="h-8 w-full"
                    value={field.value || null}
                    // Emptying the field is how you retype the interval, not how you
                    // turn the heartbeat off — the switch above does that.
                    onBlur={(v) => {
                      if (v !== null) field.onChange(v)
                    }}
                  />
                </FormControl>
                <FormMessage className="col-start-2" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="heartbeatTimeoutMinutes"
            render={({ field }) => (
              <FormItem className={settingsFormRowClassName}>
                <FormLabel className={settingsFormRowLabelClassName}>
                  {t('agent.tasks.timeout.label')} ({t('agent.tasks.intervalUnit')})
                </FormLabel>
                <FormControl>
                  <InputNumber
                    min={1}
                    max={MAX_HEARTBEAT_TIMEOUT_MINUTES}
                    step={1}
                    className="h-8 w-full"
                    value={field.value}
                    onBlur={(value) => {
                      if (value !== null) field.onChange(value)
                    }}
                  />
                </FormControl>
                <FormMessage className="col-start-2" />
              </FormItem>
            )}
          />
        </>
      ) : null}
    </>
  )
}

function AgentPromptField({
  form,
  modelName,
  portalContainer
}: {
  form: UseFormReturn<AgentEditFormValues>
  modelName: string | null
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const [resetPreviewKey, setResetPreviewKey] = useState(0)
  const [polishing, setPolishing] = useState(false)
  const instructions = form.watch('instructions')
  const name = form.watch('name')
  const processedInstructions = usePromptProcessor({
    prompt: instructions,
    modelName: modelName ?? undefined
  })

  const handlePromptChange = (nextInstructions: string) => {
    form.setValue('instructions', nextInstructions, { shouldDirty: true, shouldTouch: true })
  }

  const handlePromptActionChange = (nextInstructions: string) => {
    handlePromptChange(nextInstructions)
    setResetPreviewKey((key) => key + 1)
  }

  return (
    <FormField
      control={form.control}
      name="instructions"
      render={({ field }) => (
        <PromptEditorField
          label={
            <FieldLabelWithHelp
              label={t('library.config.prompt.label')}
              helpTrigger={<PromptVariablesPopover portalContainer={portalContainer} />}
              formLabel={false}
            />
          }
          value={field.value}
          onChange={handlePromptChange}
          placeholder={t('library.config.prompt.placeholder')}
          previewValue={processedInstructions || instructions}
          resetPreviewKey={resetPreviewKey}
          fill
          actions={
            <PromptPolishActions
              value={instructions}
              fallbackSource={name}
              emptyValueSystemPrompt={AGENT_PROMPT}
              existingValueSystemPrompt={RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT}
              onChange={handlePromptActionChange}
              onRunningChange={setPolishing}
            />
          }
          minHeight={EDIT_DIALOG_PROMPT_MIN_HEIGHT}
          maxHeight={EDIT_DIALOG_PROMPT_MAX_HEIGHT}
          disabled={polishing}
        />
      )}
    />
  )
}

function AgentCapabilityRows({
  agent,
  form,
  openPicker,
  setOpenPicker,
  portalContainer,
  skills,
  skillsReady,
  caps
}: {
  agent: AgentDetail
  form: UseFormReturn<AgentEditFormValues>
  openPicker: ToolTab | null
  setOpenPicker: (picker: ToolTab | null) => void
  portalContainer: HTMLElement | null
  skills: InstalledSkill[]
  skillsReady: boolean
  caps: AgentRuntimeCapabilities
}) {
  const { t } = useTranslation()
  const [disabledTools, mcps, knowledgeBaseIds, skillIds] = useWatch({
    control: form.control,
    name: ['disabledTools', 'mcps', 'knowledgeBaseIds', 'skillIds']
  })
  const [browserEnabled] = usePreference('app.browser.agent_control.enabled')
  const [computerUseEnabled] = usePreference('app.computer_use.agent_control.enabled')
  const { data: mcpData } = useQuery('/mcp-servers', { enabled: caps.mcp })
  const { bases: knowledgeBases } = useKnowledgeBases()
  const pickerProps = (picker: ToolTab) => ({
    open: openPicker === picker,
    onOpenChange: (open: boolean) => setOpenPicker(open ? picker : null),
    portalContainer
  })
  const countLabel = (count: number) =>
    count > 0 ? t('library.config.agent.settings.count', { count }) : t('library.config.agent.settings.none')
  const toggleIn = (list: string[], id: string, checked: boolean) =>
    checked ? [...list.filter((value) => value !== id), id] : list.filter((value) => value !== id)

  // Built-in tools write the opt-out `disabledTools` set (empty = all enabled). kb_* tools only exist
  // once a knowledge base is bound, so they are hidden until then rather than shown as "on".
  const disabledSet = new Set(disabledTools)
  const hasKnowledgeScope = knowledgeBaseIds.length > 0
  const builtinTools = caps
    .builtinTools()
    .filter((tool) => !caps.knowledgeBases || hasKnowledgeScope || !CLAUDE_KNOWLEDGE_TOOL_NAMES.has(tool.id))
  const toolSections: SettingsPickerSection[] = [
    {
      label: t('settings.browser.title'),
      items: [
        {
          id: BROWSER_TOOL_GROUP,
          title: t('settings.browser.control'),
          description: t('settings.browser.controlHelp'),
          badge: browserEnabled ? undefined : t('library.config.tools.inactive_badge'),
          checked: browserEnabled && !disabledSet.has(BROWSER_TOOL_GROUP),
          disabled: !browserEnabled
        }
      ]
    },
    {
      label: t('settings.computerUse.title'),
      items: [
        {
          id: COMPUTER_USE_TOOL_GROUP,
          title: t('settings.computerUse.control'),
          description: t('settings.computerUse.controlHelp'),
          badge: computerUseEnabled ? undefined : t('library.config.tools.inactive_badge'),
          checked: computerUseEnabled && !disabledSet.has(COMPUTER_USE_TOOL_GROUP),
          disabled: !computerUseEnabled
        }
      ]
    },
    ...CLAUDE_TOOL_CATEGORIES.map((category) => ({
      label: t(CATEGORY_LABEL_KEYS[category], CATEGORY_LABEL_FALLBACKS[category]),
      items: builtinTools
        .filter((tool) => tool.category === category)
        .map((tool) => ({
          id: tool.id,
          title: t(tool.labelKey, tool.labelFallback ?? tool.id),
          description: t(tool.descriptionKey, tool.descriptionFallback ?? ''),
          checked: !disabledSet.has(tool.id)
        }))
    })).filter((section) => section.items.length > 0)
  ]
  const enabledToolCount = builtinTools.filter((tool) => !disabledSet.has(tool.id)).length

  const availableSkills = skills.filter((skill) => skill.isGlobalEnabled)
  const skillIdSet = new Set(skillIds)
  const mcpServers = useMemo(() => (mcpData?.items ?? []).filter((server) => !isBrowserMcpServer(server)), [mcpData])
  const mcpStatuses = useMcpRuntimeStatusMap(mcpServers)
  const mcpIdSet = new Set(mcps)
  const knowledgeIdSet = new Set(knowledgeBaseIds)
  const legacyRestrictions = disabledTools.filter((name) => name.startsWith(LEGACY_DSH_TOOL_PREFIX))

  return (
    <>
      <SettingsRow label={t('library.config.agent.section.tools.tab.tools')}>
        <SettingsPickerPopover
          {...pickerProps('tools.builtin')}
          label={t('library.config.agent.section.tools.tab.tools')}
          summary={t('library.config.agent.settings.enabled_count', { count: enabledToolCount })}
          sections={toolSections}
          emptyLabel={t('library.config.agent.section.tools.no_builtin_enabled')}
          onToggle={(id, checked) =>
            form.setValue('disabledTools', toggleIn(disabledTools, id, !checked), { shouldDirty: true })
          }
          footer={
            <>
              <PickerFooterLink onClick={() => openSettingsTab('/settings/browser')}>
                {t('settings.browser.title')}
              </PickerFooterLink>
              <PickerFooterLink onClick={() => openSettingsTab('/settings/computer-use')}>
                {t('settings.computerUse.title')}
              </PickerFooterLink>
            </>
          }
        />
      </SettingsRow>
      {caps.skills ? (
        <SettingsRow label={t('library.config.agent.section.tools.tab.skills')}>
          <SettingsPickerPopover
            {...pickerProps('tools.skills')}
            label={t('library.config.agent.section.tools.tab.skills')}
            summary={countLabel(availableSkills.filter((skill) => skillIdSet.has(skill.id)).length)}
            disabled={!agent.id || !skillsReady}
            sections={[
              {
                items: availableSkills.map((skill) => ({
                  id: skill.id,
                  title: skill.name,
                  description: skill.description ?? undefined,
                  checked: skillIdSet.has(skill.id)
                }))
              }
            ]}
            emptyLabel={t('library.config.agent.section.tools.no_skills_enabled')}
            onToggle={(id, checked) =>
              form.setValue('skillIds', toggleIn(skillIds, id, checked), { shouldDirty: true })
            }
            footer={
              <PickerFooterLink onClick={openSkillsSettingsTab}>{t('agent.settings.skills.addMore')}</PickerFooterLink>
            }
          />
        </SettingsRow>
      ) : null}
      {caps.mcp ? (
        <SettingsRow label={t('library.config.agent.section.tools.tab.mcp')}>
          <SettingsPickerPopover
            {...pickerProps('tools.mcp')}
            label={t('library.config.agent.section.tools.tab.mcp')}
            summary={countLabel(mcps.length)}
            sections={[
              {
                items: mcpServers.map((server) => ({
                  id: server.id,
                  title: server.name,
                  badge: server.isActive
                    ? getMcpStatusBadge(mcpStatuses[server.id]?.state ?? 'connecting', t)
                    : t('library.config.tools.inactive_badge'),
                  checked: mcpIdSet.has(server.id),
                  disabled: !server.isActive
                }))
              }
            ]}
            emptyLabel={t('library.config.agent.section.tools.no_mcp_bound')}
            onToggle={(id, checked) => form.setValue('mcps', toggleIn(mcps, id, checked), { shouldDirty: true })}
            notice={
              legacyRestrictions.length > 0 ? (
                <div className="grid gap-1.5">
                  <p className="text-muted-foreground">{t('library.config.tools.legacy_restrictions.description')}</p>
                  <ul className="grid gap-0.5">
                    {legacyRestrictions.map((name) => (
                      <li key={name}>{name.slice(LEGACY_DSH_TOOL_PREFIX.length)}</li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="justify-self-start"
                    onClick={() =>
                      form.setValue(
                        'disabledTools',
                        disabledTools.filter((name) => !name.startsWith(LEGACY_DSH_TOOL_PREFIX)),
                        { shouldDirty: true }
                      )
                    }>
                    {t('library.config.tools.legacy_restrictions.remove')}
                  </Button>
                </div>
              ) : undefined
            }
            footer={
              <PickerFooterLink onClick={() => openSettingsTab('/settings/mcp/servers')}>
                {t('settings.mcp.title')}
              </PickerFooterLink>
            }
          />
        </SettingsRow>
      ) : null}
      {caps.knowledgeBases ? (
        <SettingsRow label={t('library.config.dialogs.edit.knowledge_tab')}>
          <SettingsPickerPopover
            {...pickerProps('tools.knowledge')}
            label={t('library.config.dialogs.edit.knowledge_tab')}
            summary={countLabel(knowledgeBaseIds.length)}
            sections={[
              {
                items: knowledgeBases.map((base) => ({
                  id: base.id,
                  title: base.name,
                  description: t('library.config.knowledge.doc_count', { count: base.itemCount ?? 0 }),
                  checked: knowledgeIdSet.has(base.id)
                }))
              }
            ]}
            emptyLabel={t('library.config.knowledge.create_first')}
            onToggle={(id, checked) =>
              form.setValue('knowledgeBaseIds', toggleIn(knowledgeBaseIds, id, checked), { shouldDirty: true })
            }
          />
        </SettingsRow>
      ) : null}
    </>
  )
}

function getMcpStatusBadge(state: McpRuntimeStatus['state'], t: TFunction) {
  switch (state) {
    case 'connected':
      return t('settings.mcp.runtimeStatus.connected', 'Connected')
    case 'connecting':
      return t('settings.mcp.runtimeStatus.connecting', 'Connecting')
    case 'error':
      return t('settings.mcp.runtimeStatus.unavailable', 'Unavailable')
    default:
      return undefined
  }
}

function PickerFooterLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="w-full justify-start gap-1.5 font-normal text-muted-foreground">
      <ExternalLink className="size-3.5" />
      {children}
    </Button>
  )
}

function AgentAdvancedFields({ form }: { form: UseFormReturn<AgentEditFormValues> }) {
  const { t } = useTranslation()

  return (
    <div>
      <FormField
        control={form.control}
        name="envVarsText"
        render={({ field }) => (
          <FormItem>
            <FieldLabelWithHelp
              label={t('library.config.agent.field.env_vars.label')}
              help={t('library.config.agent.field.env_vars.help')}
            />
            <FormControl>
              <Textarea.Input
                value={field.value}
                onValueChange={field.onChange}
                placeholder={t('library.config.agent.field.env_vars.placeholder')}
                rows={5}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}
