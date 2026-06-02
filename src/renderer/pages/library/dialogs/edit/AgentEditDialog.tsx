import {
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
import { permissionModeCards } from '@renderer/config/agent'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import {
  computeModeDefaults,
  mergeAutoApprovedTools,
  normalizeAllowedToolRules,
  normalizePermissionMode
} from '@renderer/hooks/agents/permissionMode'
import { useAgentTools } from '@renderer/hooks/agents/useAgentTools'
import { useMcpRuntimeStatusMap } from '@renderer/hooks/useMcpRuntimeStatus'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { useAgentMutationsById } from '@renderer/pages/library/adapters/agentAdapter'
import type { AgentDetail } from '@renderer/pages/library/types'
import type { Tool } from '@shared/ai/tool'
import type { MCPServer } from '@shared/data/types/mcpServer'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { Network, Sparkles, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { type CatalogItem, CatalogToggleGrid } from '../components/CatalogPicker'
import { McpServerAvatar } from '../components/McpServerAvatar'
import {
  type AgentFormState,
  applyAgentFormPatch,
  buildInitialAgentFormState,
  diffAgentSaveIntent
} from '../form/agent'
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
  TextInputField
} from './EditDialogShared'

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
  allowedTools: string[]
  permissionMode: string
  maxTurns: number
  envVarsText: string
  soulEnabled: boolean
  heartbeatEnabled: boolean
  heartbeatInterval: number
}

type ToolTab = 'tools.builtin' | 'tools.mcp' | 'tools.skills'

const logger = loggerService.withContext('AgentEditDialog')
const PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions'] as const
const PERMISSION_MODE_LABEL_KEYS: Record<(typeof PERMISSION_MODES)[number], string> = {
  acceptEdits: 'library.config.agent.field.permission_mode.option.acceptEdits',
  bypassPermissions: 'library.config.agent.field.permission_mode.option.bypassPermissions',
  default: 'library.config.agent.field.permission_mode.option.default',
  plan: 'library.config.agent.field.permission_mode.option.plan'
}
const DEFAULT_TOOL_TAB: ToolTab = 'tools.builtin'

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
    allowedTools: [...form.allowedTools],
    permissionMode: form.permissionMode,
    maxTurns: form.maxTurns,
    envVarsText: form.envVarsText,
    soulEnabled: form.soulEnabled,
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
    allowedTools: values.allowedTools,
    permissionMode: values.permissionMode,
    maxTurns: values.maxTurns,
    envVarsText: values.envVarsText,
    soulEnabled: values.soulEnabled,
    heartbeatEnabled: values.heartbeatEnabled,
    heartbeatInterval: values.heartbeatInterval
  }
}

