import { MinusCircleOutlined, SettingOutlined } from '@ant-design/icons'
import ModelTags from '@renderer/components/ModelTags'
import { getModelLogo } from '@renderer/config/models'
import { Model, Provider } from '@renderer/types'
import { Avatar, Card, Tooltip } from 'antd'
import { groupBy, sortBy, toPairs } from 'lodash'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ModelListProps {
  provider: Provider
  models: Model[]
  onRemoveModel: (model: Model) => void
  onEditModel: (model: Model) => void
}

const ModelList: React.FC<ModelListProps> = ({ provider, models, onRemoveModel, onEditModel }) => {
  const { t } = useTranslation()
  const modelGroups = groupBy(models, 'group')
  const sortedModelGroups = sortBy(toPairs(modelGroups), [0]).reduce((acc, [key, value]) => {
    acc[key] = value
    return acc
  }, {})

  return (
    <>
      {Object.keys(sortedModelGroups).map((group) => (
        <Card
          key={group}
          type="inner"
          title={group}
          extra={
            <Tooltip title={t('settings.models.manage.remove_whole_group')}>
              <HoveredRemoveIcon
                onClick={() =>
                  modelGroups[group]
                    .filter((model) => provider.models.some((m) => m.id === model.id))
                    .forEach((model) => onRemoveModel(model))
                }
              />
            </Tooltip>
          }
          style={{ marginBottom: '10px', border: '0.5px solid var(--color-border)' }}
          size="small">
          {sortedModelGroups[group].map((model) => (
            <ModelListItem key={model.id}>
              <ModelListHeader>
                <Avatar src={getModelLogo(model.id)} size={22} style={{ marginRight: '8px' }}>
                  {model?.name?.[0]?.toUpperCase()}
                </Avatar>
                <ModelNameRow>
                  <span>{model?.name}</span>
                  <ModelTags model={model} />
                </ModelNameRow>
                <SettingIcon onClick={() => onEditModel(model)} />
              </ModelListHeader>
              <RemoveIcon onClick={() => onRemoveModel(model)} />
            </ModelListItem>
          ))}
        </Card>
      ))}
    </>
  )
}

const ModelListItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
`

const ModelListHeader = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
`

const ModelNameRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
`

const RemoveIcon = styled(MinusCircleOutlined)`
  font-size: 18px;
  margin-left: 10px;
  color: var(--color-error);
  cursor: pointer;
  transition: all 0.2s ease-in-out;
`

const HoveredRemoveIcon = styled(RemoveIcon)`
  opacity: 0;
  margin-top: 2px;
  &:hover {
    opacity: 1;
  }
`

const SettingIcon = styled(SettingOutlined)`
  margin-left: 2px;
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.2s ease-in-out;
  &:hover {
    color: var(--color-text-2);
  }
`

export default ModelList
