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
import { useModelById } from '@renderer/hooks/useModel'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { useInstalledSkills, useReconcileSkillsOnOpen } from '@renderer/hooks/useSkills'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import type { AgentDetail } from '@renderer/types/resourceCatalog'
import { permissionModeCards } from '@renderer/utils/agent'
import { normalizePermissionMode } from '@renderer/utils/agent/permissionMode'
import {
  agentEnvVarsFromText,
  buildInitialAgentFormState,
  RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT
} from '@renderer/utils/resourceCatalog'
import {
  CLAUDE_KNOWLEDGE_TOOL_NAMES,
  CLAUDE_TOOL_CATEGORIES,
  type ClaudeToolCategory,
  claudeUserFacingTools
} from '@shared/ai/claudecode/toolRegistry'
import { AGENT_PROMPT } from '@shared/ai/prompts'
import type { AgentSkillUpdateDto, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { AgentConfiguration } from '@shared/data/types/agent'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { InstalledSkill } from '@shared/types/skill'
import { ToolCase, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Path, useForm, type UseFormReturn, useWatch } from 'react-hook-form'
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
  PromptVariablesPopover,
  TextInputField
} from '../components/EditDialogShared'
import { McpServerCatalogGrid } from '../components/McpServerCatalogGrid'
import { PromptPolishActions } from '../components/PromptPolishActions'
import { useDirectFieldSave } from '../components/useDirectFieldSave'

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
    modelId: resource.modelName ?? null,
    planModelId: resource.planModel ?? null,
    smallModelId: resource.smallModel ?? null,
    contextCompressModelId: null
  }
}

/**
 * Combine a queued PATCH with a newer one. `configuration` is merged key-by-key
 * (main merges the sub-keys it receives onto the persisted object) and
 * `skillUpdates` is deduplicated per skill so the last toggle wins.
 */
function mergeAgentPatch(base: UpdateAgentDto, next: UpdateAgentDto): UpdateAgentDto {
  const merged: UpdateAgentDto = { ...base, ...next }
  if (base.configuration || next.configuration) {
    merged.configuration = { ...base.configuration, ...next.configuration }
  }
  if (base.skillUpdates || next.skillUpdates) {
    const bySkillId = new Map<string, AgentSkillUpdateDto>()
    for (const update of [...(base.skillUpdates ?? []), ...(next.skillUpdates ?? [])]) {
      bySkillId.set(update.skillId, update)
    }
    merged.skillUpdates = [...bySkillId.values()]
  }
  return merged
}

/**
 * `max_turns` is a retired field this dialog never surfaces; clear it whenever
 * we touch the configuration so it cannot linger on the persisted object.
 */
function agentConfigurationPatch(configuration: AgentConfiguration): UpdateAgentDto {
  return { configuration: { ...configuration, max_turns: undefined } }
}

/**
 * Writes one draft field and persists just that field. Same contract as the
 * assistant editor — every control owns its own PATCH.
 */
