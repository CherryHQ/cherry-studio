import {
  Button,
  EditableNumber,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Slider,
  Switch,
  TabsContent,
  Textarea
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import PromptEditorField from '@renderer/components/PromptEditorField'
import { useToasts } from '@renderer/components/TopView/toast'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { useEnsureTags, useTagList } from '@renderer/hooks/useTags'
import { useAssistantMutationsById } from '@renderer/pages/library/adapters/assistantAdapter'
import { getRandomTagColor, MCP_MODE_OPTIONS } from '@renderer/pages/library/constants'
import { fetchGenerate } from '@renderer/services/ApiService'
import { AGENT_PROMPT } from '@shared/ai/prompts'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { Database, Loader2, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { AddCatalogPopover, type CatalogItem } from '../components/CatalogPicker'
import { McpServerCatalogGrid } from '../components/McpServerCatalogGrid'
import { TagSelector } from '../components/TagSelector'
import { type AssistantFormState, diffAssistantSaveIntent, initialAssistantFormState } from '../form/assistant'
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
  setFormValues,
  TextInputField
} from './EditDialogShared'

export type AssistantEditDialogResource = Parameters<typeof initialAssistantFormState>[0]

export type AssistantEditDialogProps = EditDialogBaseProps<AssistantEditDialogResource> & {
  resource: AssistantEditDialogResource | null
}

type AssistantEditFormValues = {
  avatar: string
  name: string
  description: string
  modelId: UniqueModelId | null
  tags: string[]
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
  knowledgeBaseIds: string[]
  mcpServerIds: string[]
}

type CustomParameter = AssistantFormState['customParameters'][number]
type CustomParameterType = CustomParameter['type']
type AssistantToolTab = 'tools.mcp' | 'tools.knowledge'

const logger = loggerService.withContext('AssistantEditDialog')
const UI_DEFAULT_MAX_TOKENS = 4096
const UI_DEFAULT_MAX_TOOL_CALLS = 20

function KnowledgeBaseAvatar({
  className = 'flex size-6 shrink-0 items-center justify-center rounded-md text-xs'
}: {
  className?: string
}) {
  return (
    <span className={className} style={{ background: 'rgba(139, 92, 246, 0.125)' }}>
      <Database size={14} strokeWidth={1.4} />
    </span>
  )
}

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
    tags: form.tags,
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
    knowledgeBaseIds: [...form.knowledgeBaseIds],
    mcpServerIds: [...form.mcpServerIds]
  }
}

function modelLabelsForAssistant(resource: AssistantEditDialogResource): ModelLabels {
  return {
    modelId: resource.modelName ?? null,
    planModelId: null,
    smallModelId: null
  }
}

function buildAssistantFormState(baseline: AssistantFormState, values: AssistantEditFormValues): AssistantFormState {
  return {
    ...baseline,
    emoji: values.avatar,
    name: values.name,
    description: values.description,
    modelId: values.modelId,
    tags: values.tags,
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
    mcpMode: values.mcpMode,
    knowledgeBaseIds: values.knowledgeBaseIds,
    mcpServerIds: values.mcpServerIds
  }
}

export function AssistantEditDialog({ resource, open, onOpenChange, onSaved, modelFilter }: AssistantEditDialogProps) {
  if (!resource) return null

  return (
    <AssistantEditDialogContent
      resource={resource}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      modelFilter={modelFilter}
    />
  )
}

