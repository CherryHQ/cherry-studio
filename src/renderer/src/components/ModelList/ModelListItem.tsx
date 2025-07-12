import { MinusOutlined } from '@ant-design/icons'
import { type HealthResult, HealthStatusIndicator } from '@renderer/components/HealthStatusIndicator'
import { HStack } from '@renderer/components/Layout'
import ModelIdWithTags from '@renderer/components/ModelIdWithTags'
import { getModelLogo } from '@renderer/config/models'
import { Model } from '@renderer/types'
import { ModelWithStatus } from '@renderer/types/healthCheck'
import { maskApiKey } from '@renderer/utils/api'
import { Avatar, Button, Tooltip } from 'antd'
import { Bolt } from 'lucide-react'
import React, { memo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ModelListItemProps {
  ref?: React.RefObject<HTMLDivElement>
  model: Model
  modelStatus: ModelWithStatus | undefined
  disabled?: boolean
  onEdit: (model: Model) => void
  onRemove: (model: Model) => void
}

const ModelListItem: React.FC<ModelListItemProps> = ({ ref, model, modelStatus, disabled, onEdit, onRemove }) => {
  const { t } = useTranslation()
  const isChecking = modelStatus?.checking === true

  const healthResults: HealthResult[] =
    modelStatus?.keyResults?.map((kr) => ({
      status: kr.status,
      latency: kr.latency,
      error: kr.error,
      label: maskApiKey(kr.key)
    })) || []

  return (
    <ListItem ref={ref}>
      <HStack alignItems="center" gap={10} style={{ flex: 1 }}>
        <Avatar src={getModelLogo(model.id)} size={24}>
          {model?.name?.[0]?.toUpperCase()}
        </Avatar>
        <ModelIdWithTags
          model={model}
          style={{
            flex: 1,
            width: 0,
            overflow: 'hidden'
          }}
        />
      </HStack>
      <HStack alignItems="center" gap={6}>
        <HealthStatusIndicator results={healthResults} loading={isChecking} showLatency />
        <HStack alignItems="center" gap={0}>
          <Tooltip title={t('models.edit')} mouseLeaveDelay={0}>
            <Button
              type="text"
              onClick={() => onEdit(model)}
              disabled={disabled || isChecking}
              icon={<Bolt size={16} />}
            />
          </Tooltip>
          <Tooltip title={t('settings.models.manage.remove_model')} mouseLeaveDelay={0}>
            <Button
              type="text"
              onClick={() => onRemove(model)}
              disabled={disabled || isChecking}
              icon={<MinusOutlined />}
            />
          </Tooltip>
        </HStack>
      </HStack>
    </ListItem>
  )
}

const ListItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  color: var(--color-text);
  font-size: 14px;
  line-height: 1;
`

export default memo(ModelListItem)
