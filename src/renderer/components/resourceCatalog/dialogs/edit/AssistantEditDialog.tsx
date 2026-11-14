import { Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  Button,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInputNumber,
  InputGroupText,
  InputNumber,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { CreateGroupDialog } from '@renderer/components/CreateGroupDialog'
import PromptEditorField from '@renderer/components/PromptEditorField'
import { useAssistantMutationsById } from '@renderer/hooks/resourceCatalog'
import { useCloseBeforeAction } from '@renderer/hooks/useCloseBeforeAction'
import { useGroupMutations, useGroups } from '@renderer/hooks/useGroups'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { toast } from '@renderer/services/toast'
import { MCP_MODE_OPTIONS, RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT } from '@renderer/utils/resourceCatalog'
import {
  type AssistantFormState,
  diffAssistantSaveIntent,
  initialAssistantFormState
} from '@renderer/utils/resourceCatalog'
import { AGENT_PROMPT } from '@shared/ai/prompts'
import { DEFAULT_ASSISTANT_SETTINGS, MAX_TOOL_CALLS, MIN_TOOL_CALLS } from '@shared/data/types/assistant'
import {
  MAX_COMPRESS_THRESHOLD_PERCENT,
  MIN_COMPRESS_THRESHOLD_PERCENT,
  MIN_TRUNCATE_THRESHOLD
} from '@shared/data/types/contextSettings'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { clampThresholdPercent } from '@shared/utils/contextSettings'
import { isBrowserMcpServer } from '@shared/utils/mcp'
import { isNonChatModel } from '@shared/utils/model'

import { AssistantAvatarPicker } from '../components/AssistantAvatarPicker'
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
  EDIT_DIALOG_PROMPT_MAX_HEIGHT,
  EDIT_DIALOG_PROMPT_MIN_HEIGHT,
  type EditDialogBaseProps,
  FieldLabelWithHelp,
  type ModelLabels,
  PromptVariablesPopover,
  setFormValues,
  useDebouncedAutoSave
} from '../components/EditDialogShared'
import { GroupSelector } from '../components/GroupSelector'
import { KnowledgeCapabilityList } from '../components/KnowledgeCapabilityList'
import { McpCapabilityList } from '../components/McpCapabilityList'
import { PromptPolishActions } from '../components/PromptPolishActions'
import { ReplyLanguageSelect } from '../components/ReplyLanguageSelect'
import { countSummary, type EditPage, type EditSubPage, resolveInitialEditPage } from './editPages'

export type AssistantEditDialogResource = Parameters<typeof initialAssistantFormState>[0]

export type AssistantEditDialogProps = EditDialogBaseProps & {
  resource: AssistantEditDialogResource | null
}

type AssistantEditFormValues = {
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
  enableBrowser: boolean
  mcpMode: AssistantFormState['mcpMode']
  languageMode: AssistantFormState['languageMode']
  languageCustom: string
  contextOverrideEnabled: boolean
  contextCompressEnabled: boolean
  contextTruncateThreshold: number
  contextMaxMessages: number | null
  contextCompressThresholdPercent: number | null
  contextCompressModelId: string | null
  knowledgeBaseIds: string[]
  mcpServerIds: string[]
}

type CustomParameter = AssistantFormState['customParameters'][number]
type CustomParameterType = CustomParameter['type']

const logger = loggerService.withContext('AssistantEditDialog')
const UI_DEFAULT_MAX_TOKENS = 4096
const ASSISTANT_SUB_PAGES = new Set<EditSubPage>(['prompt', 'knowledge', 'mcp', 'context', 'parameters'])

// The prototype lists the default (auto) first and disabled last.
const MCP_MODE_ORDER: AssistantFormState['mcpMode'][] = ['auto', 'manual', 'disabled']

