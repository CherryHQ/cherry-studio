import { cn } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
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
  pendingModelIds: Set<string>
  onEditModel: (model: Model) => void
  onToggleModel: (model: Model, enabled: boolean) => Promise<void>
}

const ModelListGroup: React.FC<ModelListGroupProps> = ({
  groupName,
  items,
  defaultOpen,
  disabled,
  pendingModelIds,
  onEditModel,
  onToggleModel
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const groupLabel = getModelGroupLabel(groupName, t)
  const shouldVirtualize = items.length > 80
  const previewItems = useMemo(() => items.slice(0, 80), [items])
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

  return (
    <div className={modelListClasses.groupCard}>
      <button type="button" className={modelListClasses.groupHeader} aria-expanded={open} onClick={toggleOpen}>
        <span className={modelListClasses.groupTitle}>{groupLabel}</span>
        <ChevronRight className={cn(modelListClasses.groupChevron, open && modelListClasses.groupChevronOpen)} />
      </button>
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
