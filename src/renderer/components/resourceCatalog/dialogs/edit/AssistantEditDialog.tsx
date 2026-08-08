import {
  Button,
  EditableNumber,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  TabsContent,
  Textarea
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { CreateGroupDialog } from '@renderer/components/CreateGroupDialog'
import PromptEditorField from '@renderer/components/PromptEditorField'
import { useAssistantMutationsById } from '@renderer/hooks/resourceCatalog'
import { useCloseBeforeAction } from '@renderer/hooks/useCloseBeforeAction'
import { useGroupMutations, useGroups } from '@renderer/hooks/useGroups'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { toast } from '@renderer/services/toast'
import { MCP_MODE_OPTIONS, RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT } from '@renderer/utils/resourceCatalog'
import { type AssistantFormState, initialAssistantFormState } from '@renderer/utils/resourceCatalog'
import { AGENT_PROMPT } from '@shared/ai/prompts'
import type { UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { AssistantSettings } from '@shared/data/types/assistant'
import { DEFAULT_ASSISTANT_SETTINGS, MAX_TOOL_CALLS, MIN_TOOL_CALLS } from '@shared/data/types/assistant'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'
import { Sparkles, Trash2 } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Path, useForm, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

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
import { GroupSelector } from '../components/GroupSelector'
import { McpServerCatalogGrid } from '../components/McpServerCatalogGrid'
import { PromptPolishActions } from '../components/PromptPolishActions'
import { useDirectFieldSave } from '../components/useDirectFieldSave'

export type AssistantEditDialogResource = Parameters<typeof initialAssistantFormState>[0]

export type AssistantEditDialogProps = EditDialogBaseProps & {
  resource: AssistantEditDialogResource | null
}

type AssistantEditFormValues = {
  avatar: string
  name: string
  description: string
  modelId: UniqueModelId | null
  groupId: string | null
  prompt: string
  temperature: number
  enableTemperature: boolean
  topP: number
  enableTopP: boolean
  maxTokens: number
  enableMaxTokens: boolean
  streamOutput: boolean
  maxToolCalls: number
  enableMaxToolCalls: boolean
  customParameters: AssistantFormState['customParameters']
  mcpMode: AssistantFormState['mcpMode']
  contextOverrideEnabled: boolean
  contextCompressEnabled: boolean
  contextTruncateThreshold: number
  contextCompressModelId: string | null
  knowledgeBaseIds: string[]
  mcpServerIds: string[]
}

type CustomParameter = AssistantFormState['customParameters'][number]
type CustomParameterType = CustomParameter['type']
type AssistantToolTab = 'tools.mcp' | 'tools.knowledge'

const logger = loggerService.withContext('AssistantEditDialog')
const UI_DEFAULT_MAX_TOKENS = 4096

function isAssistantToolTab(value: string): value is AssistantToolTab {
  return value === 'tools.mcp' || value === 'tools.knowledge'
}

function defaultValuesForAssistant(resource: AssistantEditDialogResource): AssistantEditFormValues {
  const form = initialAssistantFormState(resource)
  return {
    avatar: form.emoji,
    name: form.name,
    description: form.description,
    modelId: form.modelId ?? null,
    groupId: form.groupId,
    prompt: form.prompt,
    temperature: form.temperature,
    enableTemperature: form.enableTemperature,
    topP: form.topP,
    enableTopP: form.enableTopP,
    maxTokens: form.maxTokens,
    enableMaxTokens: form.enableMaxTokens,
    streamOutput: form.streamOutput,
    maxToolCalls: form.maxToolCalls,
    enableMaxToolCalls: form.enableMaxToolCalls,
    customParameters: form.customParameters.map((parameter) => ({ ...parameter })),
    mcpMode: form.mcpMode,
    contextOverrideEnabled: form.contextOverrideEnabled,
    contextCompressEnabled: form.contextCompressEnabled,
    contextTruncateThreshold: form.contextTruncateThreshold,
    contextCompressModelId: form.contextCompressModelId,
    knowledgeBaseIds: [...form.knowledgeBaseIds],
    mcpServerIds: [...form.mcpServerIds]
  }
}

function modelLabelsForAssistant(resource: AssistantEditDialogResource): ModelLabels {
  return {
    modelId: resource.modelName ?? null,
    planModelId: null,
    smallModelId: null,
    contextCompressModelId: null
  }
}

/**
 * Combine a queued PATCH with a newer one. `settings` is a deep partial on the
 * wire, so overlapping settings edits merge key-by-key instead of the newer
 * fragment dropping the older one.
 */
function mergeAssistantPatch(base: UpdateAssistantDto, next: UpdateAssistantDto): UpdateAssistantDto {
  const merged: UpdateAssistantDto = { ...base, ...next }
  if (base.settings || next.settings) {
    merged.settings = { ...base.settings, ...next.settings }
  }
  return merged
}

/** `null` clears the per-assistant override so the globals apply again. */
function contextSettingsFromValues(values: AssistantEditFormValues): AssistantSettings['contextSettings'] {
  if (!values.contextOverrideEnabled) return null
  return {
    truncateThreshold: values.contextTruncateThreshold,
    compress: { enabled: values.contextCompressEnabled, modelId: values.contextCompressModelId }
  }
}

/**
 * Writes one draft field and persists just that field.
 *
 * Every control owns its own PATCH, so an unrelated legacy value stored on the
 * assistant can never invalidate the request (the cause of #18160).
 */
type AssistantEditor = {
  form: UseFormReturn<AssistantEditFormValues>
  set: (
    values: Partial<AssistantEditFormValues>,
    patch: UpdateAssistantDto,
    /** `debounced` batches keystrokes; everything else saves on the spot. */
    mode?: 'now' | 'debounced'
  ) => void
}

export function AssistantEditDialog({
  resource,
  open,
  onOpenChange,
  modelFilter,
  initialTab
}: AssistantEditDialogProps) {
  if (!resource) return null

  return (
    <AssistantEditDialogContent
      resource={resource}
      open={open}
      onOpenChange={onOpenChange}
      modelFilter={modelFilter}
      initialTab={initialTab}
    />
  )
}

function AssistantEditDialogContent({
  resource,
  open,
  onOpenChange,
  modelFilter,
  initialTab
}: EditDialogBaseProps & { resource: AssistantEditDialogResource }) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState(initialTab ?? 'basic')
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false)
  const [dialogContentElement, setDialogContentElement] = useState<HTMLDivElement | null>(null)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(() => modelLabelsForAssistant(resource))
  const defaultValues = useMemo(() => defaultValuesForAssistant(resource), [resource])
  const form = useForm<AssistantEditFormValues>({ defaultValues })
  const { groups, isLoading: isGroupsLoading, error: groupsError } = useGroups('assistant')
  const { createGroup } = useGroupMutations('assistant')
  const { updateAssistant } = useAssistantMutationsById(resource.id)
  const saveFailedMessage = t('library.config.dialogs.edit.save_failed')
  const save = useDirectFieldSave<UpdateAssistantDto>({
    save: updateAssistant,
    merge: mergeAssistantPatch,
    onError: (error) => {
      logger.error('Failed to save assistant edit dialog', error, { assistantId: resource.id })
      toast.error(saveFailedMessage)
    }
  })
  const setField = useCallback<AssistantEditor['set']>(
    (values, patch, mode = 'now') => {
      for (const [key, value] of Object.entries(values)) {
        form.setValue(key as Path<AssistantEditFormValues>, value as never, { shouldDirty: true })
      }
      if (mode === 'debounced') save.schedule(patch)
      else save.commit(patch)
    },
    [form, save]
  )
  const editor = useMemo<AssistantEditor>(() => ({ form, set: setField }), [form, setField])
  const tabs = useMemo<EditDialogTab[]>(
    () => [
      { id: 'basic', label: t('library.config.dialogs.edit.basic_tab') },
      { id: 'advanced', label: t('library.config.agent.model_config') },
      { id: 'prompt', label: t('library.config.dialogs.edit.prompt_tab') },
      {
        id: 'tools',
        label: t('library.config.dialogs.edit.tools_tab'),
        children: [
          { id: 'tools.knowledge', label: t('library.config.dialogs.edit.knowledge_tab') },
          { id: 'tools.mcp', label: t('library.config.agent.section.tools.tab.mcp') }
        ]
      }
    ],
    [t]
  )

  const wasOpenRef = useRef(false)
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current
    wasOpenRef.current = open
    if (!open) {
      setCreateGroupDialogOpen(false)
      return
    }
    if (!justOpened) return

    form.reset(defaultValues)
    form.clearErrors()
    setActiveTab(initialTab ?? 'basic')
    setEmojiPickerOpen(false)
    setCreateGroupDialogOpen(false)
    setModelLabels(modelLabelsForAssistant(resource))
  }, [defaultValues, form, initialTab, open, resource])

  // Send whatever is still debounced, then close regardless of the outcome: a
  // rejected field save is reported by the queue, never by trapping the user.
  const handleOpenChange = (next: boolean) => {
    if (!next) void save.flush()
    onOpenChange(next)
  }
  // Route the settings-navigate close through handleOpenChange so it flushes too.
  const closeBeforeAction = useCloseBeforeAction(handleOpenChange)

  const handleCreateGroup = async (name: string) => {
    try {
      const group = await createGroup(name)
      setField({ groupId: group.id }, { groupId: group.id })
    } catch (error) {
      logger.error(
        'Failed to create assistant group from edit dialog',
        error instanceof Error ? error : new Error(String(error)),
        {
          assistantId: resource.id,
          name
        }
      )
      throw error
    }
  }

  return (
    <EditDialogShell
      activeTab={activeTab}
      form={form}
      groupPresentation="inline"
      onActiveTabChange={setActiveTab}
      onOpenChange={handleOpenChange}
      onRetrySave={save.retry}
      open={open}
      saveStatus={save.status}
      setDialogContentElement={setDialogContentElement}
      tabs={tabs}
      title={t('library.config.dialogs.edit.assistant_title')}>
      <>
        <TabsContent value="basic" forceMount hidden={activeTab !== 'basic'} className="m-0">
          <AssistantBasicFields
            editor={editor}
            modelFilter={modelFilter}
            portalContainer={dialogContentElement}
            modelLabels={modelLabels}
            setModelLabels={setModelLabels}
            groups={groups}
            groupsLoading={isGroupsLoading}
            groupsError={groupsError}
            emojiPickerOpen={emojiPickerOpen}
            setEmojiPickerOpen={setEmojiPickerOpen}
            onCreateGroup={() => setCreateGroupDialogOpen(true)}
            onSettingsNavigate={closeBeforeAction}
          />
        </TabsContent>
        <TabsContent
          value="prompt"
          forceMount
          hidden={activeTab !== 'prompt'}
          className="m-0 flex h-full min-h-0 flex-col">
          <AssistantPromptField
            editor={editor}
            resource={resource}
            modelName={modelLabels.modelId}
            portalContainer={dialogContentElement}
          />
        </TabsContent>
        {isAssistantToolTab(activeTab) ? (
          <TabsContent value={activeTab} forceMount className="m-0">
            {activeTab === 'tools.mcp' ? (
              <AssistantToolsFields editor={editor} portalContainer={dialogContentElement} />
            ) : (
              <div className="grid gap-4">
                <KnowledgeBaseField
                  form={form}
                  portalContainer={dialogContentElement}
                  onValueChange={(knowledgeBaseIds) => setField({ knowledgeBaseIds }, { knowledgeBaseIds })}
                />
              </div>
            )}
          </TabsContent>
        ) : null}
        <TabsContent value="advanced" forceMount hidden={activeTab !== 'advanced'} className="m-0">
          <AssistantAdvancedFields
            editor={editor}
            portalContainer={dialogContentElement}
            modelLabels={modelLabels}
            setModelLabels={setModelLabels}
          />
        </TabsContent>
        <CreateGroupDialog
          open={createGroupDialogOpen}
          onCreate={handleCreateGroup}
          onOpenChange={setCreateGroupDialogOpen}
        />
      </>
    </EditDialogShell>
  )
}

