import { cn } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'
import { ChevronRight } from 'lucide-react'
import React, { memo, useCallback, useMemo, useState } from 'react'
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
  const [showAll, setShowAll] = useState(false)
  const groupLabel = getModelGroupLabel(groupName, t)
  const visibleItems = useMemo(() => (items.length > 80 && !showAll ? items.slice(0, 80) : items), [items, showAll])
  const hiddenItemCount = items.length - visibleItems.length

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
          {visibleItems.map(({ model }) => (
            <ModelListItem
              key={model.id}
              model={model}
              onEdit={onEditModel}
              onToggleEnabled={onToggleModel}
              disabled={disabled || pendingModelIds.has(model.id)}
            />
          ))}
          {hiddenItemCount > 0 && (
            <button type="button" className={modelListClasses.groupOverflowHint} onClick={() => setShowAll(true)}>
              {t('settings.models.manage.large_group_hidden', { count: hiddenItemCount })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default memo(ModelListGroup)
