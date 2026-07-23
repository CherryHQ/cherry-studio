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
import PromptEditorField from '@renderer/components/PromptEditorField'
import { SkillCatalogPicker } from '@renderer/components/resourceCatalog/dialogs/skill'
import { useAgentMutationsById } from '@renderer/hooks/resourceCatalog'
import { useCloseBeforeAction } from '@renderer/hooks/useCloseBeforeAction'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
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
  CLAUDE_TOOL_CATEGORIES,
  type ClaudeToolCategory,
  claudeUserFacingTools
} from '@shared/ai/claudecode/toolRegistry'
import { AGENT_PROMPT } from '@shared/ai/prompts'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { InstalledSkill } from '@shared/types/skill'
import { ToolCase, Wrench } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { type CatalogItem, CatalogToggleGrid } from '../components/CatalogPicker'
import {
  AvatarField,
  CompactModelField,
  EDIT_DIALOG_PROMPT_MAX_HEIGHT,
  EDIT_DIALOG_PROMPT_MIN_HEIGHT,
  type EditDialogBaseProps,
  EditDialogShell,
  type EditDialogTab,
  FieldLabelWithHelp,
  type ModelLabels,
  PromptVariablesPopover,
  TextInputField,
  useDebouncedAutoSave
} from '../components/EditDialogShared'
import { McpServerCatalogGrid } from '../components/McpServerCatalogGrid'
import { PromptPolishActions } from '../components/PromptPolishActions'

export type AgentEditDialogProps = EditDialogBaseProps<AgentDetail> & {
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
  skillIds: string[]
  disabledTools: string[]
  permissionMode: string
  envVarsText: string
  heartbeatEnabled: boolean
  heartbeatInterval: number
}

type ToolTab = 'tools.builtin' | 'tools.mcp' | 'tools.skills'

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
  return value === 'tools.builtin' || value === 'tools.mcp' || value === 'tools.skills'
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
    smallModelId: resource.smallModel ?? null
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
    mcps: values.mcps,
    skillIds: values.skillIds,
    disabledTools: values.disabledTools,
    permissionMode: values.permissionMode,
    envVarsText: values.envVarsText,
    heartbeatEnabled: values.heartbeatEnabled,
    heartbeatInterval: values.heartbeatInterval
  }
}

function syncAgentFormState(form: UseFormReturn<AgentEditFormValues>, next: AgentFormState) {
  form.setValue('modelId', next.model || null, { shouldDirty: true })
  form.setValue('planModelId', next.planModel, { shouldDirty: true })
  form.setValue('smallModelId', next.smallModel, { shouldDirty: true })
  form.setValue('mcps', next.mcps, { shouldDirty: true })
  form.setValue('skillIds', next.skillIds, { shouldDirty: true })
  form.setValue('disabledTools', next.disabledTools, { shouldDirty: true })
  form.setValue('permissionMode', next.permissionMode, { shouldDirty: true })
  form.setValue('heartbeatEnabled', next.heartbeatEnabled, { shouldDirty: true })
  form.setValue('heartbeatInterval', next.heartbeatInterval, { shouldDirty: true })
}

function createAgentPatcher(form: UseFormReturn<AgentEditFormValues>, resource: AgentDetail) {
  return (patch: Partial<AgentFormState>) => {
    const baseline = buildInitialAgentFormState(resource)
    const current = buildAgentFormState(baseline, form.getValues())
    syncAgentFormState(form, applyAgentFormPatch(current, patch))
  }
}

export function AgentEditDialog({
  resource,
  open,
  onOpenChange,
  onSaved,
  modelFilter,
  initialTab
}: AgentEditDialogProps) {
  if (!resource) return null

  return (
    <AgentEditDialogContent
      resource={resource}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      modelFilter={modelFilter}
      initialTab={initialTab}
    />
  )
}

