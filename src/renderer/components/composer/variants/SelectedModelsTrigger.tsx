import { Button, Popover, PopoverAnchor, PopoverContent, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { getModelDisplayTags, type ModelDisplayTag, ModelTag } from '@renderer/components/Tags/Model'
import { getProviderDisplayName } from '@renderer/hooks/useProvider'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { RotateCcw, X } from 'lucide-react'
import {
  type ComponentPropsWithoutRef,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

interface SelectedModelsTriggerProps extends Omit<ComponentPropsWithoutRef<typeof Button>, 'children'> {
  models: Model[]
  assistantModel?: Model
  providers: Provider[]
  fallbackLabel: string
  iconOnly?: boolean
  suppressSelectionPopover?: boolean
  onModelsChange: (models: Model[]) => void
  onRestore: () => void
}

const MODEL_TAG_SIZE = 8

function getProviderName(model: Model, providers: Provider[]) {
  const provider = providers.find((currentProvider) => currentProvider.id === model.providerId)
  return getProviderDisplayName(provider) || model.providerId
}

function SelectedModelTags({ tags }: { tags: ModelDisplayTag[] }) {
  if (tags.length === 0) return null

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {tags.map((tag) => (
        <ModelTag
          key={tag}
          tag={tag}
          size={MODEL_TAG_SIZE}
          showTooltip={false}
          showLabel={false}
          className="h-3.5 min-w-3.5 justify-center px-1 py-px"
        />
      ))}
    </span>
  )
}

export const SelectedModelsTrigger = ({
  ref,
  models,
  assistantModel,
  providers,
  fallbackLabel,
  iconOnly = false,
  suppressSelectionPopover = false,
  onModelsChange,
  onRestore,
  className,
  'aria-label': ariaLabel,
  onClick,
  onFocus,
  onPointerEnter,
  onPointerLeave,
  ...buttonProps
}: SelectedModelsTriggerProps & { ref?: React.RefObject<HTMLButtonElement | null> }) => {
  const { t } = useTranslation()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  const singleModel = models.length === 1 ? models[0] : undefined
  const singleProviderName = singleModel ? getProviderName(singleModel, providers) : undefined
  const singleModelLabel = singleModel
    ? `${singleModel.name}${singleProviderName ? ` | ${singleProviderName}` : ''}`
    : fallbackLabel
  const selectedModelsLabel = t('models.selection.selected_models')
  const hasSelectionPopover = models.length > 1
  const canShowSelectionPopover = hasSelectionPopover && !suppressSelectionPopover
  const hasVisibleTriggerIcon = models.length > 0

  const modelProviderNames = useMemo(() => {
    return new Map(models.map((model) => [model.id, getProviderName(model, providers)]))
  }, [models, providers])

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const closeSelectionPopover = useCallback(() => {
    clearCloseTimer()
    setPopoverOpen(false)
  }, [clearCloseTimer])

  const openSelectionPopover = useCallback(() => {
    clearCloseTimer()
    if (canShowSelectionPopover) setPopoverOpen(true)
  }, [canShowSelectionPopover, clearCloseTimer])

  const scheduleSelectionPopoverClose = useCallback(() => {
    clearCloseTimer()
    if (!canShowSelectionPopover) return

    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setPopoverOpen(false)
    }, 100)
  }, [canShowSelectionPopover, clearCloseTimer])

  const handlePopoverOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        openSelectionPopover()
      } else {
        closeSelectionPopover()
      }
    },
    [closeSelectionPopover, openSelectionPopover]
  )

  useEffect(() => {
    if (!canShowSelectionPopover) closeSelectionPopover()
  }, [canShowSelectionPopover, closeSelectionPopover])

  useEffect(() => clearCloseTimer, [clearCloseTimer])

  const handleRemove = useCallback(
    (model: Model) => (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      onModelsChange(models.filter((currentModel) => currentModel.id !== model.id))
    },
    [models, onModelsChange]
  )

  const handleRestore = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      onRestore()
    },
    [onRestore]
  )

  const handleTriggerClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      closeSelectionPopover()
      onClick?.(event)
    },
    [closeSelectionPopover, onClick]
  )

  const handleTriggerFocus = useCallback(
    (event: FocusEvent<HTMLButtonElement>) => {
      onFocus?.(event)
      openSelectionPopover()
    },
    [onFocus, openSelectionPopover]
  )

  const handleTriggerPointerEnter = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      onPointerEnter?.(event)
      openSelectionPopover()
    },
    [onPointerEnter, openSelectionPopover]
  )

  const handleTriggerPointerLeave = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      onPointerLeave?.(event)
      scheduleSelectionPopoverClose()
    },
    [onPointerLeave, scheduleSelectionPopoverClose]
  )

  const content = (
    <div className="w-82 max-w-[calc(100vw-2rem)] text-popover-foreground" data-testid="selected-models-popover">
      <div className="px-3 pt-2 pb-1 font-medium text-[11px] text-muted-foreground/80">{selectedModelsLabel}</div>
      {models.length > 0 ? (
        <Scrollbar className="max-h-64 overflow-x-hidden" data-testid="selected-models-list">
          {models.map((model) => {
            const providerName = modelProviderNames.get(model.id) ?? model.providerId
            const tags = getModelDisplayTags(model)
            const hasTags = tags.length > 0
            const hasRightMeta = model.contextWindow != null

            return (
              <div
                key={model.id}
                className="group mx-1.5 grid h-10.5 grid-cols-[18px_minmax(0,1fr)_auto_auto] items-start gap-x-2 rounded-md px-2 py-[5px] transition-colors hover:bg-accent/45"
                data-testid={`selected-model-row-${model.id}`}>
                <div className="flex h-8 w-4.5 shrink-0 items-center justify-center">
                  <ModelAvatar model={model} size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex h-4 min-w-0 items-center">
                    <span className="truncate font-medium text-[12px] leading-4">{model.name}</span>
                  </div>
                  <div
                    className={cn(
                      'mt-0.5 flex h-3.5 min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/70 leading-3.5',
                      !hasTags && 'invisible'
                    )}>
                    {hasTags ? <SelectedModelTags tags={tags} /> : null}
                  </div>
                </div>
                <div className="grid max-w-24 shrink-0 justify-items-end">
                  <span className="h-4 max-w-24 truncate text-[11px] text-muted-foreground/70 leading-4">
                    {providerName}
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 h-3.5 max-w-24 truncate text-[11px] text-muted-foreground/55 leading-3.5',
                      !hasRightMeta && 'invisible'
                    )}>
                    {hasRightMeta ? t('models.selection.context_window', { count: model.contextWindow }) : null}
                  </span>
                </div>
                <div className="flex h-8 w-0 items-center justify-center overflow-hidden opacity-0 transition-[width,opacity] focus-within:w-4 focus-within:opacity-100 group-hover:w-4 group-hover:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('models.selection.remove_model', { name: model.name })}
                    className="size-4 min-h-4 shrink-0 rounded p-0 text-muted-foreground/40 shadow-none transition-colors hover:bg-accent hover:text-foreground focus-visible:opacity-100 [&_svg]:size-3"
                    onClick={handleRemove(model)}>
                    <X />
                  </Button>
                </div>
              </div>
            )
          })}
        </Scrollbar>
      ) : null}
      <div className="mt-1 border-border border-t px-1.5 pt-1 pb-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start gap-2 px-2 text-xs shadow-none"
          onClick={handleRestore}>
          <RotateCcw className="size-3.5" />
          <span>{t('models.selection.restore_default')}</span>
          {assistantModel ? (
            <span className="ml-auto truncate text-muted-foreground">{assistantModel.name}</span>
          ) : null}
        </Button>
      </div>
    </div>
  )

  return (
    <Popover open={canShowSelectionPopover ? popoverOpen : false} onOpenChange={handlePopoverOpenChange}>
      <PopoverAnchor asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="sm"
          className={cn(className, 'min-w-0', iconOnly && hasVisibleTriggerIcon && 'w-8 justify-center px-0')}
          aria-label={ariaLabel ?? selectedModelsLabel}
          {...buttonProps}
          onClick={handleTriggerClick}
          onFocus={handleTriggerFocus}
          onPointerEnter={handleTriggerPointerEnter}
          onPointerLeave={handleTriggerPointerLeave}>
          {models.length > 1 ? (
            <span className="flex shrink-0 items-center gap-1" data-testid="selected-models-trigger-icons">
              {models.map((model) => (
                <span key={model.id} className="shrink-0">
                  <ModelAvatar model={model} size={20} />
                </span>
              ))}
            </span>
          ) : (
            <>
              {singleModel ? <ModelAvatar model={singleModel} size={20} /> : null}
              <span className={cn('max-w-52 truncate', iconOnly && singleModel && 'sr-only')}>{singleModelLabel}</span>
            </>
          )}
        </Button>
      </PopoverAnchor>
      {canShowSelectionPopover ? (
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={6}
          className="w-auto max-w-none overflow-hidden rounded-lg border-border bg-popover p-0 text-popover-foreground shadow-lg"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onPointerEnter={clearCloseTimer}
          onPointerLeave={closeSelectionPopover}>
          {content}
        </PopoverContent>
      ) : null}
    </Popover>
  )
}

SelectedModelsTrigger.displayName = 'SelectedModelsTrigger'
