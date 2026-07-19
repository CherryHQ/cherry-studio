import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  MenuItem,
  MenuList,
  NormalTooltip,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Scrollbar,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useModelById } from '@renderer/hooks/useModel'
import { toast } from '@renderer/services/toast'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { ArrowUpRight, ChevronDown, Database, HelpCircle, Trash2, X } from 'lucide-react'
import { type ComponentProps, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type FieldValues, type Path, type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { AddCatalogPopover, type CatalogItem } from './CatalogPicker'
import { DialogModelFrame, DialogModelTrigger, EmojiAvatarPicker } from './DialogFormFields'

// Vertical submenu / nav item preset — kept in sync with the settings sidebar's
// settingsSubmenuItemClassName so the edit-dialog rail and settings nav read identically.
const submenuItemClassName =
  'h-8 rounded-[10px] border-transparent px-2.5 font-normal text-foreground text-sm hover:!bg-muted data-[active=true]:!border-transparent data-[active=true]:!bg-muted data-[active=true]:!font-medium data-[active=true]:!text-foreground [&_svg]:size-4 [&_svg]:text-foreground'

// Neutralize TabsTrigger's default-variant layout leak (justify-center + flex-1) when a
// MenuItem is rendered as a vertical tab via `asChild`, keeping rail items left-aligned at h-8.
const railTabItemClassName = cn(submenuItemClassName, 'data-[state=active]:!shadow-none flex-none justify-start')

const logger = loggerService.withContext('EditDialogShared')

export type ModelLabelKey = 'modelId' | 'planModelId' | 'smallModelId'
export type ModelLabels = Record<ModelLabelKey, string | null>

export type EditDialogBaseProps<TResource> = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (resource: TResource) => Promise<void> | void
  modelFilter?: (model: Model) => boolean
}

export type EditDialogTab = {
  id: string
  label: string
  children?: EditDialogTab[]
}

export type EditDialogGroupExpansion = 'collapsed' | 'all'
export type EditDialogGroupPresentation = 'grouped' | 'inline'

function resolveTabValue(tabs: EditDialogTab[], value: string) {
  const matched = tabs.find((tab) => tab.id === value)
  return matched?.children?.[0]?.id ?? value
}

function getDefaultExpandedGroupIds(tabs: EditDialogTab[], groupExpansion: EditDialogGroupExpansion) {
  if (groupExpansion === 'all') {
    return new Set(tabs.filter((tab) => tab.children?.length).map((tab) => tab.id))
  }
  return new Set<string>()
}

const PROMPT_VARIABLES: { name: string; i18n: string }[] = [
  { name: '{{date}}', i18n: 'library.config.prompt.vars.date' },
  { name: '{{time}}', i18n: 'library.config.prompt.vars.time' },
  { name: '{{datetime}}', i18n: 'library.config.prompt.vars.datetime' },
  { name: '{{system}}', i18n: 'library.config.prompt.vars.os' },
  { name: '{{arch}}', i18n: 'library.config.prompt.vars.arch' },
  { name: '{{language}}', i18n: 'library.config.prompt.vars.language' },
  { name: '{{model_name}}', i18n: 'library.config.prompt.vars.model_name' },
  { name: '{{username}}', i18n: 'library.config.prompt.vars.username' }
]

export const EDIT_DIALOG_PROMPT_MIN_HEIGHT = '200px'
export const EDIT_DIALOG_PROMPT_MAX_HEIGHT = '50vh'

export function getSelectedModelId(selection: UniqueModelId | Model | undefined): UniqueModelId | null {
  if (!selection) return null
  if (typeof selection === 'string') return selection
  return selection.id
}

export function getSelectedModelLabel(selection: UniqueModelId | Model | undefined): string | null {
  if (!selection) return null
  if (typeof selection === 'string') return selection
  return selection.name
}

export function setFormValues<TValues extends FieldValues>(form: UseFormReturn<TValues>, patch: Partial<TValues>) {
  Object.entries(patch).forEach(([key, value]) => {
    form.setValue(key as never, value as never, { shouldDirty: true })
  })
}

/**
 * Debounced auto-save for the edit dialogs. Re-arms whenever `changeKey` changes
 * (a serialized snapshot of the pending diff) and fires `onSave` after `delay`ms
 * of quiet. `changeKey === null` means nothing to save.
 *
 * Saves are serialized: only one runs at a time. If the state moves on while a
 * save is in flight, a single follow-up pass is queued and runs (with the latest
 * `onSave`) once the current save settles — so the last edit is never dropped.
 *
 * Returns a `flush()` that runs/awaits the serialized save immediately; callers
 * (e.g. the close path) await it to persist pending edits before proceeding,
 * reusing the same queue instead of racing a second concurrent save.
 */