function AssistantBasicFields({
  editor,
  modelFilter,
  portalContainer,
  modelLabels,
  setModelLabels,
  groups,
  groupsLoading,
  groupsError,
  emojiPickerOpen,
  setEmojiPickerOpen,
  onCreateGroup,
  onSettingsNavigate
}: {
  editor: AssistantEditor
  modelFilter?: (model: Model) => boolean
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
  groups: ReturnType<typeof useGroups>['groups']
  groupsLoading: ReturnType<typeof useGroups>['isLoading']
  groupsError: ReturnType<typeof useGroups>['error']
  emojiPickerOpen: boolean
  setEmojiPickerOpen: (open: boolean) => void
  onCreateGroup: () => void
  onSettingsNavigate?: (navigate: () => void) => void
}) {
  const { t } = useTranslation()
  const { form, set } = editor

  const handleNameChange = (name: string) => {
    // An empty name is a transient editing state, not a persistable value: keep
    // it in the draft, surface the required message, and skip the PATCH.
    const trimmed = name.trim()
    if (!trimmed) {
      form.setValue('name', name, { shouldDirty: true, shouldValidate: true })
      return
    }
    set({ name }, { name: trimmed }, 'debounced')
  }

  const handleAssistantModelChange = (modelId: UniqueModelId | null, model?: Model) => {
    const values: Partial<AssistantEditFormValues> = { modelId }
    const patch: UpdateAssistantDto = { modelId }
    const nameLower = model?.name.toLowerCase() ?? ''
    if (nameLower.includes('kimi-k2')) {
      values.temperature = 0.6
    } else if (nameLower.includes('moonshot')) {
      values.temperature = 0.3
    }
    if (values.temperature !== undefined) {
      patch.settings = { temperature: values.temperature }
    }
    set(values, patch)
  }

  return (
    <div className="divide-y divide-border-subtle border-border-subtle border-b [&>*:first-child]:pt-0">
      <AvatarField
        form={form}
        emojiPickerOpen={emojiPickerOpen}
        setEmojiPickerOpen={setEmojiPickerOpen}
        fallback="💬"
        portalContainer={portalContainer}
        size="sm"
        layout="row"
        onValueChange={(avatar) => set({ avatar }, { emoji: avatar })}
      />
      <TextInputField
        form={form}
        name="name"
        label={t('common.name')}
        placeholder={t('library.config.basic.field.name.placeholder')}
        required
        layout="row"
        onValueChange={handleNameChange}
      />
      <TextInputField
        form={form}
        name="description"
        label={t('common.description')}
        placeholder={t('library.config.basic.field.description.placeholder')}
        layout="row"
        onValueChange={(description) => set({ description }, { description }, 'debounced')}
      />
      <CompactModelField
        form={form}
        name="modelId"
        label={t('common.model')}
        allowClear
        filter={modelFilter}
        portalContainer={portalContainer}
        modelLabels={modelLabels}
        setModelLabels={setModelLabels}
        onModelChange={handleAssistantModelChange}
        onSettingsNavigate={onSettingsNavigate}
        layout="row"
        triggerClassName="h-9 rounded-md border border-input bg-transparent px-3 hover:bg-accent/50"
      />
      <FormField
        control={form.control}
        name="groupId"
        render={({ field }) => (
          <FormItem className={editDialogFormRowClassName}>
            <FormLabel className={editDialogFormRowLabelClassName}>{t('library.config.basic.group')}</FormLabel>
            <GroupSelector
              value={field.value}
              onChange={(groupId) => set({ groupId }, { groupId })}
              groups={groups}
              isLoading={groupsLoading}
              error={groupsError}
              portalContainer={portalContainer}
              onCreateGroup={onCreateGroup}
              triggerClassName="h-9 rounded-md border border-input bg-transparent px-3 shadow-none hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring/40"
            />
            <FormMessage className="col-start-2" />
          </FormItem>
        )}
      />
    </div>
  )
}

