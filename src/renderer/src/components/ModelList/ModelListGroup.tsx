import CustomCollapse from '@renderer/components/CustomCollapse'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { Model } from '@renderer/types'
import { ModelWithStatus } from '@renderer/types/healthCheck'
import { Button, Flex, Tooltip } from 'antd'
import { Minus } from 'lucide-react'
import React, { memo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ModelListItem from './ModelListItem'

const MAX_SCROLLER_HEIGHT = 390

interface ModelListGroupProps {
  groupName: string
  models: Model[]
  modelStatuses: ModelWithStatus[]
  defaultOpen: boolean
  disabled?: boolean
  onEditModel: (model: Model) => void
  onRemoveModel: (model: Model) => void
  onRemoveGroup: () => void
}

const ModelListGroup: React.FC<ModelListGroupProps> = ({
  groupName,
  models,
  modelStatuses,
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
    <CustomCollapseWrapper>
      <CustomCollapse
        defaultActiveKey={defaultOpen ? ['1'] : []}
        onChange={handleCollapseChange}
        label={
          <Flex align="center" gap={10}>
            <span style={{ fontWeight: 'bold' }}>{groupName}</span>
          </Flex>
        }
        extra={
          <Tooltip title={t('settings.models.manage.remove_whole_group')} mouseLeaveDelay={0}>
            <Button
              type="text"
              className="toolbar-item"
              icon={<Minus size={14} />}
              onClick={(e) => {
                e.stopPropagation()
                onRemoveGroup()
              }}
              disabled={disabled}
            />
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
              modelStatus={modelStatuses.find((status) => status.model.id === model.id)}
              onEdit={onEditModel}
              onRemove={onRemoveModel}
              disabled={disabled}
            />
          )}
        </DynamicVirtualList>
      </CustomCollapse>
    </CustomCollapseWrapper>
  )
}

const CustomCollapseWrapper = styled.div`
  .toolbar-item {
    transform: translateZ(0);
    will-change: opacity;
    opacity: 0;
    transition: opacity 0.2s;
  }
  &:hover .toolbar-item {
    opacity: 1;
  }

  /* 移除 collapse 的 padding，转而在 scroller 内部调整 */
  .ant-collapse-content-box {
    padding: 0 !important;
  }
`

export default memo(ModelListGroup)
