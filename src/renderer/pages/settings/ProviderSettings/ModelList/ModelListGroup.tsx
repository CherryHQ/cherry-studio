import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import type { Model } from '@shared/data/types/model'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, Minus } from 'lucide-react'
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
  pendingModelIds: Set<string>
  onEditModel: (model: Model) => void
  onDeleteModel: (model: Model) => Promise<void>
  onDeleteModels: (models: Model[]) => Promise<void>
  expansionCommand?: { expanded: boolean; version: number }
}

const ModelListGroup: React.FC<ModelListGroupProps> = ({
  groupName,
  items,
  defaultOpen,
  disabled,
  bulkActionDisabled,
  pendingModelIds,
  onEditModel,
  onDeleteModel,
  onDeleteModels,
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

  const handleGroupHeaderKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return
      }

      event.preventDefault()
      toggleOpen()
    },
    [toggleOpen]
  )

  const handleDeleteGroupModels = useCallback(
    (event?: React.MouseEvent<HTMLButtonElement>) => {
      event?.stopPropagation()
      void onDeleteModels(groupModels).catch((error) => {
        logger.error('Failed to delete provider model group', { groupName, error })
        toast.error(
          getModelOperationErrorMessage(error, {
            fallback: t('settings.models.manage.operation_failed'),
            modelInUseByKnowledgeBase: t('settings.models.manage.model_in_use_by_knowledge_base'),
            modelInUseAsDefault: t('settings.models.manage.sync_apply_default_in_use')
          })
        )
      })
    },
    [groupModels, groupName, onDeleteModels, t]
  )

  return (
    <div className={modelListClasses.groupCard}>
      <div
        className={cn(modelListClasses.groupHeader, open && modelListClasses.groupHeaderOpen, 'cursor-pointer')}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggleOpen}
        onKeyDown={handleGroupHeaderKeyDown}>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className={modelListClasses.groupToggleButton}>
            <ChevronRight
              className={cn(modelListClasses.groupChevron, open && modelListClasses.groupChevronOpen)}
              aria-hidden
            />
            <span className={modelListClasses.groupTitle}>{groupLabel}</span>
          </div>
        </div>
        <div className={modelListClasses.groupHeaderActions}>
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
              className={`${modelListClasses.rowActionButton} ${modelListClasses.rowDangerActionButton} opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/modelGroup:opacity-100 group-hover/modelGroup:opacity-100`}
              onClick={handleDeleteGroupModels}>
              <Minus className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div
        className={cn(
          modelListClasses.groupBody,
          open ? modelListClasses.groupBodyOpen : modelListClasses.groupBodyClosed
        )}>
        <div className={modelListClasses.groupBodyInner}>
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
                        disabled={disabled || pendingModelIds.has(model.id)}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className={modelListClasses.groupBodyList}>
              {previewItems.map(({ model }) => (
                <ModelListItem
                  key={model.id}
                  model={model}
                  onEdit={onEditModel}
                  onDelete={onDeleteModel}
                  disabled={disabled || pendingModelIds.has(model.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(ModelListGroup)
