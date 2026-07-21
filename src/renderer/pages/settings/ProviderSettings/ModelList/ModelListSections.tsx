import { EmptyState } from '@cherrystudio/ui'
import LoadingIcon from '@renderer/components/icons/LoadingIcon'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { cn } from '@renderer/utils/style'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { Box } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import ModelListGroup from './ModelListGroup'
import ModelListItem from './ModelListItem'
import type { ModelListGroupSection } from './useProviderModelList'

interface ModelListSectionsProps {
  isLoading: boolean
  hasNoModels: boolean
  hasVisibleModels: boolean
  enabledSections: ModelListGroupSection[]
  disabled: boolean
  pendingModelIds: Set<string>
  defaultModelIds: Set<UniqueModelId>
  onEditModel: (model: Model) => void
  onDeleteModel: (model: Model) => Promise<void>
  onDeleteModels: (models: Model[]) => Promise<void>
  bulkActionDisabled?: boolean
  expansionCommand?: { expanded: boolean; version: number }
}

type ModelListVirtualRow =
  | {
      type: 'group'
      key: string
      groupName: string
      items: ModelListGroupSection['items']
      defaultOpen: boolean
      open: boolean
    }
  | {
      type: 'model'
      key: string
      model: Model
      isLastInGroup: boolean
    }

const ModelListSections: React.FC<ModelListSectionsProps> = ({
  isLoading,
  hasNoModels,
  hasVisibleModels,
  enabledSections,
  disabled,
  pendingModelIds,
  defaultModelIds,
  onEditModel,
  onDeleteModel,
  onDeleteModels,
  bulkActionDisabled,
  expansionCommand
}) => {
  const { t } = useTranslation()
  const [groupOpenOverrides, setGroupOpenOverrides] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!expansionCommand) {
      return
    }

    setGroupOpenOverrides(
      Object.fromEntries(enabledSections.map(({ groupName }) => [groupName, expansionCommand.expanded]))
    )
  }, [enabledSections, expansionCommand])

  const toggleGroupOpen = useCallback((groupName: string, defaultOpen: boolean) => {
    setGroupOpenOverrides((current) => ({
      ...current,
      [groupName]: !(current[groupName] ?? defaultOpen)
    }))
  }, [])

  const virtualRows = useMemo<ModelListVirtualRow[]>(() => {
    return enabledSections.flatMap(({ groupName, items }, index) => {
      const defaultOpen = index <= 5
      const open = groupOpenOverrides[groupName] ?? defaultOpen
      const groupRow: ModelListVirtualRow = {
        type: 'group',
        key: `group:${groupName}`,
        groupName,
        items,
        defaultOpen,
        open
      }

      if (!open) {
        return [groupRow]
      }

      return [
        groupRow,
        ...items.map(
          ({ model }, modelIndex): ModelListVirtualRow => ({
            type: 'model',
            key: `model:${model.id}`,
            model,
            isLastInGroup: modelIndex === items.length - 1
          })
        )
      ]
    })
  }, [enabledSections, groupOpenOverrides])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <LoadingIcon color="var(--muted-foreground)" />
      </div>
    )
  }

  if (hasNoModels) {
    return (
      <EmptyState
        compact
        icon={Box}
        title={t('settings.models.empty')}
        description={t('settings.models.empty_hint')}
        className="min-h-40"
      />
    )
  }

  if (!hasVisibleModels) {
    return <div className={modelListClasses.emptyState}>{t('common.no_results')}</div>
  }

  return (
    <DynamicVirtualList
      list={virtualRows}
      className={modelListClasses.listScroller}
      role="list"
      estimateSize={(index) => (virtualRows[index]?.type === 'group' ? 48 : 44)}
      overscan={10}
      isSticky={(index) => virtualRows[index]?.type === 'group'}
      getItemKey={(index) => virtualRows[index]?.key ?? index}>
      {(row) => {
        if (row.type === 'group') {
          return (
            <div
              className={cn(modelListClasses.virtualGroupRow, !row.open && modelListClasses.virtualGroupRowCollapsed)}>
              <ModelListGroup
                groupName={row.groupName}
                items={row.items}
                defaultOpen={row.defaultOpen}
                open={row.open}
                disabled={disabled}
                bulkActionDisabled={bulkActionDisabled}
                pendingModelIds={pendingModelIds}
                defaultModelIds={defaultModelIds}
                onDeleteModels={onDeleteModels}
                onToggleOpen={() => toggleGroupOpen(row.groupName, row.defaultOpen)}
              />
            </div>
          )
        }

        return (
          <div
            className={cn(modelListClasses.virtualModelRow, row.isLastInGroup && modelListClasses.virtualModelRowLast)}>
            <ModelListItem
              model={row.model}
              onEdit={onEditModel}
              onDelete={onDeleteModel}
              disabled={disabled || pendingModelIds.has(row.model.id)}
              isDefaultModel={defaultModelIds.has(row.model.id)}
            />
          </div>
        )
      }}
    </DynamicVirtualList>
  )
}

export default ModelListSections