function AssistantPromptField({
  editor,
  resource,
  modelName,
  portalContainer
}: {
  editor: AssistantEditor
  resource: AssistantEditDialogResource
  modelName: string | null
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const { form, set } = editor
  const [resetPreviewKey, setResetPreviewKey] = useState(0)
  const prompt = form.watch('prompt')
  const name = form.watch('name')
  const processedPrompt = usePromptProcessor({
    prompt,
    modelName: modelName ?? resource.modelName ?? undefined
  })

  const handlePromptChange = (nextPrompt: string) => {
    set({ prompt: nextPrompt }, { prompt: nextPrompt }, 'debounced')
  }

  const handlePromptActionChange = (nextPrompt: string) => {
    handlePromptChange(nextPrompt)
    setResetPreviewKey((key) => key + 1)
  }

  const promptActions = (
    <PromptPolishActions
      value={prompt}
      fallbackSource={name}
      emptyValueSystemPrompt={AGENT_PROMPT}
      existingValueSystemPrompt={RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT}
      onChange={handlePromptActionChange}
    />
  )

  return (
    <FormField
      control={form.control}
      name="prompt"
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
          previewValue={processedPrompt || prompt}
          resetPreviewKey={resetPreviewKey}
          actions={promptActions}
          fill
          minHeight={EDIT_DIALOG_PROMPT_MIN_HEIGHT}
          maxHeight={EDIT_DIALOG_PROMPT_MAX_HEIGHT}
        />
      )}
    />
  )
}