function AssistantEditDialogContent({
  resource,
  open,
  onOpenChange,
  onSaved,
  modelFilter
}: EditDialogBaseProps<AssistantEditDialogResource> & { resource: AssistantEditDialogResource }) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('basic')
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [dialogContentElement, setDialogContentElement] = useState<HTMLDivElement | null>(null)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(() => modelLabelsForAssistant(resource))
  const defaultValues = useMemo(() => defaultValuesForAssistant(resource), [resource])
  const form = useForm<AssistantEditFormValues>({ defaultValues })
  const values = form.watch()
  const { ensureTags } = useEnsureTags({ getDefaultColor: getRandomTagColor })
  const tagList = useTagList()
  const allTagNames = useMemo(() => tagList.tags.map((tag) => tag.name), [tagList.tags])
  const { updateAssistant } = useAssistantMutationsById(resource.id)
  const saveIntent = useMemo(() => {
    const baseline = initialAssistantFormState(resource)
    return diffAssistantSaveIntent(buildAssistantFormState(baseline, values), baseline, resource)
  }, [resource, values])
  const tabs = useMemo<EditDialogTab[]>(
    () => [
      { id: 'basic', label: t('library.config.dialogs.edit.basic_tab') },
      { id: 'advanced', label: t('library.config.agent.model_config') },
      { id: 'prompt', label: t('library.config.dialogs.edit.prompt_tab') },
      {
        id: 'tools',
        label: t('library.config.dialogs.edit.tools_tab'),
        children: [
          { id: 'tools.mcp', label: t('library.config.agent.section.tools.tab.mcp') },
          { id: 'tools.knowledge', label: t('library.config.dialogs.edit.knowledge_tab') }
        ]
      }
    ],
    [t]
  )

  useEffect(() => {
    if (!open) return

    form.reset(defaultValues)
    form.clearErrors()
    setActiveTab('basic')
    setEmojiPickerOpen(false)
    setModelLabels(modelLabelsForAssistant(resource))
  }, [defaultValues, form, open, resource])

  const isSubmitting = form.formState.isSubmitting
  const canSave = Boolean(saveIntent) && !isSubmitting
  const rootError = form.formState.errors.root?.message

  const handleSubmit = form.handleSubmit(async () => {
    const pending = saveIntent
    if (!pending) return

    form.clearErrors('root')

    let updated: Awaited<ReturnType<typeof updateAssistant>>
    try {
      updated = await updateAssistant({
        ...pending.payload,
        ...(pending.tagsChanged ? { tagIds: (await ensureTags(pending.tagNames)).map((tag) => tag.id) } : {})
      })
    } catch (error) {
      logger.error('Failed to save assistant edit dialog', error as Error, { assistantId: resource.id })
      form.setError('root', { message: t('library.config.dialogs.edit.save_failed') })
      return
    }

    onOpenChange(false)
    try {
      await onSaved(updated)
    } catch (error) {
      logger.warn('Failed to run assistant edit dialog post-save callback', { error, assistantId: resource.id })
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
      title={t('library.config.dialogs.edit.assistant_title')}>
      <TabsContent value="basic" forceMount hidden={activeTab !== 'basic'} className="m-0">
        <AssistantBasicFields
          form={form}
          modelFilter={modelFilter}
          portalContainer={dialogContentElement}
          modelLabels={modelLabels}
          setModelLabels={setModelLabels}
          allTagNames={allTagNames}
          emojiPickerOpen={emojiPickerOpen}
          setEmojiPickerOpen={setEmojiPickerOpen}
        />
      </TabsContent>
      <TabsContent value="prompt" forceMount hidden={activeTab !== 'prompt'} className="m-0">
        <AssistantPromptField
          form={form}
          resource={resource}
          modelName={modelLabels.modelId}
          portalContainer={dialogContentElement}
        />
      </TabsContent>
      {isAssistantToolTab(activeTab) ? (
        <TabsContent value={activeTab} forceMount className="m-0">
          {activeTab === 'tools.mcp' ? (
            <AssistantToolsFields form={form} portalContainer={dialogContentElement} />
          ) : (
            <AssistantKnowledgeFields form={form} portalContainer={dialogContentElement} />
          )}
        </TabsContent>
      ) : null}
      <TabsContent value="advanced" forceMount hidden={activeTab !== 'advanced'} className="m-0">
        <AssistantAdvancedFields form={form} portalContainer={dialogContentElement} />
      </TabsContent>
    </EditDialogShell>
  )
}

function AssistantBasicFields({
  form,
  modelFilter,
  portalContainer,
  modelLabels,
  setModelLabels,
  allTagNames,
  emojiPickerOpen,
  setEmojiPickerOpen
}: {
  form: UseFormReturn<AssistantEditFormValues>
  modelFilter?: (model: Model) => boolean
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
  allTagNames: string[]
  emojiPickerOpen: boolean
  setEmojiPickerOpen: (open: boolean) => void
}) {
  const { t } = useTranslation()
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

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-[auto_1fr] gap-4">
        <AvatarField
          form={form}
          emojiPickerOpen={emojiPickerOpen}
          setEmojiPickerOpen={setEmojiPickerOpen}
          fallback="💬"
          portalContainer={portalContainer}
        />
        <TextInputField
          form={form}
          name="name"
          label={t('common.name')}
          placeholder={t('library.config.basic.field.name.placeholder')}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="min-w-0">
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
          />
        </div>
        <FormField
          control={form.control}
          name="tags"
          render={({ field }) => (
            <FormItem className="min-w-0">
              <FormLabel>{t('library.config.basic.tags')}</FormLabel>
              <TagSelector
                value={field.value}
                onChange={field.onChange}
                allTagNames={allTagNames}
                portalContainer={portalContainer}
              />
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <TextInputField
        form={form}
        name="description"
        label={t('common.description')}
        placeholder={t('library.config.basic.field.description.placeholder')}
      />
    </div>
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
  const toast = useToasts()
  const [generating, setGenerating] = useState(false)
  const [showUndoButton, setShowUndoButton] = useState(false)
  const [originalPrompt, setOriginalPrompt] = useState('')
  const [resetPreviewKey, setResetPreviewKey] = useState(0)
  const generateRequestIdRef = useRef(0)
  const prompt = form.watch('prompt')
  const name = form.watch('name')
  const generateSource = prompt.trim() || name.trim()
  const processedPrompt = usePromptProcessor({
    prompt,
    modelName: modelName ?? resource.modelName ?? undefined
  })
  const promptGenerationFailedToast = {
    title: t('library.config.prompt.generate_failed_title'),
    description: t('library.config.prompt.generate_failed_description')
  }

  const handlePromptChange = (nextPrompt: string) => {
    setShowUndoButton(false)
    form.setValue('prompt', nextPrompt, { shouldDirty: true, shouldTouch: true })
  }

  useEffect(() => {
    return () => {
      generateRequestIdRef.current += 1
    }
  }, [])

  const handleGeneratePrompt = async () => {
    if (!generateSource || generating) return

    const requestId = generateRequestIdRef.current + 1
    generateRequestIdRef.current = requestId
    setGenerating(true)
    setShowUndoButton(false)

    try {
      const generatedPrompt = await fetchGenerate({
        prompt: AGENT_PROMPT,
        content: generateSource,
        throwOnError: true
      })

      if (generateRequestIdRef.current !== requestId) return
      if (!generatedPrompt) {
        toast.error(promptGenerationFailedToast)
        return
      }

      setOriginalPrompt(prompt)
      form.setValue('prompt', generatedPrompt, { shouldDirty: true, shouldTouch: true })
      setShowUndoButton(true)
      setResetPreviewKey((key) => key + 1)
    } catch (error) {
      logger.error('Failed to generate assistant prompt from edit dialog', error as Error, {
        assistantId: resource.id
      })
      toast.error(promptGenerationFailedToast)
    } finally {
      if (generateRequestIdRef.current === requestId) {
        setGenerating(false)
      }
    }
  }

  const handleUndoGeneratedPrompt = () => {
    form.setValue('prompt', originalPrompt, { shouldDirty: true, shouldTouch: true })
    setShowUndoButton(false)
    setResetPreviewKey((key) => key + 1)
  }

  const promptActions = (
    <>
      {showUndoButton ? (
        <Button
          type="button"
          variant="ghost"
          aria-label={t('common.undo')}
          onClick={handleUndoGeneratedPrompt}
          className="flex h-6 min-h-0 w-6 items-center justify-center rounded-2xs border border-border/20 p-0 text-muted-foreground/80 shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0">
          <Undo2 size={10} />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        aria-label={t('library.config.prompt.generate')}
        onClick={handleGeneratePrompt}
        disabled={!generateSource || generating}
        className="flex h-6 min-h-0 w-6 items-center justify-center rounded-2xs border border-border/20 p-0 text-muted-foreground/80 shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40">
        {generating ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
      </Button>
    </>
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
          minHeight={EDIT_DIALOG_PROMPT_MIN_HEIGHT}
          maxHeight={EDIT_DIALOG_PROMPT_MAX_HEIGHT}
        />
      )}
    />
  )
}

function AssistantKnowledgeFields({
  form,
  portalContainer
}: {
  form: UseFormReturn<AssistantEditFormValues>
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery('/knowledge-bases', { query: { limit: 100 } })
  const bases = useMemo(() => data?.items ?? [], [data])
  const value = form.watch('knowledgeBaseIds')

  const { catalog, linkedItems } = useMemo(() => {
    const byId = new Map(bases.map((base) => [base.id, base]))
    const linked = value.map(
      (id) =>
        byId.get(id) ?? {
          id,
          name: `${id.slice(0, 8)}${t('library.config.knowledge.invalid_suffix')}`,
          itemCount: 0
        }
    )
    const items: CatalogItem[] = bases.map((base) => ({
      id: base.id,
      name: base.name,
      description: t('library.config.knowledge.doc_count', { count: base.itemCount ?? 0 }),
      icon: <KnowledgeBaseAvatar />
    }))
    return { catalog: items, linkedItems: linked }
  }, [bases, t, value])

  const remove = (id: string) =>
    form.setValue(
      'knowledgeBaseIds',
      value.filter((itemId) => itemId !== id),
      { shouldDirty: true }
    )
  const add = (id: string) => {
    form.setValue('knowledgeBaseIds', [...value, id], { shouldDirty: true })
  }

  return (
    <div className="grid gap-4">
      <FormField
        control={form.control}
        name="knowledgeBaseIds"
        render={() => (
          <FormItem>
            <FieldLabelWithHelp
              label={t('library.config.knowledge.linked')}
              help={t('library.config.knowledge.linked_hint')}
            />
            {linkedItems.length === 0 ? (
              <div className="mt-2 flex flex-col items-center rounded-md border border-border/20 border-dashed p-6">
                <Database size={20} strokeWidth={1.2} className="mb-2 text-muted-foreground/80" />
                <p className="mb-1 text-muted-foreground/80 text-xs">{t('library.config.knowledge.empty_title')}</p>
                <p className="text-muted-foreground/80 text-xs">{t('library.config.knowledge.empty_desc')}</p>
              </div>
            ) : (
              <div className="mt-2 space-y-1.5">
                {linkedItems.map((kb) => (
                  <div
                    key={kb.id}
                    className="group flex items-center gap-3 rounded-md border border-border/35 bg-accent/15 px-3 py-2.5 transition-colors hover:border-border/50 hover:bg-accent/20">
                    <KnowledgeBaseAvatar className="flex size-8 shrink-0 items-center justify-center rounded-md text-base leading-none" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-foreground text-sm">{kb.name}</div>
                      <div className="text-muted-foreground/80 text-xs">
                        {t('library.config.knowledge.doc_count', { count: kb.itemCount ?? 0 })}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => remove(kb.id)}
                      aria-label={t('library.config.knowledge.remove_aria')}
                      className="flex h-6 min-h-0 w-6 items-center justify-center rounded-md font-normal text-muted-foreground/80 opacity-0 shadow-none transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:ring-0 group-hover:opacity-100">
                      <Trash2 size={10} />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <AddCatalogPopover
              items={catalog}
              enabledIds={new Set(value)}
              onAdd={add}
              triggerLabel={t('library.config.knowledge.add')}
              searchPlaceholder={t('library.config.knowledge.search')}
              emptyLabel={t('library.config.knowledge.no_more')}
              disabled={isLoading}
              align="start"
              triggerPosition="start"
              triggerClassName="mt-2"
              portalContainer={portalContainer}
            />
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}

function AssistantToolsFields({
  form,
  portalContainer
}: {
  form: UseFormReturn<AssistantEditFormValues>
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const mcpMode = form.watch('mcpMode')
  const mcpServerIds = form.watch('mcpServerIds')
  const mcpEnabled = mcpMode !== 'disabled'
  const mcpModeLabel = t('library.config.basic.mcp_mode')
  const selectableMcpModes = useMemo(() => MCP_MODE_OPTIONS.filter((mode) => mode.id !== 'disabled'), [])

  const enabledIds = useMemo(() => new Set(mcpServerIds), [mcpServerIds])
  const toggleMcpServer = (id: string, enabled: boolean) =>
    form.setValue(
      'mcpServerIds',
      enabled ? Array.from(new Set([...mcpServerIds, id])) : mcpServerIds.filter((serverId) => serverId !== id),
      { shouldDirty: true }
    )

  return (
    <div className="grid gap-4">
      <FormField
        control={form.control}
        name="mcpMode"
        render={() => (
          <FormItem className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <FormLabel>{`${t('library.action.enable')} MCP`}</FormLabel>
              <FormControl>
                <Switch
                  size="sm"
                  checked={mcpEnabled}
                  onCheckedChange={(checked) =>
                    form.setValue('mcpMode', checked ? 'auto' : 'disabled', { shouldDirty: true })
                  }
                  aria-label={`${t('library.action.enable')} MCP`}
                />
              </FormControl>
            </div>
            {mcpEnabled ? (
              <div className="flex items-start justify-between gap-3">
                <FormLabel className="pt-2">{mcpModeLabel}</FormLabel>
                <div className="w-36 shrink-0">
                  <Select
                    value={mcpMode === 'manual' ? 'manual' : 'auto'}
                    onValueChange={(value) =>
                      form.setValue('mcpMode', value as AssistantFormState['mcpMode'], { shouldDirty: true })
                    }>
                    <FormControl>
                      <SelectTrigger className="w-full" aria-label={mcpModeLabel}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent portalContainer={portalContainer}>
                      {selectableMcpModes.map((mode) => (
                        <SelectItem key={mode.id} value={mode.id}>
                          {t(mode.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
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
  form,
  portalContainer
}: {
  form: UseFormReturn<AssistantEditFormValues>
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const values = form.watch()
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
    <div className="grid gap-4">
      <ToggleFieldGroup
        label={t('library.config.basic.temperature')}
        valueLabel={values.enableTemperature ? values.temperature.toFixed(1) : t('library.config.basic.default_value')}
        description={t('library.config.basic.field.temperature.hint')}
        enabled={values.enableTemperature}
        onEnabledChange={(checked) => form.setValue('enableTemperature', checked, { shouldDirty: true })}>
        <FormField
          control={form.control}
          name="temperature"
          render={({ field }) => (
            <div className="-mb-2 mt-3 w-full max-w-xl">
              <Slider
                min={0}
                max={2}
                step={0.1}
                value={[field.value]}
                marks={temperatureMarks}
                onValueChange={([value]) => field.onChange(value)}
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
        onEnabledChange={(checked) => form.setValue('enableTopP', checked, { shouldDirty: true })}>
        <FormField
          control={form.control}
          name="topP"
          render={({ field }) => (
            <div className="-mb-2 mt-3 w-full max-w-xl">
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[field.value]}
                marks={topPMarks}
                onValueChange={([value]) => field.onChange(value)}
                className="w-full"
              />
            </div>
          )}
        />
      </ToggleFieldGroup>

      <ToggleFieldGroup
        label={t('library.config.basic.max_tokens')}
        valueLabel={
          values.enableMaxTokens ? values.maxTokens.toLocaleString() : t('library.config.basic.default_value')
        }
        description={t('library.config.basic.field.max_tokens.hint')}
        enabled={values.enableMaxTokens}
        onEnabledChange={(checked) => form.setValue('enableMaxTokens', checked, { shouldDirty: true })}>
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
              value={field.value}
              onChange={(value) =>
                field.onChange(typeof value === 'number' && value > 0 ? value : UI_DEFAULT_MAX_TOKENS)
              }
            />
          )}
        />
      </ToggleFieldGroup>

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
                  onCheckedChange={field.onChange}
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
        valueLabel={values.enableMaxToolCalls ? values.maxToolCalls.toString() : t('library.config.basic.unlimited')}
        description={t('library.config.basic.field.max_tool_calls.hint')}
        enabled={values.enableMaxToolCalls}
        onEnabledChange={(checked) => form.setValue('enableMaxToolCalls', checked, { shouldDirty: true })}>
        <FormField
          control={form.control}
          name="maxToolCalls"
          render={({ field }) => (
            <EditableNumber
              block
              min={1}
              step={1}
              precision={0}
              align="start"
              changeOnBlur
              value={field.value}
              onChange={(value) =>
                field.onChange(typeof value === 'number' && value > 0 ? value : UI_DEFAULT_MAX_TOOL_CALLS)
              }
            />
          )}
        />
      </ToggleFieldGroup>

      <Separator className="bg-border/30" />
      <FormField
        control={form.control}
        name="customParameters"
        render={({ field }) => (
          <CustomParametersField
            value={field.value}
            onChange={(customParameters) => field.onChange(customParameters)}
            portalContainer={portalContainer}
          />
        )}
      />
    </div>
  )
}

function ToggleFieldGroup({
  label,
  valueLabel,
  description,
  enabled,
  onEnabledChange,
  children
}: {
  label: string
  valueLabel: string
  description: string
  enabled: boolean
  onEnabledChange: (checked: boolean) => void
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <FieldLabelWithHelp label={label} help={description} formLabel={false} />
            <span className="text-muted-foreground/80 text-sm">{valueLabel}</span>
          </div>
        </div>
        <Switch size="sm" checked={enabled} onCheckedChange={onEnabledChange} aria-label={label} />
      </div>
      {enabled ? <div className="mt-2">{children}</div> : null}
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
    <div className="rounded-xs border border-border/20 bg-accent/15 p-2">
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
          {jsonInvalid ? (
            <p className="mt-1 text-destructive/80 text-xs">{t('library.config.basic.json_invalid')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