function defaultValuesForAssistant(resource: AssistantEditDialogResource): AssistantEditFormValues {
  const form = initialAssistantFormState(resource)
  return {
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
    enableBrowser: form.enableBrowser,
    mcpMode: form.mcpMode,
    languageMode: form.languageMode,
    languageCustom: form.languageCustom,
    contextOverrideEnabled: form.contextOverrideEnabled,
    contextCompressEnabled: form.contextCompressEnabled,
    contextTruncateThreshold: form.contextTruncateThreshold,
    contextMaxMessages: form.contextMaxMessages,
    contextCompressThresholdPercent: form.contextCompressThresholdPercent,
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

function buildAssistantFormState(baseline: AssistantFormState, values: AssistantEditFormValues): AssistantFormState {
  return {
    ...baseline,
    name: values.name,
    description: values.description,
    modelId: values.modelId,
    groupId: values.groupId,
    prompt: values.prompt,
    temperature: values.temperature,
    enableTemperature: values.enableTemperature,
    topP: values.topP,
    enableTopP: values.enableTopP,
    maxTokens: values.maxTokens,
    enableMaxTokens: values.enableMaxTokens,
    streamOutput: values.streamOutput,
    maxToolCalls: values.maxToolCalls,
    enableMaxToolCalls: values.enableMaxToolCalls,
    customParameters: values.customParameters,
    enableBrowser: values.enableBrowser,
    mcpMode: values.mcpMode,
    languageMode: values.languageMode,
    languageCustom: values.languageCustom,
    contextOverrideEnabled: values.contextOverrideEnabled,
    contextCompressEnabled: values.contextCompressEnabled,
    contextTruncateThreshold: values.contextTruncateThreshold,
    contextMaxMessages: values.contextMaxMessages,
    contextCompressThresholdPercent: values.contextCompressThresholdPercent,
    contextCompressModelId: values.contextCompressModelId,
    knowledgeBaseIds: values.knowledgeBaseIds,
    mcpServerIds: values.mcpServerIds
  }
}

export function AssistantEditDialog({
  resource,
  open,
  onOpenChange,
  modelFilter,
  isModelDisabled,
  initialTab
}: AssistantEditDialogProps) {
  if (!resource) return null

  return (
    <AssistantEditDialogContent
      resource={resource}
      open={open}
      onOpenChange={onOpenChange}
      modelFilter={modelFilter}
      isModelDisabled={isModelDisabled}
      initialTab={initialTab}
    />
  )
}

function AssistantEditDialogContent({
  resource,
  open,
  onOpenChange,
  modelFilter,
  isModelDisabled,
  initialTab
}: EditDialogBaseProps & { resource: AssistantEditDialogResource }) {
  const { t } = useTranslation()
  const [page, setPage] = useState<EditPage>(() => resolveInitialEditPage('assistant', initialTab, ASSISTANT_SUB_PAGES))
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false)
  const [dialogContentElement, setDialogContentElement] = useState<HTMLDivElement | null>(null)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(() => modelLabelsForAssistant(resource))
  const [formBaseline, setFormBaseline] = useState(() => initialAssistantFormState(resource))
  const formBaselineRef = useRef(formBaseline)
  const defaultValues = useMemo(() => defaultValuesForAssistant(resource), [resource])
  // Validate as the user types so an emptied name shows its required message.
  const form = useForm<AssistantEditFormValues>({ defaultValues, mode: 'onChange' })
  const values = form.watch()
  const { groups, isLoading: isGroupsLoading, error: groupsError } = useGroups('assistant')
  const { createGroup } = useGroupMutations('assistant')
  const { updateAssistant } = useAssistantMutationsById(resource.id)
  const saveIntent = useMemo(() => {
    return diffAssistantSaveIntent(buildAssistantFormState(formBaseline, values), formBaseline, resource)
  }, [formBaseline, resource, values])

  // Tracks the exact form snapshot that failed so it cannot be retried until
  // the user changes the form, while a later close can explicitly discard it.
  const failedSaveKeyRef = useRef<string | null>(null)

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
    formBaselineRef.current = initialAssistantFormState(resource)
    setFormBaseline(formBaselineRef.current)
    form.clearErrors()
    setPage(resolveInitialEditPage('assistant', initialTab, ASSISTANT_SUB_PAGES))
    setCreateGroupDialogOpen(false)
    setModelLabels(modelLabelsForAssistant(resource))
    // A fresh open is a fresh editing session — a stale failure from a prior
    // session (this instance can outlive one close, see the exit-animation
    // hold in useResourceCatalogController) must not silently discard a new,
    // coincidentally-identical edit as if it were a repeated close.
    failedSaveKeyRef.current = null
  }, [defaultValues, form, initialTab, open, resource])

  const rootError = form.formState.errors.root?.message
  const canPersist = Boolean(saveIntent) && values.name.trim().length > 0
  const changeKey = canPersist ? JSON.stringify(values) : null
  const saveFailedMessage = t('library.config.dialogs.edit.save_failed')

  const getCurrentSaveIntent = () =>
    diffAssistantSaveIntent(
      buildAssistantFormState(formBaselineRef.current, form.getValues()),
      formBaselineRef.current,
      resource
    )

  const persist = async () => {
    const submittedValues = structuredClone(form.getValues())
    if (!submittedValues.name.trim()) return
    const submittedFormState = buildAssistantFormState(formBaselineRef.current, submittedValues)
    const pending = diffAssistantSaveIntent(submittedFormState, formBaselineRef.current, resource)
    if (!pending) return
    const attemptedKey = JSON.stringify(submittedValues)

    // A close-triggered flush does not cancel the already scheduled debounce.
    // Keep both paths from resending an unchanged payload that already failed.
    if (failedSaveKeyRef.current === attemptedKey) return

    form.clearErrors('root')
    failedSaveKeyRef.current = null

    try {
      await updateAssistant(pending.payload)
    } catch (error) {
      logger.error('Failed to auto-save assistant edit dialog', error as Error, { assistantId: resource.id })
      failedSaveKeyRef.current = attemptedKey
      form.setError('root', { message: saveFailedMessage })
      toast.error(saveFailedMessage)
      return
    }

    formBaselineRef.current = submittedFormState
    setFormBaseline(submittedFormState)
  }

  const { flush, getPendingSave } = useDebouncedAutoSave({
    enabled: open,
    changeKey,
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
    if (failedSaveKeyRef.current === JSON.stringify(currentValues)) {
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

  const handleCreateGroup = async (name: string) => {
    try {
      const group = await createGroup(name)
      form.setValue('groupId', group.id, { shouldDirty: true, shouldTouch: true })
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

  const handleAssistantModelChange = (modelId: UniqueModelId | null, model?: Model) => {
    const patch: Partial<AssistantEditFormValues> = { modelId }
    const nameLower = model?.name.toLowerCase() ?? ''
    if (nameLower.includes('kimi-k2')) {
      patch.temperature = 0.6
    } else if (nameLower.includes('moonshot')) {
      patch.temperature = 0.3
    }
    setFormValues(form, patch)
  }
  const pageTitles: Record<EditPage, string> = {
    settings: t('library.config.dialogs.edit.assistant_title'),
    prompt: t('library.config.prompt.label'),
    knowledge: t('library.config.dialogs.edit.knowledge_tab'),
    mcp: t('library.config.dialogs.edit.page.mcp'),
    context: t('library.config.dialogs.edit.page.context'),
    parameters: t('library.config.basic.custom_params'),
    tools: '',
    skills: '',
    channels: '',
    tasks: '',
    memory: ''
  }

  return (
    <EditDialogPageShell
      form={form}
      open={open}
      onOpenChange={handleOpenChange}
      page={page}
      title={pageTitles[page]}
      onBack={page === 'settings' ? undefined : () => setPage('settings')}
      fill={page === 'prompt'}
      rootError={rootError}
      setDialogContentElement={setDialogContentElement}>
      {page === 'settings' ? (
        <div className="flex flex-col gap-5">
          <EditIdentityHeader
            form={form}
            avatar={
              <AssistantAvatarPicker
                key={`${resource.id}:${open}`}
                assistantId={resource.id}
                emoji={resource.emoji}
                avatarSrc={resource.avatarSrc}
                ariaLabel={t('library.config.dialogs.create.avatar_aria')}
                portalContainer={dialogContentElement}
                size="lg"
              />
            }
            namePlaceholder={t('library.config.basic.field.name.placeholder')}
            descriptionPlaceholder={t('library.config.basic.field.description.placeholder')}
            model={
              <CompactModelField
                form={form}
                name="modelId"
                label={t('common.model')}
                allowClear
                filter={modelFilter}
                isModelDisabled={isModelDisabled}
                portalContainer={dialogContentElement}
                modelLabels={modelLabels}
                setModelLabels={setModelLabels}
                onModelChange={handleAssistantModelChange}
                onSettingsNavigate={closeBeforeAction}
                layout="chip"
                triggerClassName="w-auto max-w-56"
              />
            }
          />
          <AssistantSettingsCards
            form={form}
            portalContainer={dialogContentElement}
            groups={groups}
            groupsLoading={isGroupsLoading}
            groupsError={groupsError}
            onCreateGroup={() => setCreateGroupDialogOpen(true)}
            onOpen={setPage}
          />
        </div>
      ) : null}
      {page === 'prompt' ? (
        <AssistantPromptField
          form={form}
          resource={resource}
          modelName={modelLabels.modelId}
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
      {page === 'mcp' ? (
        <McpCapabilityList
          selectedIds={values.mcpServerIds}
          onSelectedIdsChange={(ids) => form.setValue('mcpServerIds', ids, { shouldDirty: true })}
          emptyLabel={t('library.config.tools.empty_title')}
          portalContainer={dialogContentElement}
        />
      ) : null}
      {page === 'context' ? (
        <AssistantContextPage
          form={form}
          modelFilter={modelFilter}
          isModelDisabled={isModelDisabled}
          portalContainer={dialogContentElement}
          modelLabels={modelLabels}
          setModelLabels={setModelLabels}
        />
      ) : null}
      {page === 'parameters' ? (
        <FormField
          control={form.control}
          name="customParameters"
          render={({ field }) => (
            <CustomParametersField
              value={field.value}
              onChange={(customParameters) => field.onChange(customParameters)}
              portalContainer={dialogContentElement}
            />
          )}
        />
      ) : null}
      <CreateGroupDialog
        open={createGroupDialogOpen}
        onCreate={handleCreateGroup}
        onOpenChange={setCreateGroupDialogOpen}
      />
    </EditDialogPageShell>
  )
}

function AssistantPromptField({
  form,
  resource,
  modelName,
  portalContainer
}: {
  form: UseFormReturn<AssistantEditFormValues>
  resource: AssistantEditDialogResource
  modelName: string | null
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const [resetPreviewKey, setResetPreviewKey] = useState(0)
  const [polishing, setPolishing] = useState(false)
  const prompt = form.watch('prompt')
  const name = form.watch('name')
  const processedPrompt = usePromptProcessor({
    prompt,
    modelName: modelName ?? resource.modelName ?? undefined
  })

  const handlePromptChange = (nextPrompt: string) => {
    form.setValue('prompt', nextPrompt, { shouldDirty: true, shouldTouch: true })
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
      onRunningChange={setPolishing}
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
          disabled={polishing}
        />
      )}
    />
  )
}

function AssistantSettingsCards({
  form,
  portalContainer,
  groups,
  groupsLoading,
  groupsError,
  onCreateGroup,
  onOpen
}: {
  form: UseFormReturn<AssistantEditFormValues>
  portalContainer: HTMLElement | null
  groups: ReturnType<typeof useGroups>['groups']
  groupsLoading: ReturnType<typeof useGroups>['isLoading']
  groupsError: ReturnType<typeof useGroups>['error']
  onCreateGroup: () => void
  onOpen: (page: EditPage) => void
}) {
  const { t } = useTranslation()
  const values = form.watch()
  const { bases } = useKnowledgeBases()
  const { mcpServers } = useMcpServers()
  const servers = mcpServers.filter((server) => !isBrowserMcpServer(server))
  const linkedBases = bases.filter((base) => values.knowledgeBaseIds.includes(base.id)).length
  const enabledServers = servers.filter((server) => values.mcpServerIds.includes(server.id)).length
  const set = <K extends keyof AssistantEditFormValues>(key: K, value: AssistantEditFormValues[K]) =>
    form.setValue(key, value as never, { shouldDirty: true })
  const modelDefault = t('library.config.basic.default_value')
  const labels = {
    knowledge: t('library.config.dialogs.edit.knowledge_tab'),
    mcp: t('library.config.agent.section.tools.tab.mcp'),
    mcpServers: t('library.config.dialogs.edit.page.mcp'),
    browser: t('settings.browser.title'),
    temperature: t('library.config.basic.temperature'),
    topP: t('library.config.basic.top_p'),
    maxTokens: t('library.config.basic.max_tokens'),
    stream: t('library.config.basic.stream_output'),
    maxToolCalls: t('library.config.basic.max_tool_calls'),
    context: t('library.config.dialogs.edit.page.context'),
    parameters: t('library.config.basic.custom_params'),
    prompt: t('library.config.prompt.label'),
    group: t('library.config.basic.group')
  }
  const contextSummary =
    values.contextMaxMessages !== null
      ? t('library.config.dialogs.edit.context.recent', { count: values.contextMaxMessages })
      : values.contextOverrideEnabled
        ? t('library.config.dialogs.edit.context.custom')
        : t('library.config.dialogs.edit.context.global')

  return (
    <div className="flex flex-col gap-5">
      <SettingsSection title={t('library.config.dialogs.edit.section.capabilities')}>
        <SettingsRow label={labels.knowledge}>
          <SettingsLinkButton
            label={labels.knowledge}
            summary={countSummary(t, 'linked', linkedBases, bases.length)}
            onClick={() => onOpen('knowledge')}
          />
        </SettingsRow>
        <SettingsRow label={labels.mcp}>
          <SegmentedControl<AssistantFormState['mcpMode']>
            size="sm"
            aria-label={labels.mcp}
            value={values.mcpMode}
            onValueChange={(value) => set('mcpMode', value)}
            options={MCP_MODE_ORDER.map((id) => ({
              value: id,
              label: t(MCP_MODE_OPTIONS.find((mode) => mode.id === id)!.labelKey)
            }))}
          />
        </SettingsRow>
        {values.mcpMode === 'manual' ? (
          <SettingsRow label={labels.mcpServers}>
            <SettingsLinkButton
              label={labels.mcpServers}
              summary={countSummary(t, 'enabled', enabledServers, servers.length)}
              onClick={() => onOpen('mcp')}
            />
          </SettingsRow>
        ) : null}
        <SettingsRow label={labels.browser} hint={t('library.config.dialogs.edit.browser_hint')}>
          <Switch
            size="sm"
            aria-label={labels.browser}
            checked={values.enableBrowser}
            onCheckedChange={(checked) => set('enableBrowser', checked)}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t('library.config.dialogs.edit.section.answers')}>
        <SettingsRow
          label={labels.temperature}
          hint={values.enableTemperature ? values.temperature.toFixed(1) : modelDefault}
          below={
            values.enableTemperature ? (
              <Slider
                min={0}
                max={2}
                step={0.1}
                value={[values.temperature]}
                marks={[
                  { value: 0, label: t('library.config.basic.precise') },
                  { value: 1, label: '1' },
                  { value: 2, label: t('library.config.basic.creative') }
                ]}
                onValueChange={([value]) => set('temperature', value)}
              />
            ) : null
          }>
          <Switch
            size="sm"
            aria-label={labels.temperature}
            checked={values.enableTemperature}
            onCheckedChange={(checked) => set('enableTemperature', checked)}
          />
        </SettingsRow>
        <SettingsRow
          label={labels.topP}
          hint={values.enableTopP ? values.topP.toFixed(2) : modelDefault}
          below={
            values.enableTopP ? (
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[values.topP]}
                marks={[
                  { value: 0, label: '0' },
                  { value: 0.5, label: '0.5' },
                  { value: 1, label: '1' }
                ]}
                onValueChange={([value]) => set('topP', value)}
              />
            ) : null
          }>
          <Switch
            size="sm"
            aria-label={labels.topP}
            checked={values.enableTopP}
            onCheckedChange={(checked) => set('enableTopP', checked)}
          />
        </SettingsRow>
        <SettingsRow label={labels.maxTokens} hint={values.enableMaxTokens ? undefined : modelDefault}>
          {values.enableMaxTokens ? (
            <InputNumber
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              step={1}
              aria-label={t('library.config.dialogs.edit.value_label', { name: labels.maxTokens })}
              className="h-8 w-24 rounded-lg px-2.5"
              value={values.maxTokens}
              onBlur={(value) =>
                set('maxTokens', typeof value === 'number' && value > 0 ? value : UI_DEFAULT_MAX_TOKENS)
              }
            />
          ) : null}
          <Switch
            size="sm"
            aria-label={labels.maxTokens}
            checked={values.enableMaxTokens}
            onCheckedChange={(checked) => set('enableMaxTokens', checked)}
          />
        </SettingsRow>
        <SettingsRow label={labels.stream}>
          <Switch
            size="sm"
            aria-label={labels.stream}
            checked={values.streamOutput}
            onCheckedChange={(checked) => set('streamOutput', checked)}
          />
        </SettingsRow>
        {/* The "Other language…" input spans the next grid row, under the name and the select. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-1.5 [&>input]:col-span-2 [&>input]:mt-2">
          <span className="text-foreground text-sm">{t('library.config.agent.field.language.label')}</span>
          <ReplyLanguageSelect
            value={{ languageMode: values.languageMode, languageCustom: values.languageCustom }}
            onChange={(patch) => setFormValues<AssistantEditFormValues>(form, patch)}
            portalContainer={portalContainer}
            triggerClassName={cn(settingsPillClassName, 'w-auto')}
          />
        </div>
        <SettingsRow
          label={labels.maxToolCalls}
          hint={
            values.enableMaxToolCalls
              ? undefined
              : t('library.config.basic.max_tool_calls_default', { count: DEFAULT_ASSISTANT_SETTINGS.maxToolCalls })
          }>
          {values.enableMaxToolCalls ? (
            <InputNumber
              min={MIN_TOOL_CALLS}
              max={MAX_TOOL_CALLS}
              step={1}
              aria-label={t('library.config.dialogs.edit.value_label', { name: labels.maxToolCalls })}
              className="h-8 w-24 rounded-lg px-2.5"
              value={values.maxToolCalls}
              onBlur={(value) =>
                set(
                  'maxToolCalls',
                  typeof value === 'number' && value > 0 ? value : DEFAULT_ASSISTANT_SETTINGS.maxToolCalls
                )
              }
            />
          ) : null}
          <Switch
            size="sm"
            aria-label={labels.maxToolCalls}
            checked={values.enableMaxToolCalls}
            onCheckedChange={(checked) => set('enableMaxToolCalls', checked)}
          />
        </SettingsRow>
        <SettingsRow label={labels.context}>
          <SettingsLinkButton label={labels.context} summary={contextSummary} onClick={() => onOpen('context')} />
        </SettingsRow>
        <SettingsRow label={labels.parameters}>
          <SettingsLinkButton
            label={labels.parameters}
            summary={
              values.customParameters.length
                ? t('library.config.dialogs.edit.parameters_count', { count: values.customParameters.length })
                : t('library.config.dialogs.edit.count.none')
            }
            onClick={() => onOpen('parameters')}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t('library.config.dialogs.edit.advanced_tab')}>
        <SettingsRow label={labels.prompt}>
          <SettingsLinkButton
            label={labels.prompt}
            summary={
              values.prompt.trim()
                ? t('library.config.dialogs.edit.prompt_filled')
                : t('library.config.dialogs.edit.prompt_empty')
            }
            onClick={() => onOpen('prompt')}
          />
        </SettingsRow>
        <SettingsRow label={labels.group}>
          <GroupSelector
            value={values.groupId}
            onChange={(groupId) => set('groupId', groupId)}
            groups={groups}
            isLoading={groupsLoading}
            error={groupsError}
            portalContainer={portalContainer}
            onCreateGroup={onCreateGroup}
            triggerClassName={cn(settingsPillClassName, 'w-auto')}
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  )
}

/** Message count plus the context override (compression and truncation), seeded from the globals. */
function AssistantContextPage({
  form,
  modelFilter,
  isModelDisabled,
  portalContainer,
  modelLabels,
  setModelLabels
}: {
  form: UseFormReturn<AssistantEditFormValues>
  modelFilter: EditDialogBaseProps['modelFilter']
  isModelDisabled: EditDialogBaseProps['isModelDisabled']
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
}) {
  const [globalContextEnabled] = usePreference('chat.context_settings.enabled')
  const [globalMaxMessages] = usePreference('chat.context_settings.max_messages')
  const [globalCompressEnabled] = usePreference('chat.context_settings.compress.enabled')
  const [globalTruncateThreshold] = usePreference('chat.context_settings.truncate_threshold')
  const [globalCompressModelId] = usePreference('chat.context_settings.compress.model_id')
  const [globalCompressThreshold] = usePreference('chat.context_settings.compress.threshold_percent')

  return (
    <div className="grid gap-4">
      <ContextManagementFields
        form={form}
        modelFilter={modelFilter}
        isModelDisabled={isModelDisabled}
        portalContainer={portalContainer}
        modelLabels={modelLabels}
        setModelLabels={setModelLabels}
        globalDefaults={{
          enabled: globalContextEnabled,
          compressEnabled: globalCompressEnabled,
          maxMessages: globalMaxMessages,
          truncateThreshold: globalTruncateThreshold,
          compressThreshold: clampThresholdPercent(globalCompressThreshold),
          compressModelId: globalCompressModelId || null
        }}
      />
    </div>
  )
}

function ContextManagementFields({
  form,
  modelFilter,
  isModelDisabled,
  portalContainer,
  modelLabels,
  setModelLabels,
  globalDefaults
}: {
  form: UseFormReturn<AssistantEditFormValues>
  modelFilter: EditDialogBaseProps['modelFilter']
  isModelDisabled: EditDialogBaseProps['isModelDisabled']
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
  globalDefaults: {
    enabled: boolean
    compressEnabled: boolean
    truncateThreshold: number
    maxMessages: number | null
    compressThreshold: number
    compressModelId: string | null
  }
}) {
  const { t } = useTranslation()
  const values = form.watch()
  // Only re-seed from globals the first time an assistant WITHOUT a stored
  // override is customized — an ON→OFF→ON round trip on a stored override must
  // preserve the saved values.
  const hadStoredOverride = useRef(values.contextOverrideEnabled)

  const onOverrideToggle = (checked: boolean) => {
    if (checked && !hadStoredOverride.current) {
      form.setValue('contextCompressEnabled', globalDefaults.compressEnabled, { shouldDirty: true })
      form.setValue('contextTruncateThreshold', globalDefaults.truncateThreshold, { shouldDirty: true })
      form.setValue('contextCompressModelId', globalDefaults.compressModelId, { shouldDirty: true })
    }
    form.setValue('contextOverrideEnabled', checked, { shouldDirty: true })
  }

  return (
    <>
      <FormField
        control={form.control}
        name="contextMaxMessages"
        render={({ field }) => (
          <FormItem>
            <FieldLabelWithHelp
              label={t('library.config.basic.context_count')}
              help={t('library.config.basic.field.context_count.hint')}
            />
            <FormControl>
              {/* Outside the override group: scope is not an overflow policy. */}
              <InputNumber
                min={1}
                step={1}
                placeholder={
                  globalDefaults.maxMessages === null
                    ? t('library.config.basic.context_count_unlimited')
                    : t('library.config.basic.context_count_follow_global', { count: globalDefaults.maxMessages })
                }
                className="h-8 rounded-lg px-2.5"
                value={field.value}
                onBlur={(value) => field.onChange(value === null ? null : Math.floor(value))}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="flex items-center justify-between gap-3">
        <FieldLabelWithHelp
          label={t('library.config.basic.context_management')}
          help={t('library.config.basic.field.context_management.hint')}
          formLabel={false}
        />
        <Switch
          size="sm"
          checked={values.contextOverrideEnabled}
          onCheckedChange={onOverrideToggle}
          aria-label={t('library.config.basic.context_management')}
        />
      </div>
      {!globalDefaults.enabled ? (
        // Stored but inert while the global master switch is off — say so
        // rather than showing live-looking controls.
        <div className="-mt-2 text-muted-foreground text-xs leading-5">
          {t('library.config.basic.context_globally_disabled')}
        </div>
      ) : null}
      {!values.contextOverrideEnabled && globalDefaults.enabled ? (
        // Name what is being inherited: the values only become visible once the
        // override is on, so without this the user overrides a blank.
        <div className="-mt-2 text-muted-foreground text-xs leading-5">
          {t('library.config.basic.context_inherited', {
            compress: globalDefaults.compressEnabled
              ? t('library.config.basic.context_inherited_compress_on')
              : t('library.config.basic.context_inherited_compress_off'),
            threshold: globalDefaults.truncateThreshold
          })}
        </div>
      ) : null}
      {values.contextOverrideEnabled ? (
        // Indent alone carries the subordination — a rule here spanned the
        // parent row's padding and read as a stray edge.
        <div className="-mt-2 grid gap-4 pl-4">
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
                      onCheckedChange={field.onChange}
                      aria-label={t('library.config.basic.context_compress_enabled')}
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {values.contextCompressEnabled ? (
            <FormField
              control={form.control}
              name="contextCompressThresholdPercent"
              render={({ field }) => (
                <FormItem>
                  <FieldLabelWithHelp
                    label={t('library.config.basic.context_compress_threshold')}
                    help={t('library.config.basic.field.context_compress_threshold.hint')}
                  />
                  <InputGroup className="h-8 rounded-lg">
                    {/* Inside the group, not around it: `FormControl` is a `Slot` and
                        hands the label's `htmlFor` target to its immediate child. */}
                    <FormControl>
                      <InputGroupInputNumber
                        min={MIN_COMPRESS_THRESHOLD_PERCENT}
                        max={MAX_COMPRESS_THRESHOLD_PERCENT}
                        step={5}
                        // Empty = inherit; the placeholder names the global in force.
                        placeholder={t('library.config.basic.context_compress_threshold_follow_global', {
                          percent: globalDefaults.compressThreshold
                        })}
                        className="px-2.5"
                        value={field.value}
                        onBlur={(value) => field.onChange(value === null ? null : clampThresholdPercent(value))}
                      />
                    </FormControl>
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>%</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}

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
                  <InputNumber
                    // Same floor and step as the global panel — this doubles as
                    // fs_read's per-call cap. See MIN_TRUNCATE_THRESHOLD.
                    min={MIN_TRUNCATE_THRESHOLD}
                    step={1}
                    className="h-8 rounded-lg px-2.5"
                    value={field.value}
                    onBlur={(value) =>
                      field.onChange(
                        typeof value === 'number' && Number.isFinite(value)
                          ? Math.max(MIN_TRUNCATE_THRESHOLD, Math.floor(value))
                          : globalDefaults.truncateThreshold
                      )
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
            filter={(model, provider) => !isNonChatModel(model) && (modelFilter?.(model, provider) ?? true)}
            isModelDisabled={isModelDisabled}
            portalContainer={portalContainer}
            modelLabels={modelLabels}
            setModelLabels={setModelLabels}
            onModelChange={(modelId) => form.setValue('contextCompressModelId', modelId, { shouldDirty: true })}
          />
        </div>
      ) : null}
    </>
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
              onValueChange={(nextValue) => updateField(index, { value: nextValue })}
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
  const parameterValueLabel = param.name.trim()
    ? `${t('library.config.basic.custom_params_value')}: ${param.name.trim()}`
    : t('library.config.basic.custom_params_value')
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
              // Neither `min` nor `step`: custom parameters accept any real
              // number, including negatives and fractions.
              <InputNumber
                aria-label={parameterValueLabel}
                value={typeof param.value === 'number' ? param.value : null}
                onValueChange={(value) => onValueChange(value ?? 0)}
                // Settles an abandoned `-` / `1e` back to what the edit started
                // from; the live callback stays silent on those, so without this
                // the field keeps whatever the clear before them wrote.
                onBlur={(value) => onValueChange(value ?? 0)}
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
              <Input
                aria-label={parameterValueLabel}
                value={String(param.value)}
                onChange={(event) => onValueChange(event.target.value)}
              />
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
