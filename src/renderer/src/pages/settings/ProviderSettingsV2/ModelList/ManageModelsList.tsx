import { Avatar, AvatarFallback, Button, Switch, Tooltip } from '@cherrystudio/ui'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { getModelLogo } from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import NewApiBatchAddModelPopup from '@renderer/pages/settings/ProviderSettingsV2/ModelList/NewApiBatchAddModelPopup'
import { isNewApiProvider } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import { cn } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { Minus, Plus } from 'lucide-react'
import React, { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import ModelIdWithTagsV2 from '../components/ModelIdWithTagsV2'
import { modelListClasses } from '../components/ProviderSettingsPrimitives'
import { getModelGroupLabel } from './grouping'
import { isValidNewApiModel } from './utils'

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

  const flatRows = useMemo(() => {
    const rows: RowData[] = []

    Object.entries(modelGroups).forEach(([groupName, models]) => {
      if (models.length > 0) {
        rows.push({ type: 'group', groupName, models })
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
    })

    return rows
  }, [modelGroups])

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
            className="size-7 shrink-0 rounded-md p-0 text-muted-foreground/65 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground"
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

  const estimateSize = useCallback(
    (index: number) => {
      const row = flatRows[index]
      return row?.type === 'group' ? 29 : 40
    },
    [flatRows]
  )

  const isStickyRow = useCallback((index: number) => flatRows[index].type === 'group', [flatRows])

  return (
    <DynamicVirtualList
      list={flatRows}
      estimateSize={estimateSize}
      isSticky={isStickyRow}
      overscan={5}
      scrollerStyle={{
        paddingRight: '4px',
        borderRadius: '8px'
      }}>
      {(row) => {
        if (row.type === 'group') {
          return (
            <div className={modelListClasses.manageListGroupShell}>
              <div className={modelListClasses.manageListGroupHeader}>
                <span className={modelListClasses.manageListGroupTitle}>{getModelGroupLabel(row.groupName, t)}</span>
                <div className={modelListClasses.manageListGroupRule} />
                <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                  {renderGroupTools(row.models)}
                </div>
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
      <div className={cn(modelListClasses.manageListRow, last && modelListClasses.manageListRowLast)}>
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
            className={cn(modelListClasses.rowIconButton, 'size-7 shrink-0 p-0')}
            onClick={() => {
              onAddModel(model)
            }}>
            <Plus className="size-3.5" />
          </Button>
        )}
        <div className="flex h-[14px] w-[14px] shrink-0 items-center justify-center overflow-hidden rounded-[1px]">
          {(() => {
            const Icon = getModelLogo(model)
            return Icon ? (
              <Icon.Avatar size={14} />
            ) : (
              <Avatar className="size-[14px]">
                <AvatarFallback className="text-[8px]">{model?.name?.[0]?.toUpperCase()}</AvatarFallback>
              </Avatar>
            )
          })()}
        </div>
        <div
          className={cn(
            'min-w-0 flex-1 font-mono text-[length:var(--font-size-body-sm)] leading-[var(--line-height-body-sm)]',
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
              className="size-7 shrink-0 rounded-lg border border-[color:var(--color-border-fg-muted)] bg-transparent p-0 text-muted-foreground/70 opacity-0 shadow-none transition-opacity hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground group-hover:opacity-100"
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
