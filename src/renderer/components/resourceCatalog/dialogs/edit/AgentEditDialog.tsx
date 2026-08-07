import {
  Button,
  EditableNumber,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TabsContent,
  Textarea
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { PermissionModeIcon, PermissionModeOptionLabel } from '@renderer/components/PermissionModeOption'
import PromptEditorField from '@renderer/components/PromptEditorField'
import { SkillCatalogPicker } from '@renderer/components/resourceCatalog/dialogs/skill'
import { useAgentMutationsById } from '@renderer/hooks/resourceCatalog'
import { useCloseBeforeAction } from '@renderer/hooks/useCloseBeforeAction'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useInstalledSkills, useReconcileSkillsOnOpen } from '@renderer/hooks/useSkills'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import type { AgentDetail } from '@renderer/types/resourceCatalog'
import { permissionModeCards } from '@renderer/utils/agent'
import {
  type AgentFormState,
  applyAgentFormPatch,
  buildInitialAgentFormState,
  diffAgentSaveIntent,
  RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT
} from '@renderer/utils/resourceCatalog'
import {
  CLAUDE_KNOWLEDGE_TOOL_NAMES,
  CLAUDE_TOOL_CATEGORIES,
  type ClaudeToolCategory,
  claudeUserFacingTools
} from '@shared/ai/claudecode/toolRegistry'
import { AGENT_PROMPT } from '@shared/ai/prompts'
import type { UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { InstalledSkill } from '@shared/types/skill'
import { ToolCase, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm, type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { type CatalogItem, CatalogToggleGrid } from '../components/CatalogPicker'
import {
  AvatarField,
  CompactModelField,
  EDIT_DIALOG_PROMPT_MAX_HEIGHT,
  EDIT_DIALOG_PROMPT_MIN_HEIGHT,
  type EditDialogBaseProps,
  editDialogFormRowClassName,
  editDialogFormRowLabelClassName,
  EditDialogShell,
  type EditDialogTab,
  FieldLabelWithHelp,
  KnowledgeBaseField,
  type ModelLabels,
  TextInputField,
  useDebouncedAutoSave
} from '../components/EditDialogShared'
import { McpServerCatalogGrid } from '../components/McpServerCatalogGrid'
import { PromptPolishActions } from '../components/PromptPolishActions'

export type AgentEditDialogProps = EditDialogBaseProps & {
  resource: AgentDetail | null
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
}

type ToolTab = 'tools.builtin' | 'tools.knowledge' | 'tools.mcp' | 'tools.skills'

const logger = loggerService.withContext('AgentEditDialog')
const DEFAULT_TOOL_TAB: ToolTab = 'tools.builtin'
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
    heartbeatInterval: form.heartbeatInterval
  }
}

