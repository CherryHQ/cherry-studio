import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, ToggleLeft, ToggleRight } from 'lucide-react'
import React, { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import { getModelGroupLabel } from './grouping'
import ModelListItem from './ModelListItem'
import type { ModelListGroupItem } from './useProviderModelList'

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
  onToggleModel: (model: Model, enabled: boolean) => Promise<void>
  onToggleModels?: (models: Model[], enabled: boolean) => Promise<void>
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
  onToggleModel,
  onToggleModels
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
  const BulkToggleIcon = bulkToggleEnabled ? ToggleRight : ToggleLeft
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

  const handleToggleGroupModels = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()

      if (!canToggleGroupModels || bulkToggleEnabled === undefined || onToggleModels === undefined) {
        return
      }

      void onToggleModels(groupModels, bulkToggleEnabled).catch(() => {
        window.toast.error(t('settings.models.manage.operation_failed'))
      })
    },
    [bulkToggleEnabled, canToggleGroupModels, groupModels, onToggleModels, t]
  )

  return (
    <div className={modelListClasses.groupCard}>
      <div className={modelListClasses.groupHeader}>
        <button type="button" className={modelListClasses.groupToggleButton} aria-expanded={open} onClick={toggleOpen}>
          <span className={modelListClasses.groupTitle}>{groupLabel}</span>
        </button>
        <div className={modelListClasses.groupHeaderActions}>
          {canToggleGroupModels ? (
            <Tooltip content={bulkToggleLabel} classNames={{ placeholder: modelListClasses.subsectionTooltipTrigger }}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={bulkToggleLabel}
                className={modelListClasses.subsectionIconButton}
                disabled={disabled || bulkActionDisabled || hasPendingModel}
                onClick={handleToggleGroupModels}>
                <BulkToggleIcon className={modelListClasses.subsectionIcon} />
              </Button>
            </Tooltip>
          ) : null}
          <button
            type="button"
            className={modelListClasses.groupChevronButton}
            aria-expanded={open}
            aria-label={t(open ? 'common.collapse' : 'common.expand')}
            onClick={toggleOpen}>
            <ChevronRight className={cn(modelListClasses.groupChevron, open && modelListClasses.groupChevronOpen)} />
          </button>
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
