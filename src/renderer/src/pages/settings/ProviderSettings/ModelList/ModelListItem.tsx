import { Avatar, Button, RowFlex, Tooltip } from '@cherrystudio/ui'
import { FreeTrialModelTag } from '@renderer/components/FreeTrialModelTag'
import { type HealthResult, HealthStatusIndicator } from '@renderer/components/HealthStatusIndicator'
import ModelIdWithTags from '@renderer/components/ModelIdWithTags'
import { getModelLogo } from '@renderer/config/models'
import type { Model } from '@renderer/types'
import type { ModelWithStatus } from '@renderer/types/healthCheck'
import { maskApiKey } from '@renderer/utils/api'
import { Bolt, Minus } from 'lucide-react'
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
      <RowFlex className="flex-1 items-center gap-2.5">
        <Avatar src={getModelLogo(model.id)} className="h-6 w-6">
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
        <FreeTrialModelTag model={model} />
      </RowFlex>
      <RowFlex className="items-center gap-1.5">
        <HealthStatusIndicator results={healthResults} loading={isChecking} showLatency />
        <RowFlex className="items-center">
          <Tooltip placement="top" content={t('models.edit')}>
            <Button
              variant="light"
              onPress={() => onEdit(model)}
              isDisabled={disabled}
              startContent={<Bolt size={14} />}
              isIconOnly
            />
          </Tooltip>
          <Tooltip placement="top" content={t('settings.models.manage.remove_model')}>
            <Button
              variant="light"
              onPress={() => onRemove(model)}
              isDisabled={disabled}
              startContent={<Minus size={14} />}
              isIconOnly
            />
          </Tooltip>
        </RowFlex>
      </RowFlex>
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
