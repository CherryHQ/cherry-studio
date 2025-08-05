import CustomTag from '@renderer/components/Tags/CustomTag'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import { FC } from 'react'
import styled from 'styled-components'

const MentionModelsInput: FC<{
  selectedModels: Model[]
  onRemoveModel: (model: Model) => void
}> = ({ selectedModels, onRemoveModel }) => {
  const { providers } = useProviders()

  const getProviderName = (model: Model) => {
    const provider = providers.find((p) => p.id === model?.provider)
    return provider ? getFancyProviderName(provider) : ''
  }

  return (
    <Container>
      {selectedModels.map((model) => (
        <CustomTag
          icon={<i className="iconfont icon-at" />}
          color="#1677ff"
          key={getModelUniqId(model)}
          closable
          onClose={() => onRemoveModel(model)}>
          {model.name} ({getProviderName(model)})
        </CustomTag>
      ))}
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  padding: 5px 15px 5px 15px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 4px;
`

export default MentionModelsInput
