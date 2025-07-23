import { MinusOutlined } from '@ant-design/icons'
import CustomCollapse from '@renderer/components/CustomCollapse'
import { Model } from '@renderer/types'
import { ModelWithStatus } from '@renderer/types/healthCheck'
import { Button, Flex, Tooltip } from 'antd'
import React, { memo } from 'react'
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

  return (
    <CustomCollapseWrapper>
      <CustomCollapse
        defaultActiveKey={defaultOpen ? ['1'] : []}
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
              onClick={onRemoveGroup}
              disabled={disabled}
            />
          </Tooltip>
        }>
        <Flex gap={10} vertical style={{ marginTop: 10 }}>
          {models.map((model) => (
            <ModelListItem
              key={model.id}
              model={model}
              modelStatus={modelStatuses.find((status) => status.model.id === model.id)}
              onEdit={onEditModel}
              onRemove={onRemoveModel}
              disabled={disabled}
            />
          ))}
        </Flex>
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
`

export default memo(ModelListGroup)