function modelLabelsForAgent(resource: AgentDetail): ModelLabels {
  return {
    modelId: resource.model ?? null,
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
    heartbeatInterval: values.heartbeatInterval
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
}

export function AgentEditDialog({ resource, open, onOpenChange, modelFilter, initialTab }: AgentEditDialogProps) {
  if (!resource) return null

  return (
    <AgentEditDialogContent
      resource={resource}
      open={open}
      onOpenChange={onOpenChange}
      modelFilter={modelFilter}
      initialTab={initialTab}
    />
  )
}

function AgentEditDialogContent({
  resource,
  open,
  onOpenChange,
  modelFilter,
  initialTab
}: EditDialogBaseProps & { resource: AgentDetail }) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState(initialTab ?? 'basic')
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
  useReconcileSkillsOnOpen(open && activeTab === 'tools.skills')
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
  const tabs = useMemo<EditDialogTab[]>(
    () => [
      { id: 'basic', label: t('library.config.dialogs.edit.basic_tab') },
      { id: 'prompt', label: t('library.config.dialogs.edit.prompt_tab') },
      {
        id: 'tools',
        label: t('library.config.dialogs.edit.tools_tab'),
        children: [
          { id: DEFAULT_TOOL_TAB, label: t('library.config.agent.section.tools.tab.tools') },
          { id: 'tools.knowledge', label: t('library.config.dialogs.edit.knowledge_tab') },
          { id: 'tools.mcp', label: t('library.config.agent.section.tools.tab.mcp') },
          { id: 'tools.skills', label: t('library.config.agent.section.tools.tab.skills') }
        ]
      },
      { id: 'advanced', label: t('library.config.dialogs.edit.advanced_tab') }
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
    setActiveTab(initialTab ?? 'basic')
    setEmojiPickerOpen(false)
    setModelLabels(modelLabelsForAgent(resource))
    replaceFormBaseline(buildInitialAgentFormState(resource))
    setBaselineSkillAgentId(null)
    failedSaveKeyRef.current = null
  }, [defaultValues, form, initialTab, open, replaceFormBaseline, resource])

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
  const canPersist = autoSaveChangeKey !== null
  const saveFailedMessage = t('library.config.dialogs.edit.save_failed')

  const persist = async () => {
    // Recompute from refs at execution time: the serialized autosave queue may
    // start its follow-up pass before React has rendered the baseline state
    // advanced by the previous pass.
    const submittedValues = form.getValues()
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
  const flush = useDebouncedAutoSave({
    enabled: open,
    changeKey: autoSaveChangeKey,
    onSave: persist
  })

  // On close with a pending edit, flush through the same serialized save queue and
  // only close once it settles — so a failed final save stays visible instead of
  // being silently dropped, and we never race a second concurrent save.
  const handleOpenChange = (next: boolean) => {
    if (next || !canPersist) {
      onOpenChange(next)
      return
    }
    if (failedSaveKeyRef.current === autoSaveChangeKey) {
      toast.error(saveFailedMessage)
      return
    }
    void (async () => {
      await flush()
      if (failedSaveKeyRef.current !== null) return
      onOpenChange(false)
    })()
  }
  // Route the settings-navigate close through handleOpenChange so it flushes too.
  const closeBeforeAction = useCloseBeforeAction(handleOpenChange)

  return (
    <EditDialogShell
      activeTab={activeTab}
      form={form}
      onActiveTabChange={setActiveTab}
      onOpenChange={handleOpenChange}
      open={open}
      rootError={rootError}
      setDialogContentElement={setDialogContentElement}
      groupPresentation="inline"
      tabs={tabs}
      title={t('library.config.dialogs.edit.agent_title')}>
      <>
        <TabsContent value="basic" forceMount hidden={activeTab !== 'basic'} className="m-0">
          <AgentBasicFields
            form={form}
            modelFilter={modelFilter}
            portalContainer={dialogContentElement}
            modelLabels={modelLabels}
            setModelLabels={setModelLabels}
            patchAgentForm={patchAgentForm}
            emojiPickerOpen={emojiPickerOpen}
            setEmojiPickerOpen={setEmojiPickerOpen}
            onSettingsNavigate={closeBeforeAction}
          />
        </TabsContent>
        <TabsContent
          value="prompt"
          forceMount
          hidden={activeTab !== 'prompt'}
          className="m-0 flex h-full min-h-0 flex-col">
          <AgentPromptField form={form} />
        </TabsContent>
        {isToolTab(activeTab) ? (
          <TabsContent value={activeTab} forceMount className="m-0">
            <AgentToolsFields
              agent={resource}
              form={form}
              activeToolTab={activeTab}
              portalContainer={dialogContentElement}
              skills={skills}
              skillsLoading={skillsLoading}
              skillsReady={baselineSkillAgentId === resource.id}
            />
          </TabsContent>
        ) : null}
        <TabsContent value="advanced" forceMount hidden={activeTab !== 'advanced'} className="m-0">
          <AgentAdvancedFields form={form} />
        </TabsContent>
      </>
    </EditDialogShell>
  )
}

function AgentBasicFields({
  form,
  modelFilter,
  portalContainer,
  modelLabels,
  setModelLabels,
  patchAgentForm,
  emojiPickerOpen,
  setEmojiPickerOpen,
  onSettingsNavigate
}: {
  form: UseFormReturn<AgentEditFormValues>
  modelFilter?: (model: Model) => boolean
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
  patchAgentForm: (patch: Partial<AgentFormState>) => void
  emojiPickerOpen: boolean
  setEmojiPickerOpen: (open: boolean) => void
  onSettingsNavigate?: (navigate: () => void) => void
}) {
  const { t } = useTranslation()
  const heartbeatEnabled = form.watch('heartbeatEnabled')

  return (
    <div className="divide-y divide-border-subtle border-border-subtle border-b [&>*:first-child]:pt-0">
      <AvatarField
        form={form}
        emojiPickerOpen={emojiPickerOpen}
        setEmojiPickerOpen={setEmojiPickerOpen}
        fallback="🤖"
        portalContainer={portalContainer}
        size="sm"
        layout="row"
      />
      <TextInputField
        form={form}
        name="name"
        label={t('library.config.agent.field.name.label')}
        placeholder={t('library.config.agent.field.name.placeholder')}
        required
        layout="row"
      />
      <TextInputField
        form={form}
        name="description"
        label={t('library.config.agent.field.description.label')}
        placeholder={t('library.config.agent.field.description.placeholder')}
        layout="row"
      />
      <CompactModelField
        form={form}
        name="modelId"
        label={t('library.config.agent.field.model.label')}
        filter={modelFilter}
        portalContainer={portalContainer}
        modelLabels={modelLabels}
        setModelLabels={setModelLabels}
        onModelChange={(modelId) => patchAgentForm({ model: modelId ?? '' })}
        onSettingsNavigate={onSettingsNavigate}
        layout="row"
        triggerClassName="h-9 rounded-md border border-input bg-transparent px-3 hover:bg-accent/50"
      />
      <CompactModelField
        form={form}
        name="planModelId"
        label={t('library.config.agent.field.plan_model.label')}
        allowClear
        filter={modelFilter}
        portalContainer={portalContainer}
        modelLabels={modelLabels}
        setModelLabels={setModelLabels}
        onModelChange={(modelId) => patchAgentForm({ planModel: modelId ?? '' })}
        onSettingsNavigate={onSettingsNavigate}
        layout="row"
        triggerClassName="h-9 rounded-md border border-input bg-transparent px-3 hover:bg-accent/50"
      />
      <CompactModelField
        form={form}
        name="smallModelId"
        label={t('library.config.agent.field.small_model.label')}
        allowClear
        filter={modelFilter}
        portalContainer={portalContainer}
        modelLabels={modelLabels}
        setModelLabels={setModelLabels}
        onModelChange={(modelId) => patchAgentForm({ smallModel: modelId ?? '' })}
        onSettingsNavigate={onSettingsNavigate}
        layout="row"
        triggerClassName="h-9 rounded-md border border-input bg-transparent px-3 hover:bg-accent/50"
      />
      <PermissionModeField form={form} portalContainer={portalContainer} patchAgentForm={patchAgentForm} />
      <HeartbeatSettingsField
        form={form}
        enabled={heartbeatEnabled}
        onEnabledChange={(checked) => patchAgentForm({ heartbeatEnabled: checked })}
      />
    </div>
  )
}

function PermissionModeField({
  form,
  portalContainer,
  patchAgentForm
}: {
  form: UseFormReturn<AgentEditFormValues>
  portalContainer: HTMLElement | null
  patchAgentForm: (patch: Partial<AgentFormState>) => void
}) {
  const { t } = useTranslation()
  const permissionMode = useWatch({ control: form.control, name: 'permissionMode' }) || 'default'
  const selectedPermissionModeCard = permissionModeCards.find((card) => card.mode === permissionMode)

  return (
    <FormField
      control={form.control}
      name="permissionMode"
      render={({ field }) => (
        <FormItem className={editDialogFormRowClassName}>
          <FormLabel className={editDialogFormRowLabelClassName}>
            {t('library.config.agent.field.permission_mode.label')}
          </FormLabel>
          <Select value={field.value || 'default'} onValueChange={(value) => patchAgentForm({ permissionMode: value })}>
            <FormControl>
              <SelectTrigger
                className="h-9 w-full rounded-md"
                aria-label={t('library.config.agent.field.permission_mode.label')}>
                {/* Own children so the trigger stays one line: the items below are two. */}
                <SelectValue>
                  {selectedPermissionModeCard && (
                    <span className={selectedPermissionModeCard.dangerous ? 'text-destructive' : undefined}>
                      {t(selectedPermissionModeCard.titleKey, selectedPermissionModeCard.titleFallback)}
                    </span>
                  )}
                </SelectValue>
              </SelectTrigger>
            </FormControl>
            <SelectContent portalContainer={portalContainer}>
              {permissionModeCards.map((card) => (
                <SelectItem key={card.mode} value={card.mode}>
                  <div className="flex items-center gap-2">
                    <PermissionModeIcon mode={card.mode} size={16} />
                    <PermissionModeOptionLabel card={card} t={t} />
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage className="col-start-2" />
        </FormItem>
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
    <div className="divide-y divide-border-subtle">
      <FormField
        control={form.control}
        name="heartbeatEnabled"
        render={({ field }) => (
          <FormItem className={editDialogFormRowClassName}>
            <FormLabel className={editDialogFormRowLabelClassName}>{label}</FormLabel>
            <FormControl>
              <div className="flex h-9 items-center">
                <Switch size="sm" checked={field.value} onCheckedChange={onEnabledChange} aria-label={label} />
              </div>
            </FormControl>
            <FormMessage className="col-start-2" />
          </FormItem>
        )}
      />
      {enabled ? (
        <FormField
          control={form.control}
          name="heartbeatInterval"
          render={({ field }) => (
            <FormItem className={editDialogFormRowClassName}>
              <FormLabel className={editDialogFormRowLabelClassName}>
                {t('library.config.agent.field.heartbeat_interval.label')}
              </FormLabel>
              <FormControl>
                <EditableNumber
                  min={1}
                  max={1440}
                  step={1}
                  precision={0}
                  align="start"
                  changeOnBlur
                  className="h-9 w-full"
                  value={field.value || null}
                  onChange={(v) => field.onChange(typeof v === 'number' ? v : 0)}
                />
              </FormControl>
              <FormMessage className="col-start-2" />
            </FormItem>
          )}
        />
      ) : null}
    </div>
  )
}

function AgentPromptField({ form }: { form: UseFormReturn<AgentEditFormValues> }) {
  const { t } = useTranslation()
  const [resetPreviewKey, setResetPreviewKey] = useState(0)
  const name = useWatch({ control: form.control, name: 'name' })

  return (
    <FormField
      control={form.control}
      name="instructions"
      render={({ field }) => {
        const handlePromptActionChange = (instructions: string) => {
          field.onChange(instructions)
          setResetPreviewKey((key) => key + 1)
        }

        return (
          <PromptEditorField
            label={<FieldLabelWithHelp label={t('library.config.agent.field.instructions.label')} formLabel={false} />}
            value={field.value}
            onChange={field.onChange}
            placeholder={t('library.config.agent.field.instructions.placeholder')}
            resetPreviewKey={resetPreviewKey}
            fill
            actions={
              <PromptPolishActions
                value={field.value}
                fallbackSource={name}
                emptyValueSystemPrompt={AGENT_PROMPT}
                existingValueSystemPrompt={RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT}
                onChange={handlePromptActionChange}
              />
            }
            minHeight={EDIT_DIALOG_PROMPT_MIN_HEIGHT}
            maxHeight={EDIT_DIALOG_PROMPT_MAX_HEIGHT}
          />
        )
      }}
    />
  )
}

function AgentToolsFields({
  agent,
  form,
  activeToolTab,
  portalContainer,
  skills,
  skillsLoading,
  skillsReady
}: {
  agent: AgentDetail
  form: UseFormReturn<AgentEditFormValues>
  activeToolTab: ToolTab
  portalContainer: HTMLElement | null
  skills: InstalledSkill[]
  skillsLoading: boolean
  skillsReady: boolean
}) {
  const { t } = useTranslation()
  const disabledTools = form.watch('disabledTools')
  const mcps = form.watch('mcps')
  const knowledgeBaseIds = form.watch('knowledgeBaseIds')
  const skillIds = form.watch('skillIds')
  const canManageSkills = Boolean(agent.id)

  // Built-in catalog: registry user-facing tools grouped into category sections.
  // The toggle is a real enable/disable that writes the opt-out `disabledTools` set
  // (empty = all enabled); approval is governed solely by the permission-mode cards.
  // The kb_* tools are only injected once a knowledge base is bound (runtime gating),
  // so hide their toggles here when the agent has none — they would otherwise read as
  // "on" while doing nothing.
  const hasKnowledgeScope = knowledgeBaseIds.length > 0
  const disabledSet = useMemo(() => new Set(disabledTools), [disabledTools])
  const builtinSections = useMemo(() => {
    const tools = claudeUserFacingTools().filter(
      (tool) => hasKnowledgeScope || !CLAUDE_KNOWLEDGE_TOOL_NAMES.has(tool.name)
    )
    return CLAUDE_TOOL_CATEGORIES.map((category) => ({
      category,
      label: t(CATEGORY_LABEL_KEYS[category], CATEGORY_LABEL_FALLBACKS[category]),
      items: tools
        .filter((tool) => tool.category === category)
        .map<CatalogItem>((tool) => ({
          id: tool.name,
          name: t(`agent.tools.builtin.${tool.key}.label`, tool.label),
          description: t(`agent.tools.builtin.${tool.key}.description`, tool.description),
          icon: <Wrench size={13} strokeWidth={1.5} className="text-muted-foreground" />
        }))
    })).filter((section) => section.items.length > 0)
  }, [t, hasKnowledgeScope])
  const enabledToolIds = useMemo<ReadonlySet<string>>(
    () => new Set(builtinSections.flatMap((s) => s.items.map((i) => i.id)).filter((id) => !disabledSet.has(id))),
    [builtinSections, disabledSet]
  )
  const setToolEnabled = (name: string, enabled: boolean) =>
    form.setValue('disabledTools', enabled ? disabledTools.filter((n) => n !== name) : [...disabledTools, name], {
      shouldDirty: true
    })

  const mcpIds = useMemo(() => new Set(mcps), [mcps])
  const enableMCP = (id: string) => form.setValue('mcps', [...mcps, id], { shouldDirty: true })
  const disableMCP = (id: string) =>
    form.setValue(
      'mcps',
      mcps.filter((mcpId) => mcpId !== id),
      { shouldDirty: true }
    )

  return (
    <div className="grid gap-4">
      {activeToolTab === 'tools.builtin' ? (
        <div className="grid gap-5">
          {builtinSections.map((section) => (
            <div key={section.category} className="grid gap-2">
              <div className="font-medium text-muted-foreground text-xs">{section.label}</div>
              <CatalogToggleGrid
                items={section.items}
                enabledIds={enabledToolIds}
                onToggle={setToolEnabled}
                emptyLabel={t('library.config.agent.section.tools.no_builtin_enabled')}
                portalContainer={portalContainer}
              />
            </div>
          ))}
        </div>
      ) : null}
      {activeToolTab === 'tools.knowledge' ? (
        <KnowledgeBaseField form={form} portalContainer={portalContainer} />
      ) : null}
      {activeToolTab === 'tools.mcp' ? (
        <McpServerCatalogGrid
          title={t('library.config.tools.added')}
          enabledIds={mcpIds}
          onToggle={(id, enabled) => (enabled ? enableMCP(id) : disableMCP(id))}
          emptyLabel={t('library.config.agent.section.tools.no_mcp_bound')}
          portalContainer={portalContainer}
        />
      ) : null}
      {activeToolTab === 'tools.skills' ? (
        <SkillCatalogPicker
          mode="edit"
          skills={skills}
          loading={skillsLoading}
          selectedIds={skillIds}
          disabled={!canManageSkills || !skillsReady}
          onSelectedIdsChange={(ids) => form.setValue('skillIds', ids, { shouldDirty: true })}
          emptyLabel={
            canManageSkills
              ? t('library.config.agent.section.tools.no_skills_enabled')
              : t('library.config.agent.section.tools.skills_require_save')
          }
          portalContainer={portalContainer}
          trailingItem={
            <Button
              type="button"
              variant="ghost"
              onClick={openSkillsSettingsTab}
              className="h-full min-h-11 w-full rounded-lg border border-border-subtle border-dashed px-2.5 py-1.5 font-normal text-muted-foreground text-sm shadow-none transition-colors hover:border-border-strong hover:bg-accent/50 hover:text-foreground">
              <ToolCase size={14} strokeWidth={1.7} />
              {t('agent.settings.skills.addMore')}
            </Button>
          }
        />
      ) : null}
    </div>
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