function AssistantToolsFields({
  editor,
  portalContainer
}: {
  editor: AssistantEditor
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const { form, set } = editor
  const mcpMode = form.watch('mcpMode')
  const mcpServerIds = form.watch('mcpServerIds')
  const mcpModeLabel = t('library.config.basic.mcp_mode')

  const enabledIds = useMemo(() => new Set(mcpServerIds), [mcpServerIds])
  const toggleMcpServer = (id: string, enabled: boolean) => {
    const next = enabled
      ? Array.from(new Set([...mcpServerIds, id]))
      : mcpServerIds.filter((serverId) => serverId !== id)
    set({ mcpServerIds: next }, { mcpServerIds: next })
  }

  return (
    <div className="grid gap-4">
      <FormField
        control={form.control}
        name="mcpMode"
        render={() => (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <FormLabel className="font-normal text-[13px]">{mcpModeLabel}</FormLabel>
              <FormControl>
                <SegmentedControl<AssistantFormState['mcpMode']>
                  size="sm"
                  className="shrink-0"
                  aria-label={mcpModeLabel}
                  value={mcpMode}
                  onValueChange={(value) => set({ mcpMode: value }, { settings: { mcpMode: value } })}
                  options={MCP_MODE_OPTIONS.map((mode) => ({
                    value: mode.id,
                    label: t(mode.labelKey)
                  }))}
                />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      {mcpMode === 'manual' ? (
        <FormField
          control={form.control}
          name="mcpServerIds"
          render={() => (
            <FormItem>
              <McpServerCatalogGrid
                title={t('library.config.tools.added')}
                enabledIds={enabledIds}
                onToggle={toggleMcpServer}
                emptyLabel={t('library.config.tools.empty_title')}
                portalContainer={portalContainer}
              />
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </div>
  )
}

function AssistantAdvancedFields({
  editor,
  portalContainer,
  modelLabels,
  setModelLabels
}: {
  editor: AssistantEditor
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
}) {
  const { t } = useTranslation()
  const { form, set } = editor
  const values = form.watch()
  // Global defaults, shown as the seed when the user turns the override on for
  // an assistant that has none stored yet.
  const [globalCompressEnabled] = usePreference('chat.context_settings.compress.enabled')
  const [globalTruncateThreshold] = usePreference('chat.context_settings.truncate_threshold')
  const [globalCompressModelId] = usePreference('chat.context_settings.compress.model_id')
  const temperatureMarks = [
    { value: 0, label: t('library.config.basic.precise') },
    { value: 1, label: '1' },
    { value: 2, label: t('library.config.basic.creative') }
  ]
  const topPMarks = [
    { value: 0, label: '0' },
    { value: 0.5, label: '0.5' },
    { value: 1, label: '1' }
  ]

  return (
    <div className="divide-y divide-border-subtle [&>*:first-child]:pt-0 [&>*:last-child]:pb-0 [&>*]:py-4">
      <ToggleFieldGroup
        label={t('library.config.basic.temperature')}
        valueLabel={values.enableTemperature ? values.temperature.toFixed(1) : t('library.config.basic.default_value')}
        description={t('library.config.basic.field.temperature.hint')}
        enabled={values.enableTemperature}
        onEnabledChange={(checked) =>
          set({ enableTemperature: checked }, { settings: { enableTemperature: checked } })
        }>
        <FormField
          control={form.control}
          name="temperature"
          render={({ field }) => (
            <div className="-mb-2 mt-3 w-full">
              {/* Drag updates the draft; only the released value is persisted. */}
              <Slider
                min={0}
                max={2}
                step={0.1}
                value={[field.value]}
                marks={temperatureMarks}
                onValueChange={([value]) => field.onChange(value)}
                onValueCommit={([value]) => set({ temperature: value }, { settings: { temperature: value } })}
                className="w-full"
              />
            </div>
          )}
        />
      </ToggleFieldGroup>

      <ToggleFieldGroup
        label={t('library.config.basic.top_p')}
        valueLabel={values.enableTopP ? values.topP.toFixed(2) : t('library.config.basic.default_value')}
        description={t('library.config.basic.field.top_p.hint')}
        enabled={values.enableTopP}
        onEnabledChange={(checked) => set({ enableTopP: checked }, { settings: { enableTopP: checked } })}>
        <FormField
          control={form.control}
          name="topP"
          render={({ field }) => (
            <div className="-mb-2 mt-3 w-full">
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[field.value]}
                marks={topPMarks}
                onValueChange={([value]) => field.onChange(value)}
                onValueCommit={([value]) => set({ topP: value }, { settings: { topP: value } })}
                className="w-full"
              />
            </div>
          )}
        />
      </ToggleFieldGroup>

      <ToggleFieldGroup
        label={t('library.config.basic.max_tokens')}
        valueLabel={values.enableMaxTokens ? undefined : t('library.config.basic.default_value')}
        description={t('library.config.basic.field.max_tokens.hint')}
        enabled={values.enableMaxTokens}
        onEnabledChange={(checked) => set({ enableMaxTokens: checked }, { settings: { enableMaxTokens: checked } })}
        control={
          <FormField
            control={form.control}
            name="maxTokens"
            render={({ field }) => (
              <EditableNumber
                block
                min={1}
                step={1}
                precision={0}
                align="start"
                changeOnBlur
                className="h-8 rounded-lg border-border bg-transparent px-2.5 shadow-none focus-visible:border-primary"
                value={field.value}
                onChange={(value) => {
                  const maxTokens = typeof value === 'number' && value > 0 ? value : UI_DEFAULT_MAX_TOKENS
                  set({ maxTokens }, { settings: { maxTokens } })
                }}
              />
            )}
          />
        }
      />

      <FormField
        control={form.control}
        name="streamOutput"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <FieldLabelWithHelp
                  label={t('library.config.basic.stream_output')}
                  help={t('library.config.basic.field.stream_output.hint')}
                />
              </div>
              <FormControl>
                <Switch
                  size="sm"
                  checked={field.value}
                  onCheckedChange={(checked) => set({ streamOutput: checked }, { settings: { streamOutput: checked } })}
                  aria-label={t('library.config.basic.stream_output')}
                />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      <ToggleFieldGroup
        label={t('library.config.basic.max_tool_calls')}
        valueLabel={
          values.enableMaxToolCalls
            ? undefined
            : t('library.config.basic.max_tool_calls_default', {
                count: DEFAULT_ASSISTANT_SETTINGS.maxToolCalls
              })
        }
        description={t('library.config.basic.field.max_tool_calls.hint', {
          count: DEFAULT_ASSISTANT_SETTINGS.maxToolCalls
        })}
        enabled={values.enableMaxToolCalls}
        onEnabledChange={(checked) =>
          set({ enableMaxToolCalls: checked }, { settings: { enableMaxToolCalls: checked } })
        }
        control={
          <FormField
            control={form.control}
            name="maxToolCalls"
            render={({ field }) => (
              <EditableNumber
                block
                min={MIN_TOOL_CALLS}
                max={MAX_TOOL_CALLS}
                step={1}
                precision={0}
                align="start"
                changeOnBlur
                className="h-8 rounded-lg border-border bg-transparent px-2.5 shadow-none focus-visible:border-primary"
                value={field.value}
                onChange={(value) => {
                  const maxToolCalls =
                    typeof value === 'number' && value > 0 ? value : DEFAULT_ASSISTANT_SETTINGS.maxToolCalls
                  set({ maxToolCalls }, { settings: { maxToolCalls } })
                }}
              />
            )}
          />
        }
      />

      <ContextManagementFields
        editor={editor}
        portalContainer={portalContainer}
        modelLabels={modelLabels}
        setModelLabels={setModelLabels}
        globalDefaults={{
          compressEnabled: globalCompressEnabled,
          truncateThreshold: globalTruncateThreshold,
          compressModelId: globalCompressModelId || null
        }}
      />

      <FormField
        control={form.control}
        name="customParameters"
        render={({ field }) => (
          <CustomParametersField
            value={field.value}
            onChange={(customParameters) => set({ customParameters }, { settings: { customParameters } }, 'debounced')}
            portalContainer={portalContainer}
          />
        )}
      />
    </div>
  )
}

function ContextManagementFields({
  editor,
  portalContainer,
  modelLabels,
  setModelLabels,
  globalDefaults
}: {
  editor: AssistantEditor
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
  globalDefaults: { compressEnabled: boolean; truncateThreshold: number; compressModelId: string | null }
}) {
  const { t } = useTranslation()
  const { form, set } = editor
  const values = form.watch()
  // Only re-seed from globals the first time an assistant WITHOUT a stored
  // override is customized — an ON→OFF→ON round trip on a stored override must
  // preserve the saved values.
  const hadStoredOverride = useRef(values.contextOverrideEnabled)

  // The override is one stored object, so every sub-field ships the whole
  // `contextSettings` value rebuilt from the current draft.
  const setContextValues = (patch: Partial<AssistantEditFormValues>) => {
    const next = { ...values, ...patch }
    set(patch, { settings: { contextSettings: contextSettingsFromValues(next) } })
  }

  const onOverrideToggle = (checked: boolean) => {
    const seed =
      checked && !hadStoredOverride.current
        ? {
            contextCompressEnabled: globalDefaults.compressEnabled,
            contextTruncateThreshold: globalDefaults.truncateThreshold,
            contextCompressModelId: globalDefaults.compressModelId
          }
        : {}
    setContextValues({ ...seed, contextOverrideEnabled: checked })
  }

  return (
    <>
      <ToggleFieldGroup
        label={t('library.config.basic.context_management')}
        description={t('library.config.basic.field.context_management.hint')}
        enabled={values.contextOverrideEnabled}
        onEnabledChange={onOverrideToggle}
      />
      {values.contextOverrideEnabled ? (
        <div className="grid gap-4 border-border/60 border-l pl-4">
          <FormField
            control={form.control}
            name="contextCompressEnabled"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <FieldLabelWithHelp
                      label={t('library.config.basic.context_compress_enabled')}
                      help={t('library.config.basic.field.context_compress_enabled.hint')}
                    />
                  </div>
                  <FormControl>
                    <Switch
                      size="sm"
                      checked={field.value}
                      onCheckedChange={(checked) => setContextValues({ contextCompressEnabled: checked })}
                      aria-label={t('library.config.basic.context_compress_enabled')}
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="contextTruncateThreshold"
            render={({ field }) => (
              <FormItem>
                <FieldLabelWithHelp
                  label={t('library.config.basic.context_truncate_threshold')}
                  help={t('library.config.basic.field.context_truncate_threshold.hint')}
                />
                <FormControl>
                  <EditableNumber
                    block
                    min={1}
                    step={1000}
                    precision={0}
                    align="start"
                    changeOnBlur
                    className="h-8 rounded-lg border-border bg-transparent px-2.5 shadow-none focus-visible:border-primary"
                    value={field.value}
                    onChange={(value) =>
                      setContextValues({
                        contextTruncateThreshold:
                          typeof value === 'number' && value > 0 ? value : globalDefaults.truncateThreshold
                      })
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <CompactModelField
            form={form}
            name="contextCompressModelId"
            label={t('library.config.basic.context_compress_model')}
            allowClear
            emptyLabel={t('library.config.basic.context_compress_model_follow')}
            // A compression model summarizes history — only chat-capable models qualify.
            filter={(model) => !isNonChatModel(model)}
            portalContainer={portalContainer}
            modelLabels={modelLabels}
            setModelLabels={setModelLabels}
            onModelChange={(modelId) => setContextValues({ contextCompressModelId: modelId })}
          />
        </div>
      ) : null}
    </>
  )
}

function ToggleFieldGroup({
  label,
  valueLabel,
  description,
  enabled,
  onEnabledChange,
  control,
  children
}: {
  label: string
  valueLabel?: string
  description: string
  enabled: boolean
  onEnabledChange: (checked: boolean) => void
  /** Compact control rendered beside the switch when enabled (title-left / control-right row). */
  control?: ReactNode
  children?: ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <FieldLabelWithHelp label={label} help={description} formLabel={false} />
          {valueLabel ? <span className="text-muted-foreground text-xs">{valueLabel}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {enabled && control ? <div className="w-36">{control}</div> : null}
          <Switch size="sm" checked={enabled} onCheckedChange={onEnabledChange} aria-label={label} />
        </div>
      </div>
      {enabled && children ? <div className="mt-2">{children}</div> : null}
    </div>
  )
}

function CustomParametersField({
  value,
  onChange,
  portalContainer
}: {
  value: CustomParameter[]
  onChange: (next: CustomParameter[]) => void
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const add = () => onChange([...value, { name: '', type: 'string', value: '' }])
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index))
  const updateField = (index: number, patch: Partial<CustomParameter>) => {
    const next = [...value] as CustomParameter[]
    if (patch.type && patch.type !== next[index].type) {
      next[index] = {
        name: next[index].name,
        type: patch.type,
        value: defaultValueForType(patch.type)
      } as CustomParameter
    } else {
      next[index] = { ...next[index], ...patch } as CustomParameter
    }
    onChange(next)
  }

  return (
    <FormItem>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <FieldLabelWithHelp
            label={t('library.config.basic.custom_params')}
            help={t('library.config.basic.field.custom_params.hint')}
          />
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={add} className="h-7 gap-1 px-2.5 text-xs">
          <Sparkles size={11} />
          {t('library.config.basic.custom_params_add')}
        </Button>
      </div>

      {value.length > 0 ? (
        <div className="mt-2 space-y-2">
          {value.map((param, index) => (
            <CustomParameterRow
              key={index}
              param={param}
              portalContainer={portalContainer}
              onNameChange={(name) => updateField(index, { name })}
              onTypeChange={(type) => updateField(index, { type })}
              onValueChange={(nextValue) => updateField(index, { value: nextValue } as Partial<CustomParameter>)}
              onDelete={() => remove(index)}
            />
          ))}
        </div>
      ) : null}
      <FormMessage />
    </FormItem>
  )
}

function defaultValueForType(type: CustomParameterType): CustomParameter['value'] {
  switch (type) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'json':
      return ''
    default:
      return ''
  }
}

function CustomParameterRow({
  param,
  portalContainer,
  onNameChange,
  onTypeChange,
  onValueChange,
  onDelete
}: {
  param: CustomParameter
  portalContainer: HTMLElement | null
  onNameChange: (name: string) => void
  onTypeChange: (type: CustomParameterType) => void
  onValueChange: (value: CustomParameter['value']) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const jsonString =
    param.type === 'json'
      ? typeof param.value === 'string'
        ? param.value
        : JSON.stringify(param.value ?? '', null, 2)
      : ''
  const jsonInvalid = (() => {
    if (param.type !== 'json') return false
    if (!jsonString.trim()) return false
    try {
      JSON.parse(jsonString)
      return false
    } catch {
      return true
    }
  })()

  return (
    <div className="rounded-xs border border-border-subtle bg-accent/15 p-2">
      <div className="flex items-stretch gap-2">
        <Input
          placeholder={t('library.config.basic.custom_params_name')}
          value={param.name}
          onChange={(event) => onNameChange(event.target.value)}
          className="flex-1"
        />
        <Select value={param.type} onValueChange={(value) => onTypeChange(value as CustomParameterType)}>
          <SelectTrigger size="sm" className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent portalContainer={portalContainer}>
            <SelectItem value="string">string</SelectItem>
            <SelectItem value="number">number</SelectItem>
            <SelectItem value="boolean">boolean</SelectItem>
            <SelectItem value="json">json</SelectItem>
          </SelectContent>
        </Select>
        {param.type !== 'json' ? (
          <div className="flex-1">
            {param.type === 'number' ? (
              <Input
                type="number"
                value={String(param.value)}
                onChange={(event) => {
                  const parsed = parseFloat(event.target.value)
                  onValueChange(Number.isFinite(parsed) ? parsed : 0)
                }}
              />
            ) : null}
            {param.type === 'boolean' ? (
              <Select value={String(param.value)} onValueChange={(value) => onValueChange(value === 'true')}>
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent portalContainer={portalContainer}>
                  <SelectItem value="true">true</SelectItem>
                  <SelectItem value="false">false</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {param.type === 'string' ? (
              <Input value={String(param.value)} onChange={(event) => onValueChange(event.target.value)} />
            ) : null}
          </div>
        ) : null}
        <Button
          type="button"
          variant="destructive"
          size="icon"
          aria-label={t('common.delete')}
          onClick={onDelete}
          className="h-8 w-8 shrink-0">
          <Trash2 size={12} />
        </Button>
      </div>
      {param.type === 'json' ? (
        <div className="mt-2">
          <Textarea.Input
            value={jsonString}
            onValueChange={onValueChange}
            rows={4}
            spellCheck={false}
            placeholder='{"key": "value"}'
            hasError={jsonInvalid}
          />
          {jsonInvalid ? <p className="mt-1 text-error text-xs">{t('library.config.basic.json_invalid')}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
