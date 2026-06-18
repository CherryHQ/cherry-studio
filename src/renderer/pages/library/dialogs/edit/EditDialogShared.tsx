import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  MenuList,
  NormalTooltip,
  Scrollbar,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ModelSelector } from '@renderer/components/Selector/model'
import { useModelById } from '@renderer/hooks/useModel'
import { useProviderDisplayName } from '@renderer/hooks/useProvider'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { ChevronDown, HelpCircle, X } from 'lucide-react'
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { DialogModelFrame, DialogModelTrigger, EmojiAvatarPicker } from '../components/DialogFormFields'

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

function resolveTabValue(tabs: EditDialogTab[], value: string) {
  const matched = tabs.find((tab) => tab.id === value)
  return matched?.children?.[0]?.id ?? value
}

function getDefaultExpandedGroupIds() {
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

const EDIT_DIALOG_TAB_TRIGGER_CLASS =
  'h-8 w-full flex-none justify-start rounded-md bg-transparent px-0 text-left font-medium text-muted-foreground text-sm shadow-none transition-colors hover:bg-accent/45 hover:text-foreground data-[state=active]:bg-accent/60 data-[state=active]:text-foreground data-[state=active]:shadow-none'

const EDIT_DIALOG_GROUP_BUTTON_CLASS =
  'flex h-8 w-full items-center justify-start rounded-md bg-transparent px-0 text-left font-medium text-muted-foreground text-sm transition-colors hover:bg-accent/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

const EDIT_DIALOG_CHILD_TAB_TRIGGER_CLASS = EDIT_DIALOG_TAB_TRIGGER_CLASS

export const EDIT_DIALOG_PROMPT_MIN_HEIGHT = '200px'
export const EDIT_DIALOG_PROMPT_MAX_HEIGHT = '42vh'

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
        'flex size-4 min-h-0 shrink-0 items-center justify-center rounded-2xs border border-border/20 p-0 text-muted-foreground/70 shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0',
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
    <FormLabel>{label}</FormLabel>
  ) : (
    <span className="font-medium text-foreground text-sm leading-none">{label}</span>
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

export function EditDialogShell<TValues extends FieldValues>({
  activeTab,
  canSave,
  children,
  form,
  isSubmitting,
  onActiveTabChange,
  onOpenChange,
  onSubmit,
  open,
  rootError,
  setDialogContentElement,
  tabs,
  title
}: {
  activeTab: string
  canSave: boolean
  children: ReactNode
  form: UseFormReturn<TValues>
  isSubmitting: boolean
  onActiveTabChange: (tab: string) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
  open: boolean
  rootError?: string
  setDialogContentElement: (element: HTMLDivElement | null) => void
  tabs: EditDialogTab[]
  title: string
}) {
  const { t } = useTranslation()
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => getDefaultExpandedGroupIds())

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [activeTab])

  useEffect(() => {
    setExpandedGroupIds(open ? getDefaultExpandedGroupIds() : new Set())
  }, [open, tabs])

  useEffect(() => {
    const activeGroup = tabs.find((tab) => tab.children?.some((child) => child.id === activeTab))
    if (!activeGroup) return
    setExpandedGroupIds((current) => {
      if (current.has(activeGroup.id)) return current
      return new Set(current).add(activeGroup.id)
    })
  }, [activeTab, tabs])

  const handleClose = (nextOpen: boolean) => {
    if (isSubmitting) return
    onOpenChange(nextOpen)
  }

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
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        ref={setDialogContentElement}
        closeOnOverlayClick={!isSubmitting}
        className="flex h-[min(600px,70vh)] flex-col gap-4 sm:max-w-180 lg:max-w-200"
        onPointerDownOutside={(event) => isSubmitting && event.preventDefault()}>
        <DialogTitle className="text-xl">{title}</DialogTitle>

        <Form {...form}>
          <form
            id="resource-edit-dialog-form"
            onSubmit={onSubmit}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            <Tabs
              value={activeTab}
              onValueChange={handleTabValueChange}
              orientation="vertical"
              className="min-h-0 flex-1 gap-0 overflow-hidden">
              <div className="w-36 shrink-0 border-border-muted border-r pr-2">
                <TabsList asChild className="h-auto w-full items-stretch justify-start rounded-none bg-transparent p-0">
                  <MenuList>
                    {tabs.map((tab) => {
                      const hasChildren = Boolean(tab.children?.length)
                      const groupExpanded = expandedGroupIds.has(tab.id)

                      return (
                        <div key={tab.id} className="grid gap-1">
                          {hasChildren ? (
                            <button
                              type="button"
                              aria-expanded={groupExpanded}
                              data-expanded={groupExpanded || undefined}
                              className={EDIT_DIALOG_GROUP_BUTTON_CLASS}
                              onClick={() => toggleTabGroup(tab.id)}>
                              <span className="min-w-0 flex-1 truncate px-1 text-left">{tab.label}</span>
                              <ChevronDown
                                size={13}
                                strokeWidth={1.8}
                                className="mr-1 shrink-0 transition-transform data-[expanded=true]:rotate-180"
                                data-expanded={groupExpanded || undefined}
                              />
                            </button>
                          ) : (
                            <TabsTrigger value={tab.id} className={EDIT_DIALOG_TAB_TRIGGER_CLASS}>
                              <span className="min-w-0 flex-1 truncate px-1 text-left">{tab.label}</span>
                            </TabsTrigger>
                          )}
                          {hasChildren && groupExpanded ? (
                            <div className="grid gap-1">
                              {tab.children?.map((child) => (
                                <TabsTrigger
                                  key={child.id}
                                  value={child.id}
                                  className={EDIT_DIALOG_CHILD_TAB_TRIGGER_CLASS}>
                                  <span className="min-w-0 truncate px-1">{child.label}</span>
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

              <Scrollbar ref={scrollContainerRef} className="min-w-0 flex-1 px-5">
                {children}
              </Scrollbar>
            </Tabs>

            <DialogFooter className="flex-row items-center justify-between">
              <p className="min-h-4 flex-1 text-destructive text-xs" aria-live="polite">
                {rootError ?? ''}
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={!canSave} loading={isSubmitting}>
                  {t('common.save')}
                </Button>
              </div>
            </DialogFooter>
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
  portalContainer
}: {
  form: UseFormReturn<any>
  emojiPickerOpen: boolean
  setEmojiPickerOpen: (open: boolean) => void
  fallback: string
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const avatar = form.watch('avatar')

  return (
    <FormField
      control={form.control}
      name="avatar"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('common.avatar')}</FormLabel>
          <EmojiAvatarPicker
            value={avatar}
            fallback={fallback}
            open={emojiPickerOpen}
            onOpenChange={setEmojiPickerOpen}
            onChange={field.onChange}
            ariaLabel={t('library.config.dialogs.create.avatar_aria')}
            portalContainer={portalContainer}
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
          <FormLabel>{label}</FormLabel>
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
  onModelChange
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
}) {
  const { t } = useTranslation()
  const value = form.watch(name)
  const selectorValue = value && isUniqueModelId(value) ? value : undefined
  const parsedModelId = selectorValue ? parseUniqueModelId(selectorValue) : undefined
  const { model: resolvedModel } = useModelById(selectorValue)
  const selectedModel = resolvedModel?.id === selectorValue ? resolvedModel : undefined
  const providerLabel = useProviderDisplayName(selectedModel?.providerId ?? parsedModelId?.providerId)
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
          <FormLabel>{label}</FormLabel>
          <DialogModelFrame>
            <div className="group/model-field relative flex w-full min-w-0 items-center">
              <ModelSelector
                multiple={false}
                selectionType="id"
                value={selectorValue}
                filter={filter}
                portalContainer={portalContainer}
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
                    providerLabel={selectorValue ? providerLabel || parsedModelId?.providerId : undefined}
                    className={cn(
                      'w-full hover:bg-background',
                      triggerModel ? 'hover:text-foreground' : 'hover:text-muted-foreground'
                    )}
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
          {name === 'modelId' && value && !modelLabels[name] ? (
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
  const content = (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="font-medium text-neutral-50 text-xs">{t('library.config.prompt.variables_title')}</div>
        <div className="text-neutral-300 text-xs leading-relaxed">
          {t('library.config.prompt.variables_description')}
        </div>
      </div>
      <div className="rounded-md border border-neutral-700/70 bg-neutral-800/70 px-2 py-1.5 text-neutral-200 text-xs">
        {t('library.config.prompt.variables_example', { variable: '{{date}}' })}
      </div>
      <div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-neutral-300 text-xs">
          {PROMPT_VARIABLES.map((variable) => (
            <div key={variable.name} className="contents">
              <span className="text-neutral-50">{variable.name}</span>
              <span className="font-sans">{t(variable.i18n)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <NormalTooltip
      content={content}
      delayDuration={300}
      align="start"
      sideOffset={4}
      contentProps={{
        portalContainer,
        className: 'w-80 p-3'
      }}>
      <HelpIconButton ariaLabel={t('library.config.prompt.variables_title')} />
    </NormalTooltip>
  )
}