export function useDebouncedAutoSave({
  enabled,
  changeKey,
  onSave,
  delay = 500
}: {
  enabled: boolean
  changeKey: string | null
  onSave: () => void | Promise<void>
  delay?: number
}): () => Promise<void> {
  const onSaveRef = useRef(onSave)
  const changeKeyRef = useRef(changeKey)
  const savingRef = useRef(false)
  // `changeKey` captured when the in-flight save started; a follow-up pass is
  // only queued when the state has moved past it.
  const savedKeyRef = useRef<string | null>(null)
  const pendingRef = useRef(false)
  const inFlightRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    onSaveRef.current = onSave
    changeKeyRef.current = changeKey
  })

  const flush = useCallback((): Promise<void> => {
    if (savingRef.current) {
      // A save is already running; queue one more pass only if the latest state
      // differs from what that save captured (otherwise it already covers it).
      if (changeKeyRef.current !== savedKeyRef.current) pendingRef.current = true
      return inFlightRef.current
    }
    savingRef.current = true
    inFlightRef.current = (async () => {
      try {
        do {
          pendingRef.current = false
          savedKeyRef.current = changeKeyRef.current
          await onSaveRef.current()
        } while (pendingRef.current)
      } finally {
        savingRef.current = false
      }
    })()
    return inFlightRef.current
  }, [])

  useEffect(() => {
    if (!enabled || changeKey === null) return
    const handle = setTimeout(() => void flush(), delay)
    return () => clearTimeout(handle)
  }, [enabled, changeKey, delay, flush])

  return flush
}

const HelpIconButton = ({
  ref,
  ariaLabel,
  className,
  ...props
}: ComponentProps<'button'> & { ariaLabel: string } & { ref?: React.RefObject<HTMLButtonElement | null> }) => {
  return (
    <Button
      ref={ref}
      {...props}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={ariaLabel}
      className={cn(
        'flex size-4 min-h-0 shrink-0 items-center justify-center rounded-full border border-border/20 p-0 text-muted-foreground/70 shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0',
        className
      )}>
      <HelpCircle className="size-[11px]" />
    </Button>
  )
}
HelpIconButton.displayName = 'HelpIconButton'

export function FieldLabelWithHelp({
  label,
  help,
  helpTrigger,
  className,
  formLabel = true
}: {
  label: string
  help?: ReactNode
  helpTrigger?: ReactNode
  className?: string
  formLabel?: boolean
}) {
  const { t } = useTranslation()
  const labelContent = formLabel ? (
    <FormLabel className="font-normal">{label}</FormLabel>
  ) : (
    <span className="font-normal text-foreground text-sm leading-none">{label}</span>
  )

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {labelContent}
      {helpTrigger ??
        (help ? (
          <NormalTooltip content={help} delayDuration={300} sideOffset={4}>
            <HelpIconButton ariaLabel={`${label} ${t('common.help')}`} />
          </NormalTooltip>
        ) : null)}
    </div>
  )
}

export function KnowledgeBaseAvatar({
  className = 'flex size-6 shrink-0 items-center justify-center rounded-md text-xs'
}: {
  className?: string
}) {
  return (
    <span className={className} style={{ background: 'rgba(139, 92, 246, 0.125)', color: 'rgb(124, 58, 237)' }}>
      <Database size={14} strokeWidth={1.4} />
    </span>
  )
}

type KnowledgeBaseFieldValues = FieldValues & {
  knowledgeBaseIds: string[]
}

