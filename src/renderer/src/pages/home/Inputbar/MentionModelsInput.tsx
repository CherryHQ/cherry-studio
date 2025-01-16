import { Model } from '@renderer/types'
import { Flex, Tag } from 'antd'
import { FC } from 'react'
import styled from 'styled-components'

const MentionModelsInput: FC<{
  selectedModels: Model[]
  onRemoveModel: (model: Model) => void
}> = ({ selectedModels, onRemoveModel }) => {
  return (
    <Container gap="4px 0" wrap>
      {selectedModels.map((model) => (
        <Tag bordered={false} color="processing" key={model.id} closable onClose={() => onRemoveModel(model)}>
          @{model.name}
        </Tag>
      ))}
    </Container>
  )
}

const Container = styled(Flex)`
  width: 100%;
  padding: 10px 15px 0;
`

export default MentionModelsInput
