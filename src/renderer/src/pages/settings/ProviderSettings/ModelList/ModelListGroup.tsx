import { Button, Flex, Tooltip } from '@cherrystudio/ui'
import CustomCollapse from '@renderer/components/CustomCollapse'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import type { Model } from '@renderer/types'
import type { ModelWithStatus } from '@renderer/types/healthCheck'
import { Minus } from 'lucide-react'
import React, { memo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import ModelListItem from './ModelListItem'

const MAX_SCROLLER_HEIGHT = 390

interface ModelListGroupProps {
  groupName: string
  models: Model[]
  duplicateModelNames: Set<string>
  /** 使用 Map 实现 O(1) 查找，替代原来的数组线性搜索 */
  modelStatusMap: Map<string, ModelWithStatus>
  defaultOpen: boolean
  disabled?: boolean
  onEditModel: (model: Model) => void
  onRemoveModel: (model: Model) => void
  onRemoveGroup: () => void
}

const ModelListGroup: React.FC<ModelListGroupProps> = ({
  groupName,
  models,
  duplicateModelNames,
  modelStatusMap,
  defaultOpen,
  disabled,
  onEditModel,
  onRemoveModel,
  onRemoveGroup
}) => {
  const { t } = useTranslation()
  const listRef = useRef<DynamicVirtualListRef>(null)

  const handleCollapseChange = useCallback((activeKeys: string[] | string) => {
    const isNowExpanded = Array.isArray(activeKeys) ? activeKeys.length > 0 : !!activeKeys
    if (isNowExpanded) {
      // 延迟到 DOM 可见后测量
      requestAnimationFrame(() => listRef.current?.measure())
    }
  }, [])

  return (
    <div className="group/model-list [&_.ant-collapse-content-box]:p-0!">
      <CustomCollapse
        defaultActiveKey={defaultOpen ? ['1'] : []}
        onChange={handleCollapseChange}
        label={
          <Flex className="items-center gap-2.5">
            <span style={{ fontWeight: 'bold' }}>{groupName}</span>
          </Flex>
        }
        extra={
          <Tooltip content={t('settings.models.manage.remove_whole_group')}>
            <Button
              variant="ghost"
              className="translate-z-0 opacity-0 transition-opacity will-change-[opacity] group-hover/model-list:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                onRemoveGroup()
              }}
              disabled={disabled}>
              <Minus size={14} />
            </Button>
          </Tooltip>
        }
        styles={{
          header: {
            padding: '3px calc(6px + var(--scrollbar-width)) 3px 16px'
          }
        }}>
        <DynamicVirtualList
          ref={listRef}
          list={models}
          estimateSize={useCallback(() => 52, [])} // 44px item + 8px padding
          overscan={5}
          scrollerStyle={{
            maxHeight: `${MAX_SCROLLER_HEIGHT}px`,
            padding: '4px 6px 4px 12px',
            scrollbarGutter: 'stable'
          }}
          itemContainerStyle={{
            padding: '4px 0'
          }}>
          {(model) => (
            <ModelListItem
              model={model}
              modelStatus={modelStatusMap.get(model.id)}
              showIdentifier={duplicateModelNames.has(model.name)}
              onEdit={onEditModel}
              onRemove={onRemoveModel}
              disabled={disabled}
            />
          )}
        </DynamicVirtualList>
      </CustomCollapse>
    </div>
  )
}

export default memo(ModelListGroup)
