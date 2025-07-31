import { MinusOutlined } from '@ant-design/icons'
import CustomCollapse from '@renderer/components/CustomCollapse'
import { Model } from '@renderer/types'
import { ModelWithStatus } from '@renderer/types/healthCheck'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button, Flex, Tooltip } from 'antd'
import React, { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ModelListItem from './ModelListItem'

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
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [isExpanded, setIsExpanded] = useState(defaultOpen)

  const virtualizer = useVirtualizer({
    count: models.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => 52,
    overscan: 5
  })

  const virtualItems = virtualizer.getVirtualItems()

  // 监听折叠面板状态变化，确保虚拟列表在展开时正确渲染
  useEffect(() => {
    if (isExpanded && scrollerRef.current) {
      requestAnimationFrame(() => virtualizer.measure())
    }
  }, [isExpanded, virtualizer])

  const handleCollapseChange = (activeKeys: string[] | string) => {
    const isNowExpanded = Array.isArray(activeKeys) ? activeKeys.length > 0 : !!activeKeys
    setIsExpanded(isNowExpanded)
  }

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
              icon={<MinusOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                onRemoveGroup()
              }}
              disabled={disabled}
            />
          </Tooltip>
        }>
        <ScrollContainer ref={scrollerRef}>
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative'
            }}>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItems[0]?.start ?? 0}px)`
              }}>
              {virtualItems.map((virtualItem) => {
                const model = models[virtualItem.index]
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      /* 在这里调整 item 间距 */
                      padding: '4px 0'
                    }}>
                    <ModelListItem
                      model={model}
                      modelStatus={modelStatuses.find((status) => status.model.id === model.id)}
                      onEdit={onEditModel}
                      onRemove={onRemoveModel}
                      disabled={disabled}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </ScrollContainer>
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

const ScrollContainer = styled.div`
  overflow-y: auto;
  max-height: 390px;
  padding: 4px 16px;
`

export default memo(ModelListGroup)
