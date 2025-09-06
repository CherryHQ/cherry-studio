import CustomTag from '@renderer/components/Tags/CustomTag'
import { useHorizontalScroll } from '@renderer/hooks/useHorizontalScroll'
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
  const { scrollRef, ScrollContainer, ScrollContent, renderScrollButton } = useHorizontalScroll({
    dependencies: [selectedModels]
  })

  const getProviderName = (model: Model) => {
    const provider = providers.find((p) => p.id === model?.provider)
    return provider ? getFancyProviderName(provider) : ''
  }

  return (
    <Container>
      <ScrollContainer>
        <ScrollContent ref={scrollRef}>
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
        </ScrollContent>
        {renderScrollButton()}
      </ScrollContainer>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  padding: 5px 15px 5px 15px;
`

export default MentionModelsInput
