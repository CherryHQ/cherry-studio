import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm, type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button, FormField, FormItem, Textarea } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { AgentChannels } from '@renderer/components/channel/AgentChannels'
import { DiscardChangesDialog } from '@renderer/components/DiscardChangesDialog'
import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { PermissionModeSelect } from '@renderer/components/PermissionModeOption'
import { SkillCatalogPicker } from '@renderer/components/resourceCatalog/dialogs/skill'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useChannels } from '@renderer/hooks/agent/useChannels'
import { useAgentTasks } from '@renderer/hooks/agent/useTasks'
import { useAgentMutationsById } from '@renderer/hooks/resourceCatalog'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { useCloseBeforeAction } from '@renderer/hooks/useCloseBeforeAction'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { useInstalledSkills, useReconcileSkillsOnOpen } from '@renderer/hooks/useSkills'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { AgentDetail } from '@renderer/types/resourceCatalog'
import { getPermissionModeCards } from '@renderer/utils/agent'
import {
  type AgentFormState,
  type AgentLanguageMode,
  applyAgentFormPatch,
  buildInitialAgentFormState,
  diffAgentSaveIntent
} from '@shared/ai/agentForm'
import type { AgentPromptOverrides } from '@shared/ai/agentPromptSections'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { isSealedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import { LEGACY_DSH_TOOL_PREFIX } from '@shared/ai/retiredAgentRuntime'
import type { AgentPermissionMode, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { UniqueModelId } from '@shared/data/types/model'
import type { AgentMemoryFileKey } from '@shared/ipc/schemas/agent'
import type { InstalledSkill } from '@shared/types/skill'
import { isBrowserMcpServer } from '@shared/utils/mcp'

import { AgentAvatarPicker } from '../components/AgentAvatarPicker'
import { getPromptBlockTitleKey, AgentPromptField } from '../components/AgentPromptField'
import { getAgentBuiltinTools } from '../components/builtinTools'
import { BuiltinToolsField } from '../components/BuiltinToolsField'
import {
  EditDialogPageShell,
  EditIdentityHeader,
  SettingsLinkButton,
  settingsPillClassName,
  SettingsRow,
  SettingsSection
} from '../components/EditDialogPages'
import {
  CompactModelField,
  type EditDialogBaseProps,
  type ModelLabels,
  useDebouncedAutoSave
} from '../components/EditDialogShared'
import { HeartbeatCard } from '../components/HeartbeatCard'
import { KnowledgeCapabilityList } from '../components/KnowledgeCapabilityList'
import { McpCapabilityList } from '../components/McpCapabilityList'
import { ReplyLanguageSelect } from '../components/ReplyLanguageSelect'
import { AgentMemoryPanel, type AgentMemoryPanelHandle, MEMORY_FILE_LABEL_KEYS } from './AgentMemoryPanel'
import { AgentTasksPage } from './AgentTasksPage'
import { countSummary, type EditPage, type EditSubPage, resolveInitialEditPage } from './editPages'
import { HeartbeatTasksPage, type HeartbeatTasksPageHandle } from './HeartbeatTasksPage'

export type AgentEditDialogProps = EditDialogBaseProps & {
  resource: AgentDetail | null
  isModelDisabled?: ModelSelectorFilter
  sessionId?: string
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
  claudeCodeNativePromptEnabled: boolean
  promptOverrides: AgentPromptOverrides
}

const logger = loggerService.withContext('AgentEditDialog')

/** Sub-pages this Agent offers; capabilities its runtime lacks (or a sealed role locks) have none. */
function agentSubPages(resource: AgentDetail): Set<EditSubPage> {
  const caps = AGENT_RUNTIME_CAPABILITIES[resource.type]
  const sealedSkills = isSealedBuiltinAgentRole(resource.configuration?.builtin_role)
  return new Set<EditSubPage>([
    'prompt',
    'tools',
    'memory',
    'channels',
    'tasks',
    ...(caps.heartbeat ? (['heartbeat'] as const) : []),
    ...(caps.skills && !sealedSkills ? (['skills'] as const) : []),
    ...(caps.knowledgeBases ? (['knowledge'] as const) : []),
    ...(caps.mcp ? (['mcp'] as const) : [])
  ])
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
    languageCustom: form.languageCustom,
    claudeCodeNativePromptEnabled: form.claudeCodeNativePromptEnabled,
    promptOverrides: form.promptOverrides
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
    languageCustom: values.languageCustom,
    claudeCodeNativePromptEnabled: values.claudeCodeNativePromptEnabled,
    promptOverrides: values.promptOverrides
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
    if (hasOwn(configuration, 'claude_code_native_prompt_enabled'))
      next.claudeCodeNativePromptEnabled = submitted.claudeCodeNativePromptEnabled
    if (hasOwn(configuration, 'prompt_overrides')) next.promptOverrides = { ...submitted.promptOverrides }
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
  sessionId,
  initialTab
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
      sessionId={sessionId}
    />
  )
}

function AgentEditDialogContent({
  resource,
  open,
  onOpenChange,
  modelFilter,
  isModelDisabled,
  sessionId,
  initialTab
}: Omit<AgentEditDialogProps, 'resource'> & { resource: AgentDetail }) {
  const { t } = useTranslation()
  const subPages = useMemo(() => agentSubPages(resource), [resource])
  const [page, setPage] = useState<EditPage>(() => resolveInitialEditPage('agent', initialTab, subPages))
  // The System Prompt page opens one block of the prompt as a page of its own.
  const [promptSection, setPromptSection] = useState<string | null>(null)
  const [memoryFile, setMemoryFile] = useState<AgentMemoryFileKey | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const memoryPanelRef = useRef<AgentMemoryPanelHandle>(null)
  const heartbeatPageRef = useRef<HeartbeatTasksPageHandle>(null)
  const [avatarSrc, setAvatarSrc] = useState(resource.avatarSrc)
  const [dialogContentElement, setDialogContentElement] = useState<HTMLDivElement | null>(null)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(() => modelLabelsForAgent(resource))
  const [formBaseline, setFormBaseline] = useState<AgentFormState>(() => buildInitialAgentFormState(resource))
  const formBaselineRef = useRef(formBaseline)
  const failedSaveKeyRef = useRef<string | null>(null)
  const [baselineSkillAgentId, setBaselineSkillAgentId] = useState<string | null>(null)
  const defaultValues = useMemo(() => defaultValuesForAgent(resource), [resource])
  // Validate as the user types so an emptied name shows its required message.
  const form = useForm<AgentEditFormValues>({ defaultValues, mode: 'onChange' })
  const values = form.watch()
  const replaceFormBaseline = useCallback((next: AgentFormState) => {
    formBaselineRef.current = next
    setFormBaseline(next)
  }, [])
  const patchAgentForm = useCallback(
    (patch: Partial<AgentFormState>) => {
      const baseline = formBaselineRef.current
      const current = buildAgentFormState(baseline, form.getValues())
      const next = applyAgentFormPatch(current, patch)
      if (patch.model === baseline.model) {
        next.planModel = baseline.planModel
        next.smallModel = baseline.smallModel
      }
      syncAgentFormState(form, next)
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
  useReconcileSkillsOnOpen(open && page === 'skills')
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
  const wasOpenRef = useRef(false)
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current
    wasOpenRef.current = open
    if (!justOpened) return

    form.reset(defaultValues)
    form.clearErrors()
    setPage(resolveInitialEditPage('agent', initialTab, subPages))
    setConfirmDiscard(false)
    setPromptSection(null)
    setMemoryFile(null)
    setAvatarSrc(resource.avatarSrc)
    setModelLabels(modelLabelsForAgent(resource))
    replaceFormBaseline(buildInitialAgentFormState(resource))
    setBaselineSkillAgentId(null)
    failedSaveKeyRef.current = null
  }, [defaultValues, form, initialTab, open, replaceFormBaseline, resource, subPages])

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
    if (memoryPanelRef.current && !(await memoryPanelRef.current.confirmLeave())) return false
    if (heartbeatPageRef.current && !(await heartbeatPageRef.current.confirmLeave())) return false
    const valuesBeforeSave = JSON.stringify(form.getValues())
    const pendingSave = getPendingSave()
    if (pendingSave) await pendingSave
    if (JSON.stringify(form.getValues()) !== valuesBeforeSave) return false

    const currentValues = form.getValues()
    const pending = getCurrentSaveIntent()
    if (!pending) {
      onOpenChange(false)
      return true
    }
    if (!currentValues.name.trim()) {
      if (allowDiscard) setConfirmDiscard(true)
      return false
    }
    if (failedSaveKeyRef.current === serializeAgentSaveAttempt(currentValues, pending.payload)) {
      toast.error(saveFailedMessage)
      if (!allowDiscard || pendingSave) return false
      setConfirmDiscard(true)
      return false
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
  const closeConversationTabs = useCloseConversationTabs()
  const invalidateCache = useInvalidateCache()
  // Opens an empty conversation with this Agent and leaves the request in its composer, unsent. Main hands the
  // draft over, so it also lands when this dialog runs in a detached window.
  const createTaskWithAgent = () =>
    closeBeforeAction(() => {
      void ipcApi
        .request('ai.agent.session.reuse_or_create', {
          agentId: resource.id,
          workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
        })
        .then(({ session, deletedDuplicateSessionIds }) => {
          closeConversationTabs('agents', deletedDuplicateSessionIds)
          void invalidateCache(['/agent-sessions', `/agent-sessions/${session.id}`])
          return ipcApi.request('navigation.focus_or_open_conversation', {
            target: { conversationType: 'agent', conversationId: session.id },
            title: session.name || resource.name,
            draft: { text: t('chat.profile_pane.tasks.new_prompt'), tokens: [], files: [], knowledgeBaseIds: [] }
          })
        })
        .catch((error) => {
          logger.error('Failed to open a conversation to create a task', error as Error)
          toast.error(t('agent.session.create.error.failed'))
        })
    })

  const pageTitles: Record<EditPage, string> = {
    settings: t('library.config.dialogs.edit.agent_title'),
    prompt: t('library.config.prompt.label'),
    tools: t('library.config.agent.section.tools.tab.tools'),
    skills: t('library.config.agent.section.tools.tab.skills'),
    knowledge: t('library.config.dialogs.edit.knowledge_tab'),
    mcp: t('library.config.dialogs.edit.page.mcp'),
    channels: t('library.config.dialogs.edit.page.channels'),
    tasks: t('settings.scheduledTasks.title'),
    heartbeat: t('agent.heartbeat.tasks'),
    memory: t('agent.memory.button'),
    context: '',
    parameters: ''
  }

  // Leaving Memory or the heartbeat tasks with an unsaved edit asks first, as switching tabs did.
  const goTo = async (next: EditPage) => {
    if (page === 'memory' && memoryPanelRef.current && !(await memoryPanelRef.current.confirmLeave())) return
    if (page === 'heartbeat' && heartbeatPageRef.current && !(await heartbeatPageRef.current.confirmLeave())) return
    setPromptSection(null)
    setMemoryFile(null)
    setPage(next)
  }
  const promptSectionTitle = page === 'prompt' && promptSection ? getPromptBlockTitleKey(promptSection) : undefined
  const memoryFileTitle = page === 'memory' && memoryFile ? MEMORY_FILE_LABEL_KEYS[memoryFile] : undefined
  const leaveMemoryFile = async () => {
    if (memoryPanelRef.current && !(await memoryPanelRef.current.confirmLeave())) return
    setMemoryFile(null)
  }

  return (
    <EditDialogPageShell
      form={form}
      open={open}
      onOpenChange={handleOpenChange}
      guardDismiss={Boolean(saveIntent)}
      page={promptSectionTitle ? `prompt.${promptSection}` : memoryFileTitle ? `memory.${memoryFile}` : page}
      title={promptSectionTitle ? t(promptSectionTitle) : memoryFileTitle ? t(memoryFileTitle) : pageTitles[page]}
      onBack={
        promptSectionTitle
          ? () => setPromptSection(null)
          : memoryFileTitle
            ? () => void leaveMemoryFile()
            : page === 'settings'
              ? undefined
              : () => void goTo('settings')
      }
      fill={page === 'prompt' || page === 'memory'}
      rootError={rootError}
      setDialogContentElement={setDialogContentElement}>
      {page === 'settings' ? (
        <div className="flex flex-col gap-5">
          <EditIdentityHeader
            form={form}
            avatar={
              open ? (
                <AgentAvatarPicker
                  agentId={resource.id}
                  emoji={values.avatar}
                  avatarSrc={avatarSrc}
                  onChanged={(next) => {
                    setAvatarSrc(next.avatarSrc)
                    form.setValue('avatar', next.emoji)
                    replaceFormBaseline({ ...formBaselineRef.current, avatar: next.emoji })
                  }}
                  ariaLabel={t('library.config.dialogs.create.avatar_aria')}
                  portalContainer={dialogContentElement}
                  size="lg"
                />
              ) : null
            }
            namePlaceholder={t('library.config.agent.field.name.placeholder')}
            descriptionPlaceholder={t('library.config.agent.field.description.placeholder')}
            model={
              <CompactModelField
                form={form}
                name="modelId"
                includeAgentOnlyModels
                label={t('library.config.agent.field.model.label')}
                filter={modelFilter}
                isModelDisabled={isModelDisabled}
                portalContainer={dialogContentElement}
                modelLabels={modelLabels}
                setModelLabels={setModelLabels}
                onModelChange={(modelId) => patchAgentForm({ model: modelId ?? '' })}
                onSettingsNavigate={closeBeforeAction}
                layout="chip"
                triggerClassName="w-auto max-w-56"
              />
            }
          />
          <AgentSettingsCards
            agent={resource}
            form={form}
            portalContainer={dialogContentElement}
            skills={skills}
            subPages={subPages}
            patchAgentForm={patchAgentForm}
            permissionAuthorityKey={`${resource.id}:${resource.configuration?.permission_mode ?? 'default'}`}
            onOpen={setPage}
            beforeHeartbeatOpen={async () => {
              await flush()
              return failedSaveKeyRef.current === null
            }}
          />
        </div>
      ) : null}
      {open ? (
        <AgentPromptField
          visible={page === 'prompt'}
          value={values.instructions}
          onChange={(next) => form.setValue('instructions', next, { shouldDirty: true, shouldTouch: true })}
          name={values.name}
          modelId={values.modelId}
          portalContainer={dialogContentElement}
          onNativePromptEnabledChange={(enabled) =>
            form.setValue('claudeCodeNativePromptEnabled', enabled, { shouldDirty: true })
          }
          overrides={values.promptOverrides}
          onOverridesChange={(next) => form.setValue('promptOverrides', next, { shouldDirty: true, shouldTouch: true })}
          section={promptSection}
          onSectionChange={setPromptSection}
          onEditIdentity={() => void goTo('memory')}
          draft={{
            agentId: resource.id,
            sessionId,
            agentType: resource.type,
            claudeCodeNativePromptEnabled: values.claudeCodeNativePromptEnabled,
            skillIds: values.skillIds,
            disabledTools: values.disabledTools,
            knowledgeBaseIds: values.knowledgeBaseIds,
            languageMode: values.languageMode,
            languageCustom: values.languageCustom
          }}
        />
      ) : null}
      {page === 'tools' ? (
        <BuiltinToolsField
          agentType={resource.type}
          disabledTools={values.disabledTools}
          onDisabledToolsChange={(next) => form.setValue('disabledTools', next, { shouldDirty: true })}
          hasKnowledgeScope={values.knowledgeBaseIds.length > 0}
        />
      ) : null}
      {page === 'skills' ? (
        <SkillCatalogPicker
          mode="edit"
          skills={skills}
          loading={skillsLoading}
          selectedIds={values.skillIds}
          disabled={!resource.id || baselineSkillAgentId !== resource.id}
          onSelectedIdsChange={(ids) => form.setValue('skillIds', ids, { shouldDirty: true })}
          emptyLabel={
            resource.id
              ? t('library.config.agent.section.tools.no_skills_enabled')
              : t('library.config.agent.section.tools.skills_require_save')
          }
          portalContainer={dialogContentElement}
        />
      ) : null}
      {page === 'knowledge' ? (
        <KnowledgeCapabilityList
          selectedIds={values.knowledgeBaseIds}
          onSelectedIdsChange={(ids) => form.setValue('knowledgeBaseIds', ids, { shouldDirty: true })}
          portalContainer={dialogContentElement}
        />
      ) : null}
      {page === 'mcp' ? <AgentMcpPage form={form} portalContainer={dialogContentElement} /> : null}
      {page === 'channels' ? (
        <AgentChannels
          agentId={resource.id}
          agentType={resource.type}
          permissionMode={values.permissionMode as AgentPermissionMode}
          portalContainer={dialogContentElement}
        />
      ) : null}
      {page === 'tasks' ? (
        <AgentTasksPage
          agentId={resource.id}
          agentName={values.name.trim() || resource.name}
          onCreateWithAgent={createTaskWithAgent}
        />
      ) : null}
      {page === 'heartbeat' ? (
        <HeartbeatTasksPage ref={heartbeatPageRef} agentId={resource.id} enabled={values.heartbeatEnabled} />
      ) : null}
      {open && page === 'memory' ? (
        <AgentMemoryPanel
          key={resource.id}
          ref={memoryPanelRef}
          agent={resource}
          file={memoryFile}
          onFileChange={setMemoryFile}
        />
      ) : null}
      {confirmDiscard && (
        <DiscardChangesDialog onCancel={() => setConfirmDiscard(false)} onDiscard={() => onOpenChange(false)} />
      )}
    </EditDialogPageShell>
  )
}

function AgentSettingsCards({
  agent,
  form,
  portalContainer,
  skills,
  subPages,
  patchAgentForm,
  permissionAuthorityKey,
  onOpen,
  beforeHeartbeatOpen
}: {
  agent: AgentDetail
  form: UseFormReturn<AgentEditFormValues>
  portalContainer: HTMLElement | null
  skills: InstalledSkill[]
  subPages: ReadonlySet<EditSubPage>
  patchAgentForm: (patch: Partial<AgentFormState>) => void
  permissionAuthorityKey: string
  onOpen: (page: EditPage) => void
  beforeHeartbeatOpen: () => Promise<boolean>
}) {
  const { t } = useTranslation()
  const caps = AGENT_RUNTIME_CAPABILITIES[agent.type]
  const [disabledTools, knowledgeBaseIds, skillIds, mcps, instructions] = useWatch({
    control: form.control,
    name: ['disabledTools', 'knowledgeBaseIds', 'skillIds', 'mcps', 'instructions']
  })
  const { bases } = useKnowledgeBases()
  const { mcpServers } = useMcpServers()
  const { channels } = useChannels({ agentId: agent.id })
  const { total: taskTotal = 0, activeTotal: activeTaskTotal = 0 } = useAgentTasks(agent.id)

  const tools = getAgentBuiltinTools(agent.type, knowledgeBaseIds.length > 0)
  const availableSkills = skills.filter((skill) => skill.isGlobalEnabled)
  const servers = mcpServers.filter((server) => !isBrowserMcpServer(server))
  const rows: { page: EditSubPage; label: string; summary: string; hint?: string }[] = [
    {
      page: 'tools',
      label: t('library.config.agent.section.tools.tab.tools'),
      summary: countSummary(t, 'enabled', tools.filter((tool) => !disabledTools.includes(tool.id)).length, tools.length)
    },
    {
      page: 'skills',
      label: t('library.config.agent.section.tools.tab.skills'),
      summary: countSummary(
        t,
        'enabled',
        availableSkills.filter((skill) => skillIds.includes(skill.id)).length,
        availableSkills.length
      )
    },
    {
      page: 'knowledge',
      label: t('library.config.dialogs.edit.knowledge_tab'),
      summary: countSummary(
        t,
        'linked',
        bases.filter((base) => knowledgeBaseIds.includes(base.id)).length,
        bases.length
      )
    },
    {
      page: 'mcp',
      label: t('library.config.dialogs.edit.page.mcp'),
      summary: countSummary(t, 'enabled', servers.filter((server) => mcps.includes(server.id)).length, servers.length)
    },
    {
      page: 'channels',
      label: t('library.config.dialogs.edit.page.channels'),
      hint: t('library.config.dialogs.edit.channels_hint'),
      summary: countSummary(t, 'enabled', channels.filter((channel) => channel.isActive).length, channels.length)
    },
    {
      page: 'tasks',
      label: t('settings.scheduledTasks.title'),
      summary: countSummary(t, 'enabled', activeTaskTotal, taskTotal)
    }
  ]
  const promptLabel = t('library.config.prompt.label')
  const memoryLabel = t('agent.memory.button')

  return (
    <div className="flex flex-col gap-5">
      <SettingsSection title={t('library.config.dialogs.edit.section.capabilities')}>
        {rows
          .filter((row) => subPages.has(row.page))
          .map((row) => (
            <SettingsRow key={row.page} label={row.label} hint={row.hint}>
              <SettingsLinkButton label={row.label} summary={row.summary} onClick={() => onOpen(row.page)} />
            </SettingsRow>
          ))}
      </SettingsSection>

      <SettingsSection title={t('library.config.dialogs.edit.section.run')}>
        {/* Invalidate only the pending permission dialog when authoritative identity/mode changes. */}
        <PermissionModeRow
          key={permissionAuthorityKey}
          form={form}
          portalContainer={portalContainer}
          patchAgentForm={patchAgentForm}
          permissionModeCards={getPermissionModeCards(agent.type)}
        />
        <ReplyLanguageRow form={form} portalContainer={portalContainer} patchAgentForm={patchAgentForm} />
      </SettingsSection>

      {caps.heartbeat ? (
        <HeartbeatSection
          agentId={agent.id}
          form={form}
          patchAgentForm={patchAgentForm}
          onEdit={async () => {
            if (await beforeHeartbeatOpen()) onOpen('heartbeat')
          }}
        />
      ) : null}

      <SettingsSection title={t('library.config.dialogs.edit.advanced_tab')}>
        <SettingsRow label={promptLabel}>
          <SettingsLinkButton
            label={promptLabel}
            summary={
              instructions.trim()
                ? t('library.config.dialogs.edit.prompt_filled')
                : t('library.config.dialogs.edit.prompt_empty')
            }
            onClick={() => onOpen('prompt')}
          />
        </SettingsRow>
        <SettingsRow label={memoryLabel}>
          <SettingsLinkButton label={memoryLabel} onClick={() => onOpen('memory')} />
        </SettingsRow>
        <EnvVarsRow form={form} />
      </SettingsSection>
    </div>
  )
}

function PermissionModeRow({
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
  const label = t('library.config.agent.field.permission_mode.label')

  return (
    <SettingsRow label={label}>
      <FormField
        control={form.control}
        name="permissionMode"
        render={() => (
          <FormItem>
            <PermissionModeSelect
              cards={permissionModeCards}
              value={selectedPermissionModeCard?.mode ?? 'default'}
              onValueChange={(value) => patchAgentForm({ permissionMode: value })}
              portalContainer={portalContainer}
              ariaLabel={label}
              scopeName={agentName.trim() || undefined}
              compact
              triggerClassName={cn(settingsPillClassName, 'w-auto')}
              t={t}
            />
          </FormItem>
        )}
      />
    </SettingsRow>
  )
}

function ReplyLanguageRow({
  form,
  portalContainer,
  patchAgentForm
}: {
  form: UseFormReturn<AgentEditFormValues>
  portalContainer: HTMLElement | null
  patchAgentForm: (patch: Partial<AgentFormState>) => void
}) {
  const { t } = useTranslation()
  const [languageMode, languageCustom] = useWatch({ control: form.control, name: ['languageMode', 'languageCustom'] })

  return (
    // The "Other language…" input spans the next grid row, under the name and the select.
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-1.5 [&>input]:col-span-2 [&>input]:mt-2">
      <span className="text-foreground text-sm">{t('library.config.agent.field.language.label')}</span>
      <ReplyLanguageSelect
        value={{ languageMode, languageCustom }}
        onChange={patchAgentForm}
        portalContainer={portalContainer}
        triggerClassName={cn(settingsPillClassName, 'w-auto')}
      />
    </div>
  )
}

/** Heartbeat switch, interval and run time, plus the heartbeat document's task count and its page. */
function HeartbeatSection({
  agentId,
  form,
  patchAgentForm,
  onEdit
}: {
  agentId: string
  form: UseFormReturn<AgentEditFormValues>
  patchAgentForm: (patch: Partial<AgentFormState>) => void
  onEdit: () => void
}) {
  const { t } = useTranslation()
  const [heartbeatEnabled, heartbeatInterval, heartbeatTimeoutMinutes] = useWatch({
    control: form.control,
    name: ['heartbeatEnabled', 'heartbeatInterval', 'heartbeatTimeoutMinutes']
  })
  const [taskCount, setTaskCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    ipcApi
      .request('ai.agent.heartbeat.read', { agentId })
      .then((document) => {
        if (!cancelled) setTaskCount(countHeartbeatTasks(document.content))
      })
      .catch((error) => logger.warn('Failed to read heartbeat tasks for their count', { error }))
    return () => {
      cancelled = true
    }
  }, [agentId])

  return (
    <section aria-label={t('library.config.dialogs.edit.section.heartbeat')}>
      <div className="mb-1.5 px-1 text-muted-foreground text-xs">
        {t('library.config.dialogs.edit.section.heartbeat')}
      </div>
      <HeartbeatCard value={{ heartbeatEnabled, heartbeatInterval, heartbeatTimeoutMinutes }} onChange={patchAgentForm}>
        <SettingsRow
          label={t('agent.heartbeat.tasks')}
          hint={
            taskCount === null
              ? undefined
              : taskCount > 0
                ? t('library.config.dialogs.edit.heartbeat_tasks_count', { count: taskCount })
                : t('library.config.dialogs.edit.heartbeat_tasks_none')
          }>
          <Button type="button" variant="outline" size="sm" onClick={onEdit}>
            {t('agent.heartbeat.edit')}
          </Button>
        </SettingsRow>
      </HeartbeatCard>
    </section>
  )
}

/** One task per non-empty line; HTML comments are the template's guidance, not tasks. */
function countHeartbeatTasks(content: string): number {
  return content
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .split('\n')
    .filter((line) => line.trim()).length
}

function EnvVarsRow({ form }: { form: UseFormReturn<AgentEditFormValues> }) {
  const { t } = useTranslation()
  const label = t('library.config.agent.field.env_vars.label')

  return (
    <FormField
      control={form.control}
      name="envVarsText"
      render={({ field }) => (
        <SettingsRow
          label={label}
          hint={t('library.config.agent.field.env_vars.help')}
          below={
            <Textarea.Input
              value={field.value}
              onValueChange={field.onChange}
              aria-label={label}
              placeholder={t('library.config.agent.field.env_vars.placeholder')}
              rows={3}
              className="min-h-20 font-mono text-xs md:text-xs"
            />
          }
        />
      )}
    />
  )
}

/** MCP servers, after any restrictions left by the retired runtime until the user clears them. */
function AgentMcpPage({
  form,
  portalContainer
}: {
  form: UseFormReturn<AgentEditFormValues>
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const [disabledTools, mcps] = useWatch({ control: form.control, name: ['disabledTools', 'mcps'] })
  const legacyRestrictions = disabledTools.filter((name) => name.startsWith(LEGACY_DSH_TOOL_PREFIX))

  return (
    <div className="grid gap-4">
      {legacyRestrictions.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-muted-foreground text-xs">{t('library.config.tools.legacy_restrictions.description')}</p>
          <ul className="grid gap-1 text-xs">
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
      ) : null}
      <McpCapabilityList
        selectedIds={mcps}
        onSelectedIdsChange={(ids) => form.setValue('mcps', ids, { shouldDirty: true })}
        emptyLabel={t('library.config.agent.section.tools.no_mcp_bound')}
        portalContainer={portalContainer}
      />
    </div>
  )
}