type AgentEditor = {
  form: UseFormReturn<AgentEditFormValues>
  discard: (...keys: (keyof UpdateAgentDto)[]) => void
  set: (values: Partial<AgentEditFormValues>, patch: UpdateAgentDto, mode?: 'now' | 'debounced') => void
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
  const [skillsSeededForAgentId, setSkillsSeededForAgentId] = useState<string | null>(null)
  const defaultValues = useMemo(() => defaultValuesForAgent(resource), [resource])
  const form = useForm<AgentEditFormValues>({ defaultValues })
  const modelId = form.watch('modelId')
  const { model: selectedAgentModel } = useModelById(modelId)
  const promptModelName = selectedAgentModel?.name ?? (modelId === resource.model ? resource.modelName : undefined)
  const { updateAgent } = useAgentMutationsById(resource.id)
  const saveFailedMessage = t('library.config.dialogs.edit.save_failed')
  const saveFailureToastKey = `agent-edit-save-failed:${resource.id}`
  const save = useDirectFieldSave<UpdateAgentDto>({
    save: updateAgent,
    merge: mergeAgentPatch,
    onError: (error, retry) => {
      logger.error('Failed to save agent edit dialog', error, { agentId: resource.id })
      toast.error({
        key: saveFailureToastKey,
        timeout: 0,
        title: saveFailedMessage,
        description: (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto min-h-0 px-1 py-0 text-xs underline-offset-2 hover:underline"
            onClick={() => {
              toast.closeToast(saveFailureToastKey)
              retry()
            }}>
            {t('common.retry')}
          </Button>
        )
      })
    }
  })
  // Close the failure toast only on recovery. The toast outlives this dialog on
  // purpose (it carries the retry for an edit that never landed), and the key is
  // per-agent — closing it on mount would silently drop that retry the next time
  // the same agent is opened.
  const previousSaveStatusRef = useRef(save.status)
  useEffect(() => {
    if (previousSaveStatusRef.current === 'failed' && save.status !== 'failed') {
      toast.closeToast(saveFailureToastKey)
    }
    previousSaveStatusRef.current = save.status
  }, [save.status, saveFailureToastKey])
  const setField = useCallback<AgentEditor['set']>(
    (values, patch, mode = 'now') => {
      for (const [key, value] of Object.entries(values)) {
        form.setValue(key as Path<AgentEditFormValues>, value as never, {
          shouldDirty: true,
          shouldValidate: key === 'name'
        })
      }
      if (mode === 'debounced') save.schedule(patch)
      else save.commit(patch)
    },
    [form, save]
  )
  const editor = useMemo<AgentEditor>(
    () => ({ form, discard: save.discard, set: setField }),
    [form, save.discard, setField]
  )
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
    setSkillsSeededForAgentId(null)
  }, [defaultValues, form, initialTab, open, resource])

  // Cached skill rows may render during revalidation, so seed the draft only
  // from the authoritative projection — a toggle diffs against what it shows.
  useEffect(() => {
    if (!open || skillsLoading || skillsRefreshing || skillsSeededForAgentId === resource.id) return
    form.setValue('skillIds', skillIdsFromQuery, { shouldDirty: false })
    setSkillsSeededForAgentId(resource.id)
  }, [form, open, resource.id, skillIdsFromQuery, skillsLoading, skillsRefreshing, skillsSeededForAgentId])

  useEffect(() => {
    if (!open || knowledgeBasesLoading) return

    // Drop bindings that disappeared from the knowledge-base directory after a
    // delete. Draft-only: the agent row already lost them, so there is nothing
    // left to persist.
    const currentIds = form.getValues('knowledgeBaseIds')
    const convergedIds = currentIds.filter((id) => availableKnowledgeBaseIds.has(id))
    if (convergedIds.length !== currentIds.length) {
      form.setValue('knowledgeBaseIds', convergedIds, { shouldDirty: false })
    }
  }, [availableKnowledgeBaseIds, form, knowledgeBasesLoading, open])

  useEffect(() => {
    if (leafTabIds.has(activeTab)) return
    setActiveTab('basic')
  }, [activeTab, leafTabIds])

  // Send whatever is still debounced, then close regardless of the outcome: a
  // rejected field save is reported by the queue, never by trapping the user.
  const handleOpenChange = (next: boolean) => {
    if (!next) void save.flush()
    onOpenChange(next)
  }
  // Route the settings-navigate close through handleOpenChange so it flushes too.
  const closeBeforeAction = useCloseBeforeAction(handleOpenChange)

  return (
    <EditDialogShell
      activeTab={activeTab}
      form={form}
      onActiveTabChange={setActiveTab}
      onOpenChange={handleOpenChange}
      onRetrySave={save.retry}
      open={open}
      saveStatus={save.status}
      setDialogContentElement={setDialogContentElement}
      groupPresentation="inline"
      tabs={tabs}
      title={t('library.config.dialogs.edit.agent_title')}>
      <>
        <TabsContent value="basic" forceMount hidden={activeTab !== 'basic'} className="m-0">
          <AgentBasicFields
            editor={editor}
            modelFilter={modelFilter}
            portalContainer={dialogContentElement}
            modelLabels={modelLabels}
            setModelLabels={setModelLabels}
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
          <AgentPromptField
            editor={editor}
            modelName={promptModelName ?? null}
            portalContainer={dialogContentElement}
          />
        </TabsContent>
        {isToolTab(activeTab) ? (
          <TabsContent value={activeTab} forceMount className="m-0">
            <AgentToolsFields
              agent={resource}
              editor={editor}
              activeToolTab={activeTab}
              portalContainer={dialogContentElement}
              skills={skills}
              skillsLoading={skillsLoading}
              skillsReady={skillsSeededForAgentId === resource.id}
            />
          </TabsContent>
        ) : null}
        <TabsContent value="advanced" forceMount hidden={activeTab !== 'advanced'} className="m-0">
          <AgentAdvancedFields editor={editor} />
        </TabsContent>
      </>
    </EditDialogShell>
  )
}

