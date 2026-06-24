import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { cn } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, Trash2 } from 'lucide-react'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import { getModelOperationErrorMessage } from './errorMessage'
import { getModelGroupLabel } from './grouping'
import ModelListItem from './ModelListItem'
import type { ModelListGroupItem } from './useProviderModelList'

const logger = loggerService.withContext('ModelListGroup')

interface ModelListGroupProps {
  groupName: string
  items: ModelListGroupItem[]
  defaultOpen: boolean
  disabled?: boolean
  bulkActionDisabled?: boolean
  bulkToggleEnabled?: boolean
  bulkToggleLabel?: string
  pendingModelIds: Set<string>
  onEditModel: (model: Model) => void
  onDeleteModel: (model: Model) => Promise<void>
  onDeleteModels: (models: Model[]) => Promise<void>
  onToggleModel: (model: Model, enabled: boolean) => Promise<void>
  onToggleModels?: (models: Model[], enabled: boolean) => Promise<void>
  expansionCommand?: { expanded: boolean; version: number }
}

const ModelListGroup: React.FC<ModelListGroupProps> = ({
  groupName,
  items,
  defaultOpen,
  disabled,
  bulkActionDisabled,
  bulkToggleEnabled,
  bulkToggleLabel,
  pendingModelIds,
  onEditModel,
  onDeleteModel,
  onDeleteModels,
  onToggleModel,
  onToggleModels,
  expansionCommand
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const groupLabel = getModelGroupLabel(groupName, t)
  const groupModels = useMemo(() => items.map(({ model }) => model), [items])
  const shouldVirtualize = items.length > 80
  const previewItems = useMemo(() => items.slice(0, 80), [items])
  const hasPendingModel = groupModels.some((model) => pendingModelIds.has(model.id))
  const canToggleGroupModels =
    typeof bulkToggleEnabled === 'boolean' && bulkToggleLabel !== undefined && onToggleModels !== undefined
  const groupSwitchChecked = bulkToggleEnabled === false
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => 48,
    overscan: 12,
    enabled: open && shouldVirtualize
  })

  const toggleOpen = useCallback(() => {
    setOpen((prev) => !prev)
  }, [])

  useEffect(() => {
    if (!expansionCommand) {
      return
    }
    setOpen(expansionCommand.expanded)
  }, [expansionCommand])

  const handleToggleGroupModels = useCallback(
    (enabled: boolean) => {
      if (!canToggleGroupModels || onToggleModels === undefined) {
        return
      }

      void onToggleModels(groupModels, enabled).catch((error) => {
        logger.error('Failed to toggle provider model group', { groupName, enabled, error })
        window.toast.error(t('settings.models.manage.operation_failed'))
      })
    },
    [canToggleGroupModels, groupModels, groupName, onToggleModels, t]
  )

  const handleDeleteGroupModels = useCallback(() => {
    void onDeleteModels(groupModels).catch((error) => {
      logger.error('Failed to delete provider model group', { groupName, error })
      window.toast.error(
        getModelOperationErrorMessage(error, {
          fallback: t('settings.models.manage.operation_failed'),
          modelInUseByKnowledgeBase: t('settings.models.manage.model_in_use_by_knowledge_base')
        })
      )
    })
  }, [groupModels, groupName, onDeleteModels, t])

  return (
    <div className={modelListClasses.groupCard}>
      <div className={modelListClasses.groupHeader}>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            className={modelListClasses.groupToggleButton}
            aria-expanded={open}
            onClick={toggleOpen}>
            <ChevronRight
              className={cn(modelListClasses.groupChevron, open && modelListClasses.groupChevronOpen)}
              aria-hidden
            />
            <span className={modelListClasses.groupTitle}>{groupLabel}</span>
          </button>
          <Tooltip
            content={t('settings.models.manage.remove_whole_group')}
            placement="top"
            classNames={{ placeholder: modelListClasses.groupHeaderIconTooltipTrigger }}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('settings.models.manage.remove_whole_group')}
              disabled={disabled || bulkActionDisabled || hasPendingModel || groupModels.length === 0}
              className="inline-flex size-5 min-h-0 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground/45 opacity-0 shadow-none transition-opacity hover:bg-accent/50 hover:text-destructive focus-visible:opacity-100 group-focus-within/groupRow:opacity-100 group-hover/groupRow:opacity-100"
              onClick={handleDeleteGroupModels}>
              <Trash2 className="size-3" />
            </Button>
          </Tooltip>
        </div>
        <div className={modelListClasses.groupHeaderActions}>
          {canToggleGroupModels ? (
            <Tooltip content={bulkToggleLabel} classNames={{ placeholder: modelListClasses.groupSwitchTooltipTrigger }}>
              <Switch
                checked={groupSwitchChecked}
                aria-label={bulkToggleLabel}
                size="xs"
                disabled={disabled || bulkActionDisabled || hasPendingModel}
                onClick={(event) => event.stopPropagation()}
                onCheckedChange={handleToggleGroupModels}
              />
            </Tooltip>
          ) : null}
        </div>
      </div>
      {open && (
        <div className={modelListClasses.groupBody}>
          {shouldVirtualize ? (
            <div ref={scrollerRef} className="overflow-y-auto" style={{ maxHeight: 520 }}>
              <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const entry = items[virtualItem.index]
                  if (!entry) {
                    return null
                  }

                  const { model } = entry
                  return (
                    <div
                      key={model.id}
                      ref={(element) => {
                        if (element) {
                          virtualizer.measureElement(element)
                        }
                      }}
                      className="absolute top-0 left-0 w-full"
                      style={{ transform: `translateY(${virtualItem.start}px)` }}>
                      <ModelListItem
                        model={model}
                        onEdit={onEditModel}
                        onDelete={onDeleteModel}
                        onToggleEnabled={onToggleModel}
                        disabled={disabled || pendingModelIds.has(model.id)}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            previewItems.map(({ model }) => (
              <ModelListItem
                key={model.id}
                model={model}
                onEdit={onEditModel}
                onDelete={onDeleteModel}
                onToggleEnabled={onToggleModel}
                disabled={disabled || pendingModelIds.has(model.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default memo(ModelListGroup)
