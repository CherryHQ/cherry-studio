import ExpandableText from '@renderer/components/ExpandableText'
import ModelIdWithTags from '@renderer/components/ModelIdWithTags'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { getModelLogoById } from '@renderer/config/models'
import FileItem from '@renderer/pages/files/FileItem'
import type { Model, Provider } from '@renderer/types'
import { Avatar, Button, Checkbox, Flex, Tooltip } from 'antd'
import { ChevronRight, Minus, Plus } from 'lucide-react'
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { addModelsWithValidation } from './utils'

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
  duplicateModelNames: Set<string>
  provider: Provider
  onAddModel: (model: Model) => void
  onRemoveModel: (model: Model) => void
}

const ManageModelsList: React.FC<ManageModelsListProps> = ({
  modelGroups,
  duplicateModelNames,
  provider,
  onAddModel,
  onRemoveModel
}) => {
  const { t } = useTranslation()
  const [collapsedGroups, setCollapsedGroups] = useState(new Set<string>())
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())

  // 缓存已添加的模型ID集合，用于O(1)时间复杂度的查找
  const addedModelIds = useMemo(() => {
    return new Set((provider.models || []).map((m) => m.id))
  }, [provider.models])

  // 收集所有可用的模型ID，用于清理无效的选中项
  const availableModelIds = useMemo(() => {
    const ids = new Set<string>()
    Object.values(modelGroups).forEach((models) => {
      models.forEach((model) => ids.add(model.id))
    })
    return ids
  }, [modelGroups])

  // 当 modelGroups 或 provider.models 变化时，清理无效选中项
  useEffect(() => {
    setSelectedModels((prev) => {
      const newSelected = new Set(prev)
      let changed = false
      for (const modelId of prev) {
        // 如果模型不在当前列表中或已被添加到 provider，从选中状态中移除
        if (!availableModelIds.has(modelId) || addedModelIds.has(modelId)) {
          newSelected.delete(modelId)
          changed = true
        }
      }
      return changed ? newSelected : prev
    })
  }, [availableModelIds, addedModelIds])

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

  const handleSelectModel = useCallback((modelId: string, checked: boolean) => {
    setSelectedModels((prev) => {
      const newSet = new Set(prev)
      if (checked) {
        newSet.add(modelId)
      } else {
        newSet.delete(modelId)
      }
      return newSet
    })
  }, [])

  const handleAddModelsWithValidation = useCallback(
    async (modelsToAdd: Model[]): Promise<boolean> => {
      return addModelsWithValidation(provider, modelsToAdd, onAddModel, t)
    },
    [provider, onAddModel, t]
  )

  // 将分组数据扁平化为单一列表，过滤掉空组
  const flatRows = useMemo(() => {
    const rows: RowData[] = []

    Object.entries(modelGroups).forEach(([groupName, models]) => {
      if (models.length > 0) {
        // 只添加非空组
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

  const handleBatchAddSelected = useCallback(
    async (models: Model[]) => {
      const modelsToAdd = models.filter((m) => selectedModels.has(m.id))
      if (modelsToAdd.length === 0) return

      const success = await handleAddModelsWithValidation(modelsToAdd)
      if (success) {
        setSelectedModels((prev) => {
          const newSelected = new Set(prev)
          modelsToAdd.forEach((m) => newSelected.delete(m.id))
          return newSelected
        })
        window.toast.success(t('settings.models.manage.add_success', { count: modelsToAdd.length }))
      }
    },
    [selectedModels, handleAddModelsWithValidation, t]
  )

  const renderGroupTools = useCallback(
    (models: Model[]) => {
      const isAllInProvider = models.every((model) => addedModelIds.has(model.id))

      const handleGroupAction = async () => {
        if (isAllInProvider) {
          // 移除整组
          models.filter((model) => addedModelIds.has(model.id)).forEach(onRemoveModel)
        } else {
          // 添加整组，复用 addModelsWithValidation 统一处理验证和弹窗
          const wouldAddModels = models.filter((model) => !addedModelIds.has(model.id))
          const success = await handleAddModelsWithValidation(wouldAddModels)
          if (success) {
            window.toast.success(t('settings.models.manage.add_success', { count: wouldAddModels.length }))
          }
        }
      }

      return (
        <Tooltip
          destroyOnHidden
          title={
            isAllInProvider
              ? t('settings.models.manage.remove_whole_group')
              : t('settings.models.manage.add_whole_group')
          }
          mouseLeaveDelay={0}
          placement="top">
          <Button
            type="text"
            icon={isAllInProvider ? <Minus size={16} /> : <Plus size={16} />}
            onClick={(e) => {
              e.stopPropagation()
              void handleGroupAction()
            }}
          />
        </Tooltip>
      )
    },
    [addedModelIds, onRemoveModel, t, handleAddModelsWithValidation]
  )

  return (
    <DynamicVirtualList
      list={flatRows}
      estimateSize={useCallback(() => 60, [])}
      isSticky={useCallback((index: number) => flatRows[index].type === 'group', [flatRows])}
      overscan={5}
      scrollerStyle={{
        paddingRight: '10px',
        borderRadius: '8px'
      }}>
      {(row) => {
        if (row.type === 'group') {
          const isCollapsed = collapsedGroups.has(row.groupName)
          const modelsNotInProvider = row.models.filter((model) => !addedModelIds.has(model.id))
          const groupSelectedCount = modelsNotInProvider.filter((m) => selectedModels.has(m.id)).length
          const isGroupAllSelected = modelsNotInProvider.length > 0 && groupSelectedCount === modelsNotInProvider.length
          const isGroupIndeterminate = groupSelectedCount > 0 && !isGroupAllSelected
          return (
            <GroupHeaderContainer isCollapsed={isCollapsed}>
              <GroupHeader isCollapsed={isCollapsed} onClick={() => handleGroupToggle(row.groupName)}>
                <Flex align="center" gap={10} style={{ flex: 1 }}>
                  <Checkbox
                    checked={isGroupAllSelected}
                    indeterminate={isGroupIndeterminate}
                    disabled={modelsNotInProvider.length === 0}
                    aria-label={t('settings.models.manage.select_all_group', { groupName: row.groupName })}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation()
                      setSelectedModels((prev) => {
                        const newSelected = new Set(prev)
                        // 基于 prev 重新计算当前组的选择状态
                        const currentGroupSelectedCount = modelsNotInProvider.filter((m) => prev.has(m.id)).length
                        const isCurrentlyAllSelected =
                          modelsNotInProvider.length > 0 && currentGroupSelectedCount === modelsNotInProvider.length

                        if (isCurrentlyAllSelected) {
                          modelsNotInProvider.forEach((m) => newSelected.delete(m.id))
                        } else {
                          modelsNotInProvider.forEach((m) => newSelected.add(m.id))
                        }
                        return newSelected
                      })
                    }}
                  />
                  <ChevronRight
                    size={16}
                    color="var(--color-text-3)"
                    strokeWidth={1.5}
                    style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
                  />
                  <span style={{ fontWeight: 'bold', fontSize: '14px' }}>{row.groupName}</span>
                  <CustomTag color="#02B96B" size={10}>
                    {row.models.length}
                  </CustomTag>
                </Flex>
                <Flex align="center" gap={4}>
                  {groupSelectedCount > 0 && (
                    <Tooltip title={t('settings.models.manage.batch_add_selected')}>
                      <Button
                        type="primary"
                        size="small"
                        aria-label={t('settings.models.manage.batch_add_selected')}
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleBatchAddSelected(modelsNotInProvider)
                        }}>
                        +{groupSelectedCount}
                      </Button>
                    </Tooltip>
                  )}
                  {renderGroupTools(row.models)}
                </Flex>
              </GroupHeader>
            </GroupHeaderContainer>
          )
        }

        return (
          <ModelListItem
            last={row.last}
            model={row.model}
            showIdentifier={duplicateModelNames.has(row.model.name)}
            onAddModel={onAddModel}
            onRemoveModel={onRemoveModel}
            isSelected={selectedModels.has(row.model.id)}
            onSelectChange={handleSelectModel}
            isAlreadyAdded={addedModelIds.has(row.model.id)}
            selectAriaLabel={t('settings.models.manage.select_model', { modelName: row.model.name })}
          />
        )
      }}
    </DynamicVirtualList>
  )
}