function AgentBasicFields({
  editor,
  modelFilter,
  portalContainer,
  modelLabels,
  setModelLabels,
  emojiPickerOpen,
  setEmojiPickerOpen,
  onSettingsNavigate
}: {
  editor: AgentEditor
  modelFilter?: (model: Model) => boolean
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
  emojiPickerOpen: boolean
  setEmojiPickerOpen: (open: boolean) => void
  onSettingsNavigate?: (navigate: () => void) => void
}) {
  const { t } = useTranslation()
  const { form, discard, set } = editor
  const heartbeatEnabled = form.watch('heartbeatEnabled')

  const handleNameChange = (name: string) => {
    // An empty name is a transient editing state, not a persistable value: keep
    // it in the draft, surface the required message, and skip the PATCH.
    const trimmed = name.trim()
    if (!trimmed) {
      discard('name')
      form.setValue('name', name, { shouldDirty: true, shouldValidate: true })
      return
    }
    set({ name }, { name: trimmed }, 'debounced')
  }

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
        onValueChange={(avatar) => set({ avatar }, agentConfigurationPatch({ avatar }))}
      />
      <TextInputField
        form={form}
        name="name"
        label={t('library.config.agent.field.name.label')}
        placeholder={t('library.config.agent.field.name.placeholder')}
        required
        layout="row"
        onValueChange={handleNameChange}
      />
      <TextInputField
        form={form}
        name="description"
        label={t('library.config.agent.field.description.label')}
        placeholder={t('library.config.agent.field.description.placeholder')}
        layout="row"
        onValueChange={(description) => set({ description }, { description }, 'debounced')}
      />
      <CompactModelField
        form={form}
        name="modelId"
        label={t('library.config.agent.field.model.label')}
        filter={modelFilter}
        portalContainer={portalContainer}
        modelLabels={modelLabels}
        setModelLabels={setModelLabels}
        onModelChange={(nextModelId) => {
          // The primary model has no clear affordance; an empty pick is a draft
          // state with nothing to persist.
          if (!nextModelId) {
            form.setValue('modelId', null, { shouldDirty: true })
            return
          }
          set({ modelId: nextModelId }, { model: nextModelId })
        }}
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
        onModelChange={(modelId) => set({ planModelId: modelId ?? '' }, { planModel: modelId ?? null })}
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
        onModelChange={(modelId) => set({ smallModelId: modelId ?? '' }, { smallModel: modelId ?? null })}
        onSettingsNavigate={onSettingsNavigate}
        layout="row"
        triggerClassName="h-9 rounded-md border border-input bg-transparent px-3 hover:bg-accent/50"
      />
      <PermissionModeField editor={editor} portalContainer={portalContainer} />
      <HeartbeatSettingsField editor={editor} enabled={heartbeatEnabled} />
    </div>
  )
}

