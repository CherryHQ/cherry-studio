import { Avatar, AvatarFallback, Button, Switch, Tooltip } from '@cherrystudio/ui'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { getModelLogo } from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import NewApiBatchAddModelPopup from '@renderer/pages/settings/ProviderSettingsV2/ModelList/NewApiBatchAddModelPopup'
import { isNewApiProvider } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import { cn } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { ChevronRight, Minus, Plus } from 'lucide-react'
import React, { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ModelIdWithTagsV2 from '../components/ModelIdWithTagsV2'
import { getModelGroupLabel } from './grouping'
import { isValidNewApiModel } from './utils'

// 列表项类型定义
interface GroupRowData {
  type: 'group'
  groupName: string
  models: Model[]
}

interface ModelRowData {
  type: 'model'
  model: Model
  last?: boolean
}

type RowData = GroupRowData | ModelRowData

interface ManageModelsListProps {
  modelGroups: Record<string, Model[]>
  provider: Provider
  existingModelIds: Set<string>
  /** Resolved provider models (for isEnabled on Switch) */
  existingById: Map<string, Model>
  onAddModel: (model: Model) => void
  onRemoveModel: (model: Model) => void
  onToggleModelEnabled: (model: Model, enabled: boolean) => void
}

const ManageModelsList: React.FC<ManageModelsListProps> = ({
  modelGroups,
  provider,
  existingModelIds,
  existingById,
  onAddModel,
  onRemoveModel,
  onToggleModelEnabled
}) => {
  const { t } = useTranslation()
  const [collapsedGroups, setCollapsedGroups] = useState(new Set<string>())

  const handleGroupToggle = useCallback((groupName: string) => {
    setCollapsedGroups((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(groupName)) {
        newSet.delete(groupName)
      } else {
        newSet.add(groupName)
      }
      return newSet
    })
  }, [])

  // 将分组数据扁平化为单一列表，过滤掉空组
  const flatRows = useMemo(() => {
    const rows: RowData[] = []

    Object.entries(modelGroups).forEach(([groupName, models]) => {
      if (models.length > 0) {
        rows.push({ type: 'group', groupName, models })
        if (!collapsedGroups.has(groupName)) {
          rows.push(
            ...models.map(
              (model, index) =>
                ({
                  type: 'model',
                  model,
                  last: index === models.length - 1 ? true : undefined
                }) as const
            )
          )
        }
      }
    })

    return rows
  }, [modelGroups, collapsedGroups])

  const renderGroupTools = useCallback(
    (models: Model[]) => {
      const isAllInProvider = models.every((model) => existingModelIds.has(model.id))

      const handleGroupAction = () => {
        if (isAllInProvider) {
          models.filter((model) => existingModelIds.has(model.id)).forEach(onRemoveModel)
        } else {
          const wouldAddModels = models.filter((model) => !existingModelIds.has(model.id))

          if (isNewApiProvider(provider)) {
            if (wouldAddModels.every(isValidNewApiModel)) {
              wouldAddModels.forEach(onAddModel)
            } else {
              void NewApiBatchAddModelPopup.show({
                title: t('settings.models.add.batch_add_models'),
                batchModels: wouldAddModels,
                provider
              })
            }
          } else {
            wouldAddModels.forEach(onAddModel)
          }
        }
      }

      return (
        <Tooltip
          content={
            isAllInProvider
              ? t('settings.models.manage.remove_whole_group')
              : t('settings.models.manage.add_whole_group')
          }>
          <Button
            variant="ghost"
            type="button"
            size="icon"
            onClick={() => {
              handleGroupAction()
            }}>
            {isAllInProvider ? <Minus size={16} /> : <Plus size={16} />}
          </Button>
        </Tooltip>
      )
    },
    [provider, existingModelIds, onRemoveModel, onAddModel, t]
  )

  return (
    <DynamicVirtualList
      list={flatRows}
      estimateSize={useCallback(() => 52, [])}
      isSticky={useCallback((index: number) => flatRows[index].type === 'group', [flatRows])}
      overscan={5}
      scrollerStyle={{
        paddingRight: '4px',
        borderRadius: '8px'
      }}>
      {(row) => {
        if (row.type === 'group') {
          const isCollapsed = collapsedGroups.has(row.groupName)
          return (
            <div
              className="mb-1 flex cursor-pointer items-center gap-1.5 px-1 py-[3px]"
              onClick={() => {
                handleGroupToggle(row.groupName)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleGroupToggle(row.groupName)
                }
              }}
              role="button"
              tabIndex={0}>
              <ChevronRight
                size={14}
                className={cn('shrink-0 text-muted-foreground/70', !isCollapsed && 'rotate-90')}
                strokeWidth={1.5}
              />
              <span className="font-medium text-muted-foreground text-xs">{getModelGroupLabel(row.groupName, t)}</span>
              <div className="h-px min-w-0 flex-1 bg-muted/50" />
              <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                {renderGroupTools(row.models)}
              </div>
            </div>
          )
        }

        return (
          <ModelListItem
            last={row.last}
            model={row.model}
            existingModelIds={existingModelIds}
            existingById={existingById}
            onAddModel={onAddModel}
            onRemoveModel={onRemoveModel}
            onToggleModelEnabled={onToggleModelEnabled}
          />
        )
      }}
    </DynamicVirtualList>
  )
}

// 模型列表项组件 — 对齐 `ModelManagementPanel`：Switch 启用、未加入为 +
interface ModelListItemProps {
  model: Model
  existingModelIds: Set<string>
  existingById: Map<string, Model>
  onAddModel: (model: Model) => void
  onRemoveModel: (model: Model) => void
  onToggleModelEnabled: (model: Model, enabled: boolean) => void
  last?: boolean
}

const ModelListItem: React.FC<ModelListItemProps> = memo(
  ({ model, existingModelIds, existingById, onAddModel, onRemoveModel, onToggleModelEnabled, last }) => {
    const { t } = useTranslation()
    const isAdded = useMemo(() => existingModelIds.has(model.id), [existingModelIds, model.id])
    const isEnabled = isAdded ? (existingById.get(model.id)?.isEnabled ?? true) : false
    const nameMuted = isAdded && !isEnabled

    return (
      <div
        className={cn(
          'group flex items-center gap-2 rounded-lg px-1.5 py-[5px] transition-colors hover:bg-accent/50',
          last && 'mb-0.5'
        )}>
        {isAdded ? (
          <Switch
            size="sm"
            checked={isEnabled}
            onCheckedChange={(v) => {
              onToggleModelEnabled(model, v)
            }}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 p-0"
            onClick={() => {
              onAddModel(model)
            }}>
            <Plus className="size-3.5" />
          </Button>
        )}
        <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-hidden rounded-[1px]">
          {(() => {
            const Icon = getModelLogo(model)
            return Icon ? (
              <Icon.Avatar size={14} />
            ) : (
              <Avatar className="size-3.5">
                <AvatarFallback className="text-[8px]">{model?.name?.[0]?.toUpperCase()}</AvatarFallback>
              </Avatar>
            )
          })()}
        </div>
        <div
          className={cn(
            'min-w-0 flex-1 font-mono text-sm',
            nameMuted ? 'text-muted-foreground/60' : 'text-foreground'
          )}>
          <ModelIdWithTagsV2 model={model} />
        </div>
        {isAdded ? (
          <Tooltip content={t('settings.models.manage.remove_model')}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => {
                onRemoveModel(model)
              }}>
              <Minus className="size-3.5" />
            </Button>
          </Tooltip>
        ) : null}
      </div>
    )
  }
)

export default memo(ManageModelsList)