export function KnowledgeBaseField<TValues extends KnowledgeBaseFieldValues>({
  form,
  portalContainer,
  formLabel = true,
  disabled = false,
  onOpenKnowledgePage
}: {
  form: UseFormReturn<TValues>
  portalContainer: HTMLElement | null
  formLabel?: boolean
  disabled?: boolean
  onOpenKnowledgePage?: () => void
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery('/knowledge-bases', {
    query: { limit: 100 },
    swrOptions: { revalidateOnFocus: true }
  })
  const bases = useMemo(() => data?.items ?? [], [data])
  const fieldName = 'knowledgeBaseIds' as Path<TValues>
  const watchedValue = useWatch({ control: form.control, name: fieldName })
  const value = useMemo(() => (watchedValue ?? []) as string[], [watchedValue])

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

  const setKnowledgeBaseIds = (nextValue: string[]) =>
    form.setValue(fieldName, nextValue as never, { shouldDirty: true })
  const remove = (id: string) => setKnowledgeBaseIds(value.filter((itemId) => itemId !== id))
  const add = (id: string) => setKnowledgeBaseIds([...value, id])

  return (
    <FormField
      control={form.control}
      name={fieldName}
      render={() => (
        <FormItem>
          <div className="flex items-center justify-between gap-3">
            <FieldLabelWithHelp
              label={t('library.config.knowledge.linked')}
              help={t('library.config.knowledge.linked_hint')}
              formLabel={formLabel}
            />
            <AddCatalogPopover
              items={catalog}
              enabledIds={new Set(value)}
              onAdd={add}
              triggerLabel={t('library.config.knowledge.add')}
              searchPlaceholder={t('library.config.knowledge.search')}
              emptyLabel={t('library.config.knowledge.no_more')}
              disabled={isLoading || disabled}
              align="end"
              triggerPosition="end"
              triggerClassName="border border-border bg-transparent"
              portalContainer={portalContainer}
              footer={
                onOpenKnowledgePage ? (
                  <button
                    type="button"
                    disabled={disabled}
                    className="relative flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-muted-foreground text-xs transition-colors hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                    onClick={onOpenKnowledgePage}>
                    <ArrowUpRight size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{t('library.config.knowledge.create_first')}</span>
                  </button>
                ) : null
              }
            />
          </div>
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
                    disabled={disabled}
                    onClick={() => remove(kb.id)}
                    aria-label={t('library.config.knowledge.remove_aria')}
                    className="flex h-6 min-h-0 w-6 items-center justify-center rounded-md font-normal text-muted-foreground/80 opacity-0 shadow-none transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:ring-0 group-hover:opacity-100">
                    <Trash2 size={10} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function EditDialogShell<TValues extends FieldValues>({
  activeTab,
  children,
  form,
  onActiveTabChange,
  onOpenChange,
  open,
  rootError,
  setDialogContentElement,
  tabs,
  title,
  groupExpansion = 'collapsed',
  groupPresentation = 'grouped'
}: {
  activeTab: string
  children: ReactNode
  form: UseFormReturn<TValues>
  groupExpansion?: EditDialogGroupExpansion
  groupPresentation?: EditDialogGroupPresentation
  onActiveTabChange: (tab: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  rootError?: string
  setDialogContentElement: (element: HTMLDivElement | null) => void
  tabs: EditDialogTab[]
  title: string
}) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() =>
    getDefaultExpandedGroupIds(tabs, groupExpansion)
  )

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [activeTab])

  useEffect(() => {
    setExpandedGroupIds(open ? getDefaultExpandedGroupIds(tabs, groupExpansion) : new Set())
  }, [groupExpansion, open, tabs])

  useEffect(() => {
    const activeGroup = tabs.find((tab) => tab.children?.some((child) => child.id === activeTab))
    if (!activeGroup) return
    setExpandedGroupIds((current) => {
      if (current.has(activeGroup.id)) return current
      return new Set(current).add(activeGroup.id)
    })
  }, [activeTab, tabs])

  const handleTabValueChange = (value: string) => {
    onActiveTabChange(resolveTabValue(tabs, value))
  }

  const toggleTabGroup = (tabId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(tabId)) {
        next.delete(tabId)
      } else {
        next.add(tabId)
      }
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={setDialogContentElement}
        className="flex h-[min(600px,70vh)] flex-col gap-0 p-0 sm:max-w-180 lg:max-w-200">
        <Form {...form}>
          {/* Clipping lives on the form (rounded-[inherit]), not DialogContent: the dialog's
              transform makes it the containing block for portaled fixed poppers (model selector),
              so overflow-hidden on DialogContent would clip them. */}
          <form
            id="resource-edit-dialog-form"
            onSubmit={(event) => event.preventDefault()}
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
            {/* Header — title, matching the create wizard's top bar. */}
            <div className="flex shrink-0 items-center gap-3 border-border-muted border-b px-6 py-3 pr-12">
              <div className="min-w-0">
                <DialogTitle className="truncate text-base">{title}</DialogTitle>
              </div>
            </div>
            <Tabs
              value={activeTab}
              onValueChange={handleTabValueChange}
              orientation="vertical"
              className="min-h-0 flex-1 gap-0 overflow-hidden">
              {/* White rail matching the settings-page nav: hairline divider, no sidebar tint. */}
              <div className="flex w-40 shrink-0 flex-col border-border border-r-[0.5px]">
                <TabsList
                  asChild
                  className="h-auto w-full items-stretch justify-start rounded-none bg-transparent p-2.5">
                  <MenuList>
                    {tabs.map((tab) => {
                      const hasChildren = Boolean(tab.children?.length)
                      if (hasChildren && groupPresentation === 'inline') {
                        return tab.children?.map((child) => (
                          <TabsTrigger key={child.id} value={child.id} asChild>
                            <MenuItem
                              label={child.label}
                              active={activeTab === child.id}
                              className={railTabItemClassName}
                            />
                          </TabsTrigger>
                        ))
                      }

                      const groupExpanded = expandedGroupIds.has(tab.id)

                      return (
                        <div key={tab.id} className="grid gap-1">
                          {hasChildren ? (
                            <MenuItem
                              label={tab.label}
                              aria-expanded={groupExpanded}
                              onClick={() => toggleTabGroup(tab.id)}
                              className={submenuItemClassName}
                              suffix={
                                <ChevronDown
                                  size={13}
                                  strokeWidth={1.8}
                                  className="mr-1 shrink-0 transition-transform data-[expanded=true]:rotate-180"
                                  data-expanded={groupExpanded || undefined}
                                />
                              }
                            />
                          ) : (
                            <TabsTrigger value={tab.id} asChild>
                              <MenuItem
                                label={tab.label}
                                active={activeTab === tab.id}
                                className={railTabItemClassName}
                              />
                            </TabsTrigger>
                          )}
                          {hasChildren && groupExpanded ? (
                            <div className="grid gap-1">
                              {tab.children?.map((child) => (
                                <TabsTrigger key={child.id} value={child.id} asChild>
                                  <MenuItem
                                    label={child.label}
                                    active={activeTab === child.id}
                                    className={railTabItemClassName}
                                  />
                                </TabsTrigger>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </MenuList>
                </TabsList>
              </div>

              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <Scrollbar ref={scrollContainerRef} className="min-h-0 min-w-0 flex-1 px-5 pt-4 pb-2">
                  {children}
                </Scrollbar>
                {/* Always-present bottom band: insets scrolling lists from the dialog's
                    rounded-3xl corners so content never clips into them mid-scroll, and
                    surfaces the save error inline when present. */}
                <div className="flex min-h-6 shrink-0 items-center px-5 pb-3" aria-live="polite">
                  {rootError ? <p className="text-destructive text-xs">{rootError}</p> : null}
                </div>
              </div>
            </Tabs>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export function AvatarField({
  form,
  emojiPickerOpen,
  setEmojiPickerOpen,
  fallback,
  portalContainer,
  size
}: {
  form: UseFormReturn<any>
  emojiPickerOpen: boolean
  setEmojiPickerOpen: (open: boolean) => void
  fallback: string
  portalContainer: HTMLElement | null
  size?: 'sm' | 'md'
}) {
  const { t } = useTranslation()
  const avatar = form.watch('avatar')

  return (
    <FormField
      control={form.control}
      name="avatar"
      render={({ field }) => (
        <FormItem>
          <FormLabel className="font-normal">{t('common.avatar')}</FormLabel>
          <EmojiAvatarPicker
            value={avatar}
            fallback={fallback}
            open={emojiPickerOpen}
            onOpenChange={setEmojiPickerOpen}
            onChange={field.onChange}
            ariaLabel={t('library.config.dialogs.create.avatar_aria')}
            portalContainer={portalContainer}
            size={size}
          />
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function TextInputField({
  form,
  name,
  label,
  description,
  placeholder,
  required = false
}: {
  form: UseFormReturn<any>
  name: 'name' | 'description'
  label: string
  description?: string
  placeholder?: string
  required?: boolean
}) {
  const { t } = useTranslation()

  return (
    <FormField
      control={form.control}
      name={name}
      rules={required ? { validate: (value) => value.trim().length > 0 || t('common.required_field') } : undefined}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="font-normal">{label}</FormLabel>
          <FormControl>
            {name === 'description' ? (
              <Textarea.Input
                value={field.value}
                rows={2}
                placeholder={placeholder}
                onValueChange={field.onChange}
                className="min-h-16"
              />
            ) : (
              <Input {...field} placeholder={placeholder} />
            )}
          </FormControl>
          {description ? <FormDescription className="text-xs">{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function CompactModelField({
  form,
  name,
  label,
  description,
  allowClear = false,
  filter,
  portalContainer,
  modelLabels,
  setModelLabels,
  onModelChange,
  onSettingsNavigate
}: {
  form: UseFormReturn<any>
  name: ModelLabelKey
  label: string
  description?: string
  allowClear?: boolean
  filter?: (model: Model) => boolean
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
  onModelChange?: (modelId: UniqueModelId | null, model?: Model) => void
  onSettingsNavigate?: (navigate: () => void) => void
}) {
  const { t } = useTranslation()
  const value = form.watch(name)
  const selectorValue = value && isUniqueModelId(value) ? value : undefined
  const parsedModelId = selectorValue ? parseUniqueModelId(selectorValue) : undefined
  const { model: resolvedModel } = useModelById(selectorValue)
  const selectedModel = resolvedModel?.id === selectorValue ? resolvedModel : undefined
  const labelFromState = modelLabels[name]
  const displayLabel =
    selectedModel?.name ??
    (labelFromState && labelFromState !== selectorValue ? labelFromState : parsedModelId?.modelId) ??
    t('library.config.basic.model_pick')
  const triggerModel =
    selectedModel ??
    (selectorValue && parsedModelId
      ? { id: selectorValue, name: displayLabel, providerId: parsedModelId.providerId }
      : undefined)

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="font-normal">{label}</FormLabel>
          <DialogModelFrame>
            <div className="group/model-field relative flex w-full min-w-0 items-center">
              <ModelSelector
                multiple={false}
                selectionType="id"
                value={selectorValue}
                filter={filter}
                portalContainer={portalContainer}
                onSettingsNavigate={onSettingsNavigate}
                onSelect={(selection: UniqueModelId | Model | undefined) => {
                  const selectedModelId = getSelectedModelId(selection)
                  if (onModelChange) {
                    onModelChange(selectedModelId, typeof selection === 'string' ? undefined : selection)
                  } else {
                    field.onChange(selectedModelId ?? (name === 'modelId' ? null : ''))
                  }
                  const selectedLabel = getSelectedModelLabel(selection)
                  setModelLabels({ ...modelLabels, [name]: selectedLabel })
                }}
                trigger={
                  <DialogModelTrigger
                    ariaLabel={label}
                    model={triggerModel}
                    displayLabel={displayLabel}
                    className={cn('w-full', triggerModel ? 'hover:text-foreground' : 'hover:text-muted-foreground')}
                    chevronClassName={
                      allowClear && value
                        ? 'group-hover/model-field:opacity-0 group-focus-within/model-field:opacity-0'
                        : undefined
                    }
                  />
                }
              />
              {allowClear && value ? (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`${label} ${t('library.config.basic.model_clear')}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (onModelChange) {
                      onModelChange(null)
                    } else {
                      field.onChange('')
                    }
                    setModelLabels({ ...modelLabels, [name]: null })
                  }}
                  className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-1.5 flex size-5 min-h-0 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-muted-foreground/70 opacity-0 shadow-none transition-[background-color,color,opacity] hover:bg-muted hover:text-foreground focus-visible:pointer-events-auto focus-visible:bg-muted focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring/40 active:bg-muted group-focus-within/model-field:pointer-events-auto group-focus-within/model-field:opacity-100 group-hover/model-field:pointer-events-auto group-hover/model-field:opacity-100">
                  <X size={12} />
                </Button>
              ) : null}
            </div>
          </DialogModelFrame>
          {description ? <FormDescription className="text-xs">{description}</FormDescription> : null}
          {name === 'modelId' && value && !modelLabels[name] && !selectedModel ? (
            <FormDescription className="text-xs">
              {t('library.config.basic.model_not_found', { id: value })}
            </FormDescription>
          ) : null}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function PromptVariablesPopover({ portalContainer }: { portalContainer: HTMLElement | null }) {
  const { t } = useTranslation()
  const copyVariable = (variable: string) => {
    navigator.clipboard
      .writeText(variable)
      .then(() => toast.success(t('message.copy.success')))
      .catch((error) => {
        logger.warn('Failed to copy prompt variable to clipboard', error as Error)
      })
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <HelpIconButton ariaLabel={t('library.config.prompt.variables_title')} />
      </PopoverTrigger>
      <PopoverContent
        portalContainer={portalContainer}
        align="center"
        sideOffset={0}
        aria-label={t('library.config.prompt.variables_title')}
        className="w-80 p-3">
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="font-medium text-foreground text-xs">{t('library.config.prompt.variables_title')}</div>
            <div className="text-foreground-secondary text-xs leading-relaxed">
              {t('library.config.prompt.variables_description')}
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/50 px-2 py-1.5 text-foreground-secondary text-xs">
            {t('library.config.prompt.variables_example', { variable: '{{date}}' })}
          </div>
          <div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-foreground-secondary text-xs">
              {PROMPT_VARIABLES.map((variable) => (
                <div key={variable.name} className="contents">
                  <button
                    type="button"
                    className="rounded px-1 text-left text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
                    aria-label={t('library.config.prompt.copy_variable', { variable: variable.name })}
                    onClick={() => copyVariable(variable.name)}>
                    {variable.name}
                  </button>
                  <span className="font-sans">{t(variable.i18n)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