function syncAgentFormState(form: UseFormReturn<AgentEditFormValues>, next: AgentFormState) {
  form.setValue('modelId', next.model || null, { shouldDirty: true })
  form.setValue('planModelId', next.planModel, { shouldDirty: true })
  form.setValue('smallModelId', next.smallModel, { shouldDirty: true })
  form.setValue('mcps', next.mcps, { shouldDirty: true })
  form.setValue('allowedTools', next.allowedTools, { shouldDirty: true })
  form.setValue('permissionMode', next.permissionMode, { shouldDirty: true })
  form.setValue('soulEnabled', next.soulEnabled, { shouldDirty: true })
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

export function AgentEditDialog({ resource, open, onOpenChange, onSaved, modelFilter }: AgentEditDialogProps) {
  if (!resource) return null

  return (
    <AgentEditDialogContent
      resource={resource}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      modelFilter={modelFilter}
    />
  )
}

function AgentEditDialogContent({
  resource,
  open,
  onOpenChange,
  onSaved,
  modelFilter
}: EditDialogBaseProps<AgentDetail> & { resource: AgentDetail }) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('basic')
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [dialogContentElement, setDialogContentElement] = useState<HTMLDivElement | null>(null)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(() => modelLabelsForAgent(resource))
  const defaultValues = useMemo(() => defaultValuesForAgent(resource), [resource])
  const form = useForm<AgentEditFormValues>({ defaultValues })
  const values = form.watch()
  const agentToolSource = useMemo(
    () => ({
      type: resource.type,
      mcps: values.mcps,
      allowedTools: values.allowedTools,
      permissionMode: values.permissionMode
    }),
    [resource.type, values.allowedTools, values.mcps, values.permissionMode]
  )
  const { tools: agentTools } = useAgentTools(agentToolSource)
  const patchAgentForm = useMemo(() => createAgentPatcher(form, resource), [form, resource])
  const { updateAgent } = useAgentMutationsById(resource.id)
  const saveIntent = useMemo(() => {
    const baseline = buildInitialAgentFormState(resource)
    return diffAgentSaveIntent(buildAgentFormState(baseline, values), baseline, resource)
  }, [resource, values])
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

  useEffect(() => {
    if (!open) return

    form.reset(defaultValues)
    form.clearErrors()
    setActiveTab('basic')
    setEmojiPickerOpen(false)
    setModelLabels(modelLabelsForAgent(resource))
  }, [defaultValues, form, open, resource])

  useEffect(() => {
    if (leafTabIds.has(activeTab)) return
    setActiveTab('basic')
  }, [activeTab, leafTabIds])

  const isSubmitting = form.formState.isSubmitting
  const canSave = Boolean(saveIntent) && !isSubmitting
  const rootError = form.formState.errors.root?.message

  const handleSubmit = form.handleSubmit(async () => {
    const pending = saveIntent
    if (!pending) return

    form.clearErrors('root')

    let updated: Awaited<ReturnType<typeof updateAgent>>
    try {
      updated = await updateAgent(pending.payload)
    } catch (error) {
      logger.error('Failed to save agent edit dialog', error as Error, { agentId: resource.id })
      form.setError('root', { message: t('library.config.dialogs.edit.save_failed') })
      return
    }

    onOpenChange(false)
    try {
      await onSaved(updated)
    } catch (error) {
      logger.warn('Failed to run agent edit dialog post-save callback', { error, agentId: resource.id })
    }
  })

  return (
    <EditDialogShell
      activeTab={activeTab}
      canSave={canSave}
      form={form}
      isSubmitting={isSubmitting}
      onActiveTabChange={setActiveTab}
      onOpenChange={onOpenChange}
      onSubmit={handleSubmit}
      open={open}
      rootError={rootError}
      setDialogContentElement={setDialogContentElement}
      tabs={tabs}
      title={t('library.config.dialogs.edit.agent_title')}>
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
        />
      </TabsContent>
      <TabsContent value="prompt" forceMount hidden={activeTab !== 'prompt'} className="m-0">
        <AgentPromptField form={form} portalContainer={dialogContentElement} />
      </TabsContent>
      {isToolTab(activeTab) ? (
        <TabsContent value={activeTab} forceMount className="m-0">
          <AgentToolsFields
            agent={resource}
            form={form}
            tools={agentTools}
            activeToolTab={activeTab}
            portalContainer={dialogContentElement}
          />
        </TabsContent>
      ) : null}
      <TabsContent value="advanced" forceMount hidden={activeTab !== 'advanced'} className="m-0">
        <AgentAdvancedFields form={form} />
      </TabsContent>
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
  setEmojiPickerOpen
}: {
  form: UseFormReturn<AgentEditFormValues>
  modelFilter?: (model: Model) => boolean
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
  patchAgentForm: (patch: Partial<AgentFormState>) => void
  emojiPickerOpen: boolean
  setEmojiPickerOpen: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const heartbeatEnabled = form.watch('heartbeatEnabled')

  return (
    <div className="grid gap-4">
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
            <FormLabel>{t('library.config.agent.field.permission_mode.label')}</FormLabel>
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
                {PERMISSION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(PERMISSION_MODE_LABEL_KEYS[mode])}
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
              <FormLabel>{label}</FormLabel>
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
                <FormLabel>{t('library.config.agent.field.heartbeat_interval.label')}</FormLabel>
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

  return (
    <FormField
      control={form.control}
      name="instructions"
      render={({ field }) => (
        <FormItem>
          <FieldLabelWithHelp
            label={t('library.config.agent.field.instructions.label')}
            helpTrigger={<PromptVariablesPopover portalContainer={portalContainer} />}
          />
          <FormControl>
            <Textarea.Input
              value={field.value}
              rows={6}
              placeholder={t('library.config.agent.field.instructions.placeholder')}
              onValueChange={field.onChange}
              style={{ minHeight: EDIT_DIALOG_PROMPT_MIN_HEIGHT, maxHeight: EDIT_DIALOG_PROMPT_MAX_HEIGHT }}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function AgentToolsFields({
  agent,
  form,
  tools,
  activeToolTab,
  portalContainer
}: {
  agent: AgentDetail
  form: UseFormReturn<AgentEditFormValues>
  tools: Tool[]
  activeToolTab: ToolTab
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const permissionMode = normalizePermissionMode(form.watch('permissionMode'))
  const allowedTools = form.watch('allowedTools')
  const mcps = form.watch('mcps')
  const canManageSkills = Boolean(agent.id)

  const selectedModeCard = useMemo(
    () => permissionModeCards.find((card) => card.mode === permissionMode),
    [permissionMode]
  )
  const explicitToolIds = useMemo(() => normalizeAllowedToolRules(allowedTools, tools), [allowedTools, tools])
  const autoToolIds = useMemo(
    () => computeModeDefaults(permissionMode, tools).filter((id) => !explicitToolIds.includes(id)),
    [explicitToolIds, permissionMode, tools]
  )
  const builtinCatalog = useMemo<CatalogItem[]>(
    () =>
      tools
        .filter((tool) => tool.origin !== 'mcp')
        .map((tool) => {
          const isAuto = autoToolIds.includes(tool.id)
          const modeName = selectedModeCard
            ? t(selectedModeCard.titleKey, selectedModeCard.titleFallback)
            : permissionMode
          return {
            id: tool.id,
            name: tool.name,
            description: tool.description,
            icon: <Wrench size={13} strokeWidth={1.5} className="text-foreground/55" />,
            statusBadge: isAuto ? t('agent.settings.tooling.preapproved.autoBadge', 'Added by mode') : undefined,
            statusBadgeClassName: isAuto ? 'bg-success/10 text-success' : undefined,
            disableToggle: isAuto,
            disabledReason: isAuto
              ? t('agent.settings.tooling.preapproved.autoDisabledTooltip', { mode: modeName })
              : undefined
          }
        }),
    [autoToolIds, permissionMode, selectedModeCard, t, tools]
  )
  const approvedToolIds = useMemo(
    () => mergeAutoApprovedTools(allowedTools, permissionMode, tools),
    [allowedTools, permissionMode, tools]
  )
  const allowedIds = useMemo(() => new Set(approvedToolIds), [approvedToolIds])
  const enableBuiltin = (id: string) =>
    form.setValue('allowedTools', Array.from(new Set([...explicitToolIds, id])), { shouldDirty: true })
  const disableBuiltin = (id: string) => {
    if (autoToolIds.includes(id)) return
    form.setValue(
      'allowedTools',
      explicitToolIds.filter((toolId) => toolId !== id),
      { shouldDirty: true }
    )
  }

  const { data: mcpData, isLoading: mcpLoading } = useQuery('/mcp-servers', {})
  const mcpServers = useMemo<MCPServer[]>(() => mcpData?.items ?? [], [mcpData])
  const mcpStatuses = useMcpRuntimeStatusMap(mcpServers)
  const mcpCatalog = useMemo<CatalogItem[]>(
    () =>
      mcpServers.map((server) => {
        const status = mcpStatuses[server.id]
        const state = server.isActive ? (status?.state ?? 'connecting') : 'disabled'
        const statusBadge =
          state === 'connected'
            ? t('settings.mcp.runtimeStatus.connected', 'Connected')
            : state === 'connecting'
              ? t('settings.mcp.runtimeStatus.connecting', 'Connecting')
              : state === 'error'
                ? t('settings.mcp.runtimeStatus.unavailable', 'Unavailable')
                : undefined
        const statusBadgeClassName =
          state === 'connected'
            ? 'bg-success/10 text-success'
            : state === 'connecting'
              ? 'bg-warning/10 text-warning'
              : state === 'error'
                ? 'bg-destructive/10 text-destructive'
                : undefined
        return {
          id: server.id,
          name: server.name,
          description: server.description || server.baseUrl || server.command,
          icon: (
            <McpServerAvatar
              server={server}
              size={28}
              fallbackIcon={Network}
              fallbackIconClassName="text-blue-500/60"
              fallbackIconScale={0.5}
            />
          ),
          inactiveBadge: server.isActive ? undefined : t('library.config.tools.inactive_badge'),
          statusBadge,
          statusBadgeClassName,
          pickable: server.isActive
        }
      }),
    [mcpServers, mcpStatuses, t]
  )
  const mcpIds = useMemo(() => new Set(mcps), [mcps])
  const enableMCP = (id: string) => form.setValue('mcps', [...mcps, id], { shouldDirty: true })
  const disableMCP = (id: string) =>
    form.setValue(
      'mcps',
      mcps.filter((mcpId) => mcpId !== id),
      { shouldDirty: true }
    )

  const { skills, loading: skillsLoading, toggle: toggleSkill } = useInstalledSkills(agent.id || undefined)
  const skillCatalog = useMemo<CatalogItem[]>(
    () =>
      skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        icon: <Sparkles size={13} strokeWidth={1.5} className="text-amber-500/60" />
      })),
    [skills]
  )
  const enabledSkillIds = useMemo(
    () => new Set(skills.filter((skill) => skill.isEnabled).map((skill) => skill.id)),
    [skills]
  )
  const flipSkill = async (id: string, nextEnabled: boolean) => {
    try {
      await toggleSkill(id, nextEnabled)
    } catch {
      // useInstalledSkills owns toast/logging for toggle failures.
    }
  }

  return (
    <div className="grid gap-4">
      {activeToolTab === 'tools.builtin' ? (
        <CatalogToggleGrid
          items={builtinCatalog}
          enabledIds={allowedIds}
          onToggle={(id, enabled) => (enabled ? enableBuiltin(id) : disableBuiltin(id))}
          emptyLabel={t('library.config.agent.section.tools.no_builtin_enabled')}
          portalContainer={portalContainer}
        />
      ) : null}
      {activeToolTab === 'tools.mcp' ? (
        <CatalogToggleGrid
          items={mcpCatalog}
          enabledIds={mcpIds}
          loading={mcpLoading}
          onToggle={(id, enabled) => (enabled ? enableMCP(id) : disableMCP(id))}
          emptyLabel={t('library.config.agent.section.tools.no_mcp_bound')}
          portalContainer={portalContainer}
        />
      ) : null}
      {activeToolTab === 'tools.skills' ? (
        <CatalogToggleGrid
          items={skillCatalog}
          enabledIds={enabledSkillIds}
          loading={skillsLoading}
          disabled={!canManageSkills}
          onToggle={flipSkill}
          emptyLabel={
            canManageSkills
              ? t('library.config.agent.section.tools.no_skills_enabled')
              : t('library.config.agent.section.tools.skills_require_save')
          }
          portalContainer={portalContainer}
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
        name="maxTurns"
        render={({ field }) => (
          <FormItem>
            <FieldLabelWithHelp
              label={t('library.config.agent.field.max_turns.label')}
              help={t('library.config.agent.field.max_turns.help')}
            />
            <EditableNumber
              block
              min={0}
              max={100}
              step={1}
              precision={0}
              align="start"
              changeOnBlur
              value={field.value || null}
              onChange={(value) => field.onChange(typeof value === 'number' ? value : 0)}
              placeholder="0"
            />
            <FormMessage />
          </FormItem>
        )}
      />
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
