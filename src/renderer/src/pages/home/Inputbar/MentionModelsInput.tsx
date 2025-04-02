import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { Flex, Tag } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const MentionModelsInput: FC<{
  selectedModels: Model[]
  onRemoveModel: (model: Model) => void
}> = ({ selectedModels, onRemoveModel }) => {
  const { providers } = useProviders()
  const { t } = useTranslation()

  const getProviderName = (model: Model) => {
    const provider = providers.find((p) => p.id === model?.provider)
    return provider ? (provider.isSystem ? t(`provider.${provider.id}`) : provider.name) : ''
  }

  return (
    <Container gap="4px 0" wrap>
      {selectedModels.map((model) => (
        <StyledTag
          bordered={false}
          color="processing"
          key={getModelUniqId(model)}
          closable
          onClose={() => onRemoveModel(model)}>
          @{model.name} ({getProviderName(model)})
        </StyledTag>
      ))}
    </Container>
  )
}

const Container = styled(Flex)`
  width: 100%;
  padding: 10px 15px 0;
`

// Enhance Tag's visual effect to make multi-selected models more prominent
const StyledTag = styled(Tag)`
  margin: 2px 4px 2px 0;
  padding: 2px 8px;
  border-radius: 4px;
  transition: all 0.2s;
  font-weight: 500;

  &:hover {
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transform: translateY(-1px);
  }

  .anticon-close {
    color: rgba(0, 0, 0, 0.45);
    &:hover {
      color: rgba(0, 0, 0, 0.85);
    }
  }
`

export default MentionModelsInput
