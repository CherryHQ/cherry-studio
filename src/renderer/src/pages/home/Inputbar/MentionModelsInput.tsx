import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProviders'
import type { Model } from '@shared/data/types/model'
import type { FC } from 'react'
import styled from 'styled-components'

const MentionModelsInput: FC<{
  selectedModels: Model[]
  onRemoveModel: (model: Model) => void
}> = ({ selectedModels, onRemoveModel }) => {
  const { providers } = useProviders()

  const getProviderName = (model: Model) => {
    const provider = providers.find((p) => p.id === model?.providerId)
    return provider ? getProviderDisplayName(provider) : ''
  }

  return (
    <Container>
      <HorizontalScrollContainer dependencies={[selectedModels]} expandable>
        {selectedModels.map((model) => (
          <CustomTag
            icon={<i className="iconfont icon-at" />}
            color="#1677ff"
            key={model.id}
            closable
            onClose={() => onRemoveModel(model)}>
            {model.name} ({getProviderName(model)})
          </CustomTag>
        ))}
      </HorizontalScrollContainer>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  padding: 5px 15px 5px 15px;
`

export default MentionModelsInput
