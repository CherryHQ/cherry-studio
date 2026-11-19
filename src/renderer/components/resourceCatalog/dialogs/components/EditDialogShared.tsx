import { Database, HelpCircle, X } from 'lucide-react'
import { type ComponentProps, type ReactNode, useCallback, useEffect, useRef } from 'react'
import { type FieldValues, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  Button,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  NormalTooltip,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { CherryCloudModelSelector as ModelSelector } from '@renderer/components/cherryCloud/CherryCloudModelSelector'
import { type ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { useModelById } from '@renderer/hooks/useModel'
import { toast } from '@renderer/services/toast'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { CoalescingTask } from '@shared/utils/async'

import { DialogModelFrame, DialogModelTrigger } from './DialogFormFields'

// Vertical submenu / nav item preset — kept in sync with the settings sidebar's
// settingsSubmenuItemClassName so the create wizard's rail and settings nav read identically.
const submenuItemClassName =
  'h-8 rounded-[10px] border-transparent px-2.5 font-normal text-muted-foreground text-sm hover:!bg-foreground/[0.04] hover:!text-foreground focus-visible:!border-transparent focus-visible:!ring-1 focus-visible:!ring-foreground/20 focus-visible:!ring-offset-0 data-[active=true]:!border-transparent data-[active=true]:!bg-foreground/[0.08] data-[active=true]:!font-medium data-[active=true]:!text-foreground [&_svg]:size-4 [&_svg]:text-current'

// Neutralize TabsTrigger's default-variant layout leak (justify-center + flex-1) when a
// MenuItem is rendered as a vertical tab via `asChild`, keeping rail items left-aligned at h-8.
export const resourceDialogRailItemClassName = cn(
  submenuItemClassName,
  'data-[state=active]:!shadow-none flex-none justify-start'
)

const logger = loggerService.withContext('EditDialogShared')

export const editDialogFormRowClassName =
  'grid min-w-0 grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1 py-2.5'
export const editDialogFormRowLabelClassName = 'justify-self-end font-normal text-muted-foreground text-[13px]'
export const resourceDialogCloseButtonClassName =
  '[&_[data-slot=dialog-close]]:top-[9px] [&_[data-slot=dialog-close]]:right-3 [&_[data-slot=dialog-close]]:flex [&_[data-slot=dialog-close]]:size-[30px] [&_[data-slot=dialog-close]]:items-center [&_[data-slot=dialog-close]]:justify-center [&_[data-slot=dialog-close]]:rounded-lg [&_[data-slot=dialog-close]]:hover:bg-foreground/[0.08] [&_[data-slot=dialog-close]]:focus-visible:bg-foreground/[0.08] [&_[data-slot=dialog-close]]:focus-visible:ring-1 [&_[data-slot=dialog-close]]:focus-visible:ring-foreground/20 [&_[data-slot=dialog-close]]:focus-visible:ring-offset-0'
export const resourceDialogHeaderClassName =
  'flex shrink-0 items-center gap-3 border-border-subtle border-b px-6 py-3.5 pr-12'
export const resourceDialogTitleClassName = 'truncate text-sm'

export type ModelLabelKey = 'modelId' | 'planModelId' | 'smallModelId' | 'contextCompressModelId'
export type ModelLabels = Record<ModelLabelKey, string | null>

export type EditDialogBaseProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelFilter?: ModelSelectorFilter
  isModelDisabled?: ModelSelectorFilter
  /** Deep-link ID (e.g. `tools.mcp`, `channels`) naming the page to open; unknown IDs open the main page. */
  initialTab?: string
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
 * Returns `flush()` to save immediately and `getPendingSave()` to await the
 * current drain before checking whether the form still needs to be saved.
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
}): { flush: () => Promise<void>; getPendingSave: () => Promise<void> | undefined } {
  const onSaveRef = useRef(onSave)
  const changeKeyRef = useRef(changeKey)
  const saveTaskRef = useRef(new CoalescingTask())
  // `changeKey` captured when the in-flight save started; a follow-up pass is
  // only queued when the state has moved past it.
  const savedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    onSaveRef.current = onSave
    changeKeyRef.current = changeKey
  })

  const flush = useCallback((): Promise<void> => {
    const task = saveTaskRef.current
    if (task.promise && changeKeyRef.current === savedKeyRef.current) return task.promise
    return task.run(() => {
      savedKeyRef.current = changeKeyRef.current
      return onSaveRef.current()
    })
  }, [])

  useEffect(() => {
    if (!enabled || changeKey === null) return
    const handle = setTimeout(() => void flush(), delay)
    return () => clearTimeout(handle)
  }, [enabled, changeKey, delay, flush])

  const getPendingSave = useCallback(() => saveTaskRef.current.promise, [])

  return { flush, getPendingSave }
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
        'flex size-4 min-h-0 shrink-0 items-center justify-center rounded-full border border-border-subtle p-0 text-muted-foreground shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0',
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
  labelClassName,
  formLabel = true
}: {
  label: string
  help?: ReactNode
  helpTrigger?: ReactNode
  className?: string
  labelClassName?: string
  formLabel?: boolean
}) {
  const { t } = useTranslation()
  const labelContent = formLabel ? (
    <FormLabel className={cn('font-normal', labelClassName)}>{label}</FormLabel>
  ) : (
    <span className={cn('font-normal text-foreground text-sm leading-none', labelClassName)}>{label}</span>
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

export function TextInputField({
  form,
  name,
  label,
  labelClassName,
  description,
  placeholder,
  required = false,
  layout = 'stacked',
  rows = 2,
  textareaClassName
}: {
  form: UseFormReturn<any>
  name: 'name' | 'description'
  label: string
  labelClassName?: string
  description?: string
  placeholder?: string
  required?: boolean
  layout?: 'stacked' | 'row'
  rows?: number
  textareaClassName?: string
}) {
  const { t } = useTranslation()

  return (
    <FormField
      control={form.control}
      name={name}
      rules={required ? { validate: (value) => value.trim().length > 0 || t('common.required_field') } : undefined}
      render={({ field }) => (
        <FormItem className={layout === 'row' ? editDialogFormRowClassName : undefined}>
          <FormLabel
            className={cn(
              layout === 'row' ? editDialogFormRowLabelClassName : 'font-normal',
              layout === 'row' && name === 'description' && 'self-start pt-3',
              labelClassName
            )}>
            {label}
          </FormLabel>
          <FormControl>
            {name === 'description' ? (
              <Textarea.Input
                value={field.value}
                rows={rows}
                placeholder={placeholder}
                onValueChange={field.onChange}
                className={cn('min-h-16', textareaClassName)}
              />
            ) : (
              <Input {...field} placeholder={placeholder} />
            )}
          </FormControl>
          {description ? (
            <FormDescription className={cn('text-xs', layout === 'row' && 'col-start-2')}>
              {description}
            </FormDescription>
          ) : null}
          <FormMessage className={layout === 'row' ? 'col-start-2' : undefined} />
        </FormItem>
      )}
    />
  )
}

export function CompactModelField({
  form,
  name,
  label,
  labelClassName,
  description,
  help,
  allowClear = false,
  emptyLabel,
  filter,
  isModelDisabled,
  includeAgentOnlyModels = false,
  portalContainer,
  modelLabels,
  setModelLabels,
  onModelChange,
  onSettingsNavigate,
  layout = 'stacked',
  triggerClassName
}: {
  form: UseFormReturn<any>
  name: ModelLabelKey
  label: string
  labelClassName?: string
  description?: string
  /** Shown in a help tooltip beside the label. `description` stays inline below the field. */
  help?: ReactNode
  allowClear?: boolean
  /** Trigger text when no model is picked (defaults to the generic "pick a model"). */
  emptyLabel?: string
  filter?: ModelSelectorFilter
  isModelDisabled?: ModelSelectorFilter
  includeAgentOnlyModels?: boolean
  portalContainer: HTMLElement | null
  modelLabels: ModelLabels
  setModelLabels: (labels: ModelLabels) => void
  onModelChange?: (modelId: UniqueModelId | null, model?: Model) => void
  onSettingsNavigate?: (navigate: () => void) => void
  /** `chip`: the trigger alone, with the label kept for screen readers. */
  layout?: 'stacked' | 'row' | 'chip'
  triggerClassName?: string
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
    emptyLabel ??
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
        <FormItem className={layout === 'row' ? editDialogFormRowClassName : undefined}>
          {help ? (
            <FieldLabelWithHelp
              label={label}
              help={help}
              // In row layout FormItem is a grid, so `justify-self-end` has to sit on the wrapper
              // div that FieldLabelWithHelp renders around the label.
              className={layout === 'row' ? 'justify-self-end' : undefined}
              labelClassName={cn(
                layout === 'row' ? 'font-normal text-muted-foreground text-[13px]' : 'font-normal',
                labelClassName
              )}
            />
          ) : (
            <FormLabel
              className={cn(
                layout === 'row' ? editDialogFormRowLabelClassName : 'font-normal',
                layout === 'chip' && 'sr-only',
                labelClassName
              )}>
              {label}
            </FormLabel>
          )}
          <DialogModelFrame>
            <div className="group/model-field relative flex w-full min-w-0 items-center">
              <ModelSelector
                multiple={false}
                includeAgentOnlyModels={includeAgentOnlyModels}
                selectionType="id"
                value={selectorValue}
                filter={filter}
                isModelDisabled={isModelDisabled}
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
                    className={cn(
                      'w-full',
                      triggerModel ? 'hover:text-foreground' : 'hover:text-muted-foreground',
                      triggerClassName
                    )}
                    chevronClassName={
                      allowClear && value
                        ? 'group-hover/model-field:opacity-0 group-focus-within/model-field:opacity-0 no-hover:opacity-0'
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
                  className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-1.5 flex size-5 min-h-0 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-muted-foreground opacity-0 shadow-none transition-[background-color,color,opacity] hover:bg-muted hover:text-foreground focus-visible:pointer-events-auto focus-visible:bg-muted focus-visible:text-foreground focus-visible:opacity-100 active:bg-muted group-focus-within/model-field:pointer-events-auto group-focus-within/model-field:opacity-100 group-hover/model-field:pointer-events-auto group-hover/model-field:opacity-100 no-hover:pointer-events-auto no-hover:opacity-100">
                  <X size={12} />
                </Button>
              ) : null}
            </div>
          </DialogModelFrame>
          {description ? (
            <FormDescription className={cn('text-xs', layout === 'row' && 'col-start-2')}>
              {description}
            </FormDescription>
          ) : null}
          {name === 'modelId' && value && !modelLabels[name] && !selectedModel ? (
            <FormDescription className={cn('text-xs', layout === 'row' && 'col-start-2')}>
              {t('library.config.basic.model_not_found', { id: value })}
            </FormDescription>
          ) : null}
          <FormMessage className={layout === 'row' ? 'col-start-2' : undefined} />
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
            <div className="text-muted-foreground text-xs leading-relaxed">
              {t('library.config.prompt.variables_description')}
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/50 px-2 py-1.5 text-muted-foreground text-xs">
            {t('library.config.prompt.variables_example', { variable: '{{date}}' })}
          </div>
          <div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-muted-foreground text-xs">
              {PROMPT_VARIABLES.map((variable) => (
                <div key={variable.name} className="contents">
                  <button
                    type="button"
                    className="rounded px-1 text-left text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
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
