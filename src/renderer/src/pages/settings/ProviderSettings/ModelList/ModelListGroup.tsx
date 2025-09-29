import { Button, Flex, Tooltip } from '@cherrystudio/ui'
import { CustomCollapse } from '@cherrystudio/ui'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import type { Model } from '@renderer/types'
import type { ModelWithStatus } from '@renderer/types/healthCheck'
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

  const handleCollapseChange = useCallback((keys: 'all' | Set<React.Key>) => {
    if (keys === 'all') {
      return
    }
    const stringKeys = Array.from(keys)

    const isNowExpanded = Array.isArray(stringKeys) ? stringKeys.length > 0 : !!stringKeys
    if (isNowExpanded) {
      // 延迟到 DOM 可见后测量
      requestAnimationFrame(() => listRef.current?.measure())
    }
  }, [])

  return (
    <CustomCollapseWrapper>
      <CustomCollapse
        accordionProps={{
          variant: 'shadow',
          defaultExpandedKeys: defaultOpen ? ['1'] : [],
          onSelectionChange: handleCollapseChange
        }}
        accordionItemProps={{
          disableIndicatorAnimation: true,
          indicator: (
            <Tooltip placement="top" title={t('settings.models.manage.remove_whole_group')}>
              <Button
                variant="light"
                className="toolbar-item"
                startContent={<Minus size={14} />}
                onPress={onRemoveGroup}
                isDisabled={disabled}
                isIconOnly
              />
            </Tooltip>
          ),
          classNames: {
            trigger: 'p-[3px_calc(6px_+_var(--scrollbar-width))_3px_16px]'
          },
          title: (
            <Flex className="items-center gap-[10px]">
              <span style={{ fontWeight: 'bold' }}>{groupName}</span>
            </Flex>
          )
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