// 模型列表项组件
interface ModelListItemProps {
  model: Model
  showIdentifier: boolean
  onAddModel: (model: Model) => void
  onRemoveModel: (model: Model) => void
  last?: boolean
  isSelected?: boolean
  onSelectChange?: (modelId: string, checked: boolean) => void
  isAlreadyAdded: boolean
  selectAriaLabel?: string
}

const ModelListItem: React.FC<ModelListItemProps> = memo(
  ({
    model,
    showIdentifier,
    onAddModel,
    onRemoveModel,
    last,
    isSelected,
    onSelectChange,
    isAlreadyAdded,
    selectAriaLabel
  }) => {
    // isAlreadyAdded 由父组件通过 addedModelIds Set 计算传入，性能更优
    return (
      <ModelListItemContainer last={last}>
        <FileItem
          style={{
            backgroundColor: isAlreadyAdded ? 'rgba(0, 126, 0, 0.06)' : '',
            border: 'none',
            boxShadow: 'none'
          }}
          fileInfo={{
            icon: <Avatar src={getModelLogoById(model.id)}>{model?.name?.[0]?.toUpperCase() || '?'}</Avatar>,
            name: (
              <Flex align="center" gap={8}>
                {!isAlreadyAdded && onSelectChange && (
                  <Checkbox
                    checked={!!isSelected}
                    aria-label={selectAriaLabel || model.id}
                    onChange={(e) => {
                      e.stopPropagation()
                      onSelectChange(model.id, e.target.checked)
                    }}
                  />
                )}
                <ModelIdWithTags model={model} showIdentifier={showIdentifier} />
              </Flex>
            ),
            extra: model.description && <ExpandableText text={model.description} />,
            ext: '.model',
            actions: isAlreadyAdded ? (
              <Button type="text" onClick={() => onRemoveModel(model)} icon={<Minus size={16} />} />
            ) : (
              <Button type="text" onClick={() => onAddModel(model)} icon={<Plus size={16} />} />
            )
          }}
        />
      </ModelListItemContainer>
    )
  }
)

const GroupHeader = styled.div<{ isCollapsed: boolean }>`
  display: flex;
  background-color: var(--color-background-mute);
  border-radius: ${(props) => (props.isCollapsed ? '8px' : '8px 8px 0 0')};
  align-items: center;
  justify-content: space-between;
  padding: 0 13px;
  min-height: 38px;
  color: var(--color-text);
  cursor: pointer;
`

const GroupHeaderContainer = styled.div<{ isCollapsed: boolean }>`
  padding-bottom: ${(props) => (props.isCollapsed ? '8px' : '0')};
`

const ModelListItemContainer = styled.div<{ last?: boolean }>`
  border: 1px solid var(--color-border);
  padding: 4px;
  border-top: none;
  border-radius: ${(props) => (props.last ? '0 0 8px 8px' : '0')};
  border-bottom: ${(props) => (props.last ? '1px solid var(--color-border)' : 'none')};
  margin-bottom: ${(props) => (props.last ? '8px' : '0')};
`

export default memo(ManageModelsList)
