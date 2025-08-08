import { FileSearchOutlined } from '@ant-design/icons'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { KnowledgeBase } from '@renderer/types'
import { FC } from 'react'
import styled from 'styled-components'

const KnowledgeBaseInput: FC<{
  selectedKnowledgeBases: KnowledgeBase[]
  onRemoveKnowledgeBase: (knowledgeBase: KnowledgeBase) => void
}> = ({ selectedKnowledgeBases, onRemoveKnowledgeBase }) => {
  return (
    <Container>
      {selectedKnowledgeBases.map((knowledgeBase) => (
        <CustomTag
          icon={<FileSearchOutlined />}
          color="#3d9d0f"
          key={knowledgeBase.id}
          closable
          onClose={() => onRemoveKnowledgeBase(knowledgeBase)}>
          {knowledgeBase.name}
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

export default KnowledgeBaseInput
