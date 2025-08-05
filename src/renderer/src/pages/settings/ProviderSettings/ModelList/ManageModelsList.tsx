import CustomTag from '@renderer/components/CustomTag'
import ExpandableText from '@renderer/components/ExpandableText'
import ModelIdWithTags from '@renderer/components/ModelIdWithTags'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { getModelLogo } from '@renderer/config/models'
import FileItem from '@renderer/pages/files/FileItem'
import NewApiBatchAddModelPopup from '@renderer/pages/settings/ProviderSettings/ModelList/NewApiBatchAddModelPopup'
import { Model, Provider } from '@renderer/types'
import { Button, Flex, Tooltip } from 'antd'
import { Avatar } from 'antd'
import { ChevronRight, Minus, Plus } from 'lucide-react'
import React, { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { isModelInProvider, isValidNewApiModel } from './utils'

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
  onAddModel: (model: Model) => void
  onRemoveModel: (model: Model) => void
}

const ManageModelsList: React.FC<ManageModelsListProps> = ({ modelGroups, provider, onAddModel, onRemoveModel }) => {
  const { t } = useTranslation()
  const [collapsedGroups, setCollapsedGroups] = useState(new Set<string>())

  const handleGroupToggle = useCallback((groupName: string) => {
    setCollapsedGroups((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(groupName)) {
        newSet.delete(groupName) // 如果已折叠，则展开
      } else {
        newSet.add(groupName) // 如果已展开，则折叠
      }
      return newSet
    })
  }, [])

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

  const renderGroupTools = useCallback(
    (models: Model[]) => {
      const isAllInProvider = models.every((model) => isModelInProvider(provider, model.id))

      const handleGroupAction = () => {
        if (isAllInProvider) {
          // 移除整组
          models.filter((model) => isModelInProvider(provider, model.id)).forEach(onRemoveModel)
        } else {
          // 添加整组
          const wouldAddModels = models.filter((model) => !isModelInProvider(provider, model.id))

          if (provider.id === 'new-api') {
            if (wouldAddModels.every(isValidNewApiModel)) {
              wouldAddModels.forEach(onAddModel)
            } else {
              NewApiBatchAddModelPopup.show({
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
          destroyTooltipOnHide
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
              handleGroupAction()
            }}
          />
        </Tooltip>
      )
    },
    [provider, onRemoveModel, onAddModel, t]
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
          return (
            <GroupHeaderContainer isCollapsed={isCollapsed}>
              <GroupHeader isCollapsed={isCollapsed} onClick={() => handleGroupToggle(row.groupName)}>
                <Flex align="center" gap={10} style={{ flex: 1 }}>
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
                {renderGroupTools(row.models)}
              </GroupHeader>
            </GroupHeaderContainer>
          )
        }

        return (
          <ModelListItem
            last={row.last}
            model={row.model}
            provider={provider}
            onAddModel={onAddModel}
            onRemoveModel={onRemoveModel}
          />
        )
      }}
    </DynamicVirtualList>
  )
}

// 模型列表项组件
interface ModelListItemProps {
  model: Model
  provider: Provider
  onAddModel: (model: Model) => void
  onRemoveModel: (model: Model) => void
  last?: boolean
}

const ModelListItem: React.FC<ModelListItemProps> = memo(({ model, provider, onAddModel, onRemoveModel, last }) => {
  const isAdded = useMemo(() => isModelInProvider(provider, model.id), [provider, model.id])
  return (
    <ModelListItemContainer last={last}>
      <FileItem
        style={{
          backgroundColor: isAdded ? 'rgba(0, 126, 0, 0.06)' : '',
          border: 'none',
          boxShadow: 'none'
        }}
        fileInfo={{
          icon: <Avatar src={getModelLogo(model.id)}>{model?.name?.[0]?.toUpperCase()}</Avatar>,
          name: <ModelIdWithTags model={model} />,
          extra: model.description && <ExpandableText text={model.description} />,
          ext: '.model',
          actions: isAdded ? (
            <Button type="text" onClick={() => onRemoveModel(model)} icon={<Minus size={16} />} />
          ) : (
            <Button type="text" onClick={() => onAddModel(model)} icon={<Plus size={16} />} />
          )
        }}
      />
    </ModelListItemContainer>
  )
})

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