function AgentEditDialogContent({
  resource,
  open,
  onOpenChange,
  onSaved,
  modelFilter,
  initialTab
}: EditDialogBaseProps<AgentDetail> & { resource: AgentDetail }) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState(initialTab ?? 'basic')
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [dialogContentElement, setDialogContentElement] = useState<HTMLDivElement | null>(null)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(() => modelLabelsForAgent(resource))
  const [baselineSkillIds, setBaselineSkillIds] = useState<string[]>([])
  const [baselineSkillAgentId, setBaselineSkillAgentId] = useState<string | null>(null)
  const defaultValues = useMemo(() => defaultValuesForAgent(resource), [resource])
  const form = useForm<AgentEditFormValues>({ defaultValues })
  const values = form.watch()
  const patchAgentForm = useMemo(() => createAgentPatcher(form, resource), [form, resource])
  const { updateAgent } = useAgentMutationsById(resource.id)
  const {
    skills,
    loading: skillsLoading,
    refreshing: skillsRefreshing
  } = useInstalledSkills(resource.id || undefined, {
    enabled: open && Boolean(resource.id)
  })
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
  const saveIntent = useMemo(() => {
    const baseline = buildInitialAgentFormState(resource, baselineSkillIds)
    return diffAgentSaveIntent(buildAgentFormState(baseline, values), baseline, resource)
  }, [baselineSkillIds, resource, values])
  const tabs = useMemo<EditDialogTab[]>(
    () => [
      { id: 'basic', label: t('library.config.dialogs.edit.basic_tab') },
      { id: 'prompt', label: t('library.config.dialogs.edit.prompt_tab') },
      {
        id: 'tools',
        label: t('library.config.dialogs.edit.tools_tab'),
        children: [
          { id: DEFAULT_TOOL_TAB, label: t('library.config.agent.section.tools.tab.tools') },
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
    setBaselineSkillIds([])
    setBaselineSkillAgentId(null)
  }, [defaultValues, form, initialTab, open, resource])

  // Cached rows may render during revalidation, but the editable baseline must
  // come from the authoritative projection so later toggles diff correctly.
  useEffect(() => {
    if (!open || skillsLoading || skillsRefreshing || baselineSkillAgentId === resource.id) return
    setBaselineSkillIds(skillIdsFromQuery)
    form.setValue('skillIds', skillIdsFromQuery, { shouldDirty: false })
    setBaselineSkillAgentId(resource.id)
  }, [baselineSkillAgentId, form, open, resource.id, skillIdsFromQuery, skillsLoading, skillsRefreshing])

  useEffect(() => {
    if (leafTabIds.has(activeTab)) return
    setActiveTab('basic')
  }, [activeTab, leafTabIds])

  const rootError = form.formState.errors.root?.message
  const canPersist = Boolean(saveIntent) && values.name.trim().length > 0
  // Tracks whether the most recent save attempt failed, so the close path can
  // keep the dialog open (and the error visible) instead of closing over a loss.
  const saveFailedRef = useRef(false)

  const persist = async () => {
    const pending = saveIntent
    if (!pending) return

    form.clearErrors('root')
    saveFailedRef.current = false

    let updated: Awaited<ReturnType<typeof updateAgent>>
    try {
      updated = await updateAgent(pending.payload)
    } catch (error) {
      logger.error('Failed to auto-save agent edit dialog', error as Error, { agentId: resource.id })
      form.setError('root', { message: t('library.config.dialogs.edit.save_failed') })
      saveFailedRef.current = true
      return
    }

    try {
      await onSaved(updated)
    } catch (error) {
      logger.warn('Failed to run agent edit dialog post-save callback', { error, agentId: resource.id })
    }
  }

  // Key the debounce on the form values (user input), not on saveIntent: the
  // update mutation refreshes /agents/* → resource refetches → saveIntent's
  // baseline moves, but the values are unchanged, so this never re-fires from our
  // own save (prevents a save→refetch→save loop).
  const flush = useDebouncedAutoSave({
    enabled: open,
    changeKey: canPersist ? JSON.stringify(values) : null,
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
    void (async () => {
      await flush()
      if (saveFailedRef.current) return
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
          <AgentPromptField form={form} portalContainer={dialogContentElement} />
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
    <div className="grid gap-5">
      <div className="grid grid-cols-[auto_1fr] gap-4">
        <AvatarField
          form={form}
          emojiPickerOpen={emojiPickerOpen}
          setEmojiPickerOpen={setEmojiPickerOpen}
          fallback="🤖"
          portalContainer={portalContainer}
        />
        <TextInputField
          form={form}
          name="name"
          label={t('library.config.agent.field.name.label')}
          placeholder={t('library.config.agent.field.name.placeholder')}
          required
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
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
        />
      </div>
      <TextInputField
        form={form}
        name="description"
        label={t('library.config.agent.field.description.label')}
        placeholder={t('library.config.agent.field.description.placeholder')}
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

  return (
    <FormField
      control={form.control}
      name="permissionMode"
      render={({ field }) => (
        <FormItem>
          <div className="flex items-center justify-between gap-3">
            <FormLabel className="font-normal text-[13px]">
              {t('library.config.agent.field.permission_mode.label')}
            </FormLabel>
            <Select
              value={field.value || 'default'}
              onValueChange={(value) => patchAgentForm({ permissionMode: value })}>
              <FormControl>
                <SelectTrigger
                  className="w-48 shrink-0"
                  aria-label={t('library.config.agent.field.permission_mode.label')}>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent portalContainer={portalContainer}>
                {permissionModeCards.map((card) => (
                  <SelectItem key={card.mode} value={card.mode}>
                    {t(card.titleKey, card.titleFallback)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FormMessage />
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
    <div className="grid gap-2">
      <FormField
        control={form.control}
        name="heartbeatEnabled"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <FormLabel className="font-normal text-[13px]">{label}</FormLabel>
              <FormControl>
                <Switch size="sm" checked={field.value} onCheckedChange={onEnabledChange} aria-label={label} />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      {enabled ? (
        <FormField
          control={form.control}
          name="heartbeatInterval"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between gap-3">
                <FormLabel className="font-normal text-[13px]">
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
                    className="w-28"
                    value={field.value || null}
                    onChange={(v) => field.onChange(typeof v === 'number' ? v : 0)}
                  />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </div>
  )
}

function AgentPromptField({
  form,
  portalContainer
}: {
  form: UseFormReturn<AgentEditFormValues>
  portalContainer: HTMLElement | null
}) {
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
            label={
              <FieldLabelWithHelp
                label={t('library.config.agent.field.instructions.label')}
                helpTrigger={<PromptVariablesPopover portalContainer={portalContainer} />}
                formLabel={false}
              />
            }
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
  const skillIds = form.watch('skillIds')
  const canManageSkills = Boolean(agent.id)

  // Built-in catalog: registry user-facing tools grouped into category sections.
  // The toggle is a real enable/disable that writes the opt-out `disabledTools` set
  // (empty = all enabled); approval is governed solely by the permission-mode cards.
  const disabledSet = useMemo(() => new Set(disabledTools), [disabledTools])
  const builtinSections = useMemo(() => {
    const tools = claudeUserFacingTools()
    return CLAUDE_TOOL_CATEGORIES.map((category) => ({
      category,
      label: t(CATEGORY_LABEL_KEYS[category], CATEGORY_LABEL_FALLBACKS[category]),
      items: tools
        .filter((tool) => tool.category === category)
        .map<CatalogItem>((tool) => ({
          id: tool.name,
          name: t(`agent.tools.builtin.${tool.key}.label`, tool.label),
          description: t(`agent.tools.builtin.${tool.key}.description`, tool.description),
          icon: <Wrench size={13} strokeWidth={1.5} className="text-foreground/55" />
        }))
    })).filter((section) => section.items.length > 0)
  }, [t])
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
              <div className="font-medium text-foreground/55 text-xs">{section.label}</div>
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
              className="h-full min-h-11 w-full rounded-lg border border-border-muted border-dashed px-2.5 py-1.5 font-normal text-muted-foreground text-sm shadow-none transition-colors hover:border-border-hover hover:bg-accent/50 hover:text-foreground">
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
    <div className="grid gap-4">
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
