import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model, ModelGroup } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import { FC } from 'react'
import styled from 'styled-components'

const MentionModelsInput: FC<{
  selectedModels: Model[]
  selectedGroups?: ModelGroup[]
  onRemoveModel: (model: Model) => void
  onRemoveGroup?: (group: ModelGroup) => void
}> = ({ selectedModels, selectedGroups = [], onRemoveModel, onRemoveGroup }) => {
  const { providers } = useProviders()

  const getProviderName = (model: Model) => {
    const provider = providers.find((p) => p.id === model?.provider)
    return provider ? getFancyProviderName(provider) : ''
  }

  return (
    <Container>
      <HorizontalScrollContainer dependencies={[selectedModels, selectedGroups]} expandable>
        {/* Render groups first */}
        {selectedGroups.map((group) => (
          <CustomTag
            icon={<i className="iconfont icon-folder" />}
            color="#52c41a"
            key={group.id}
            closable
            onClose={() => onRemoveGroup?.(group)}>
            @{group.name}
          </CustomTag>
        ))}

        {/* Then render individual models */}
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
      </HorizontalScrollContainer>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  padding: 5px 15px 5px 15px;
`

export default MentionModelsInput