function PermissionModeField({
  editor,
  portalContainer
}: {
  editor: AgentEditor
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const { form, set } = editor
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
          <Select
            value={field.value || 'default'}
            onValueChange={(value) => {
              const permissionMode = normalizePermissionMode(value)
              set({ permissionMode }, agentConfigurationPatch({ permission_mode: permissionMode }))
            }}>
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

function HeartbeatSettingsField({ editor, enabled }: { editor: AgentEditor; enabled: boolean }) {
  const { t } = useTranslation()
  const { form, set } = editor
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
                <Switch
                  size="sm"
                  checked={field.value}
                  onCheckedChange={(checked) =>
                    set({ heartbeatEnabled: checked }, agentConfigurationPatch({ heartbeat_enabled: checked }))
                  }
                  aria-label={label}
                />
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
                  onChange={(v) => {
                    const heartbeatInterval = typeof v === 'number' ? v : 0
                    // This control only renders while the feature is on, so send
                    // the pair the runtime expects rather than an orphan interval.
                    set(
                      { heartbeatInterval },
                      agentConfigurationPatch({ heartbeat_enabled: true, heartbeat_interval: heartbeatInterval })
                    )
                  }}
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

function AgentPromptField({
  editor,
  modelName,
  portalContainer
}: {
  editor: AgentEditor
  modelName: string | null
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const { form, set } = editor
  const [resetPreviewKey, setResetPreviewKey] = useState(0)
  const instructions = form.watch('instructions')
  const name = form.watch('name')
  const processedInstructions = usePromptProcessor({
    prompt: instructions,
    modelName: modelName ?? undefined
  })

  const handlePromptChange = (nextInstructions: string) => {
    set({ instructions: nextInstructions }, { instructions: nextInstructions }, 'debounced')
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
            />
          }
          minHeight={EDIT_DIALOG_PROMPT_MIN_HEIGHT}
          maxHeight={EDIT_DIALOG_PROMPT_MAX_HEIGHT}
        />
      )}
    />
  )
}

function AgentToolsFields({
  agent,
  editor,
  activeToolTab,
  portalContainer,
  skills,
  skillsLoading,
  skillsReady
}: {
  agent: AgentDetail
  editor: AgentEditor
  activeToolTab: ToolTab
  portalContainer: HTMLElement | null
  skills: InstalledSkill[]
  skillsLoading: boolean
  skillsReady: boolean
}) {
  const { t } = useTranslation()
  const { form, set } = editor
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
  const setToolEnabled = (name: string, enabled: boolean) => {
    const next = enabled ? disabledTools.filter((n) => n !== name) : [...disabledTools, name]
    set({ disabledTools: next }, { disabledTools: next }, 'debounced')
  }

  const mcpIds = useMemo(() => new Set(mcps), [mcps])
  const setMcpEnabled = (id: string, enabled: boolean) => {
    const next = enabled ? [...mcps, id] : mcps.filter((mcpId) => mcpId !== id)
    set({ mcps: next }, { mcps: next }, 'debounced')
  }

  // Skills persist as per-skill toggles, so send only the ids whose enablement
  // actually flipped rather than the whole selection.
  const setSkillIds = (nextSkillIds: string[]) => {
    const before = new Set(skillIds)
    const after = new Set(nextSkillIds)
    const skillUpdates: AgentSkillUpdateDto[] = [
      ...skillIds.filter((id) => !after.has(id)).map((skillId) => ({ skillId, isEnabled: false })),
      ...nextSkillIds.filter((id) => !before.has(id)).map((skillId) => ({ skillId, isEnabled: true }))
    ]
    if (skillUpdates.length === 0) return
    set({ skillIds: nextSkillIds }, { skillUpdates }, 'debounced')
  }

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
        <KnowledgeBaseField
          form={form}
          portalContainer={portalContainer}
          onValueChange={(knowledgeBaseIds) => set({ knowledgeBaseIds }, { knowledgeBaseIds }, 'debounced')}
        />
      ) : null}
      {activeToolTab === 'tools.mcp' ? (
        <McpServerCatalogGrid
          title={t('library.config.tools.added')}
          enabledIds={mcpIds}
          onToggle={setMcpEnabled}
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
          onSelectedIdsChange={setSkillIds}
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

function AgentAdvancedFields({ editor }: { editor: AgentEditor }) {
  const { t } = useTranslation()
  const { form, set } = editor

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
                onValueChange={(envVarsText) =>
                  set(
                    { envVarsText },
                    agentConfigurationPatch({ env_vars: agentEnvVarsFromText(envVarsText) }),
                    'debounced'
                  )
                }
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
