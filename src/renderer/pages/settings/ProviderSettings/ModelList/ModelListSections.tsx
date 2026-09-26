import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@cherrystudio/ui'
import LoadingIcon from '@renderer/components/icons/LoadingIcon'
import {
  type GroupedSortableVirtualListDragCapabilities,
  type GroupedSortableVirtualListDragPayload,
  GroupedSortableVirtualList,
  type GroupedVirtualListGroup
} from '@renderer/components/VirtualList'
import { cn } from '@renderer/utils/style'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import { useModelHealthStatus } from './modelHealthStatusCache'
import ModelListGroup from './ModelListGroup'
import { useModelListHealthRun } from './modelListHealthContext'
import ModelListItem from './ModelListItem'
import type { ModelListGroupSection } from './useProviderModelList'

const MODEL_LIST_GROUP_ROW_ESTIMATE = 38
const MODEL_LIST_MODEL_ROW_ESTIMATE = 44
// A stable row keeps group spacing from moving between measured rows when a group collapses.
const MODEL_LIST_GROUP_SEPARATOR_HEIGHT = 10

type HealthAwareModelListItemProps = Omit<React.ComponentProps<typeof ModelListItem>, 'modelStatus'>

const HealthAwareModelListItem: React.FC<HealthAwareModelListItemProps> = (props) => {
  const modelStatus = useModelHealthStatus(props.model.id)
  return <ModelListItem {...props} modelStatus={modelStatus} />
}

interface ModelListSectionsProps {
  scrollElement?: HTMLDivElement | null
  provider?: Provider
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
  onContinueApiSetup?: () => void
  /** Persist a same-group model move. Omitted when the list is not reorderable. */
  onReorderModel?: (uniqueModelId: UniqueModelId, anchor: OrderRequest) => void
  /**
   * The provider's full model list in persisted order. Group reordering needs
   * it to move every member of a group, including rows a filter is hiding.
   */
  orderedModels?: readonly Model[]
  /** Persist a whole-group move. Omitted when the list is not reorderable. */
  onReorderGroups?: (activeGroupName: string, overGroupName: string) => void
}

/**
 * Reordering is scoped to one provider, and the visible grouping is derived
 * from each model's own `group` string rather than from a persisted group
 * entity. Moving a model across groups would rewrite the flat order and the
 * grouped view would immediately re-sort the row back into its original
 * group, so cross-group drops stay disabled instead of silently doing nothing.
 *
 * Group headers are draggable because group order is derived from model order:
 * a group move is a block move of its members.
 */
const MODEL_LIST_DRAG_CAPABILITIES: GroupedSortableVirtualListDragCapabilities = {
  groups: true,
  items: true,
  itemSameGroup: true,
  itemCrossGroup: false
}

type ModelListGroupData = {
  groupName: string
  items: ModelListGroupSection['items']
  defaultOpen: boolean
  open: boolean
}

const ModelListSections: React.FC<ModelListSectionsProps> = ({
  scrollElement,
  provider,
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
  expansionCommand,
  onContinueApiSetup,
  onReorderModel,
  orderedModels,
  onReorderGroups
}) => {
  const { t } = useTranslation()
  const { apiKeyEntries, savingKeyId, toggleApiKey } = useModelListHealthRun()
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

  const groups = useMemo<GroupedVirtualListGroup<ModelListGroupData, Model, true, true>[]>(() => {
    return enabledSections.map(({ groupName, items }, index) => {
      const defaultOpen = index <= 5
      const open = groupOpenOverrides[groupName] ?? defaultOpen

      return {
        group: { groupName, items, defaultOpen, open },
        header: true,
        // A collapsed group contributes no item rows, but keeps its items on
        // the group data so the header can still render group-level actions.
        items: open ? items.map((item) => item.model) : [],
        footer: true
      }
    })
  }, [enabledSections, groupOpenOverrides])

  const handleDragEnd = useCallback(
    (payload: GroupedSortableVirtualListDragPayload<ModelListGroupData, Model>) => {
      if (payload.type === 'group') {
        if (!onReorderGroups || !orderedModels) return
        onReorderGroups(payload.activeGroup.groupName, payload.overGroup.groupName)
        return
      }

      if (!onReorderModel) return
      // Redundant with `itemCrossGroup: false`, but a stray cross-group write
      // would persist an order the grouped view immediately contradicts.
      if (payload.sourceGroupId !== payload.targetGroupId) return
      if (payload.overType !== 'item') return

      const anchor: OrderRequest =
        payload.position === 'before' ? { before: String(payload.overId) } : { after: String(payload.overId) }

      onReorderModel(payload.activeId as UniqueModelId, anchor)
    },
    [onReorderModel, onReorderGroups, orderedModels]
  )

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
        title={t('settings.models.empty')}
        description={t(
          onContinueApiSetup ? 'settings.provider.api_setup.models_empty_hint' : 'settings.models.empty_hint'
        )}
        actionLabel={onContinueApiSetup ? t('settings.provider.api_setup.continue_models') : undefined}
        onAction={onContinueApiSetup}
        className="min-h-40"
      />
    )
  }

  if (!hasVisibleModels) {
    return <div className={modelListClasses.emptyState}>{t('common.no_results')}</div>
  }

  return (
    <GroupedSortableVirtualList<ModelListGroupData, Model, true, true>
      groups={groups}
      getGroupId={(group) => group.groupName}
      getItemId={(model) => model.id}
      externalScrollElement={scrollElement}
      className={modelListClasses.listScroller}
      role="list"
      estimateGroupHeaderSize={() => MODEL_LIST_GROUP_ROW_ESTIMATE}
      estimateItemSize={() => MODEL_LIST_MODEL_ROW_ESTIMATE}
      estimateGroupFooterSize={() => MODEL_LIST_GROUP_SEPARATOR_HEIGHT}
      overscan={10}
      dragCapabilities={
        onReorderModel
          ? { ...MODEL_LIST_DRAG_CAPABILITIES, groups: Boolean(onReorderGroups) }
          : { groups: false, items: false }
      }
      canDragItem={(model) => !disabled && !bulkActionDisabled && !pendingModelIds.has(model.id)}
      onDragEnd={handleDragEnd}
      renderGroupHeader={(_header, group) => (
        <ModelListGroup
          groupName={group.groupName}
          items={group.items}
          defaultOpen={group.defaultOpen}
          open={group.open}
          disabled={disabled}
          bulkActionDisabled={bulkActionDisabled}
          pendingModelIds={pendingModelIds}
          defaultModelIds={defaultModelIds}
          onDeleteModels={onDeleteModels}
          onToggleOpen={() => toggleGroupOpen(group.groupName, group.defaultOpen)}
        />
      )}
      renderItem={(model, _itemIndex, group, _groupIndex, itemIndexInGroup) => (
        <div
          className={cn(
            modelListClasses.virtualModelRow,
            itemIndexInGroup === group.items.length - 1 && modelListClasses.virtualModelRowLast
          )}>
          <HealthAwareModelListItem
            provider={provider}
            model={model}
            apiKeyEntries={apiKeyEntries}
            savingKeyId={savingKeyId}
            onToggleApiKey={toggleApiKey}
            onEdit={onEditModel}
            onDelete={onDeleteModel}
            disabled={disabled || pendingModelIds.has(model.id)}
            isDefaultModel={defaultModelIds.has(model.id)}
          />
        </div>
      )}
      renderGroupFooter={() => <div aria-hidden style={{ height: MODEL_LIST_GROUP_SEPARATOR_HEIGHT }} />}
    />
  )
}

export default ModelListSections
