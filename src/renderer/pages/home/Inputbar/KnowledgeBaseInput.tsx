import { FileSearchOutlined } from '@ant-design/icons'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import CustomTag from '@renderer/components/Tags/CustomTag'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import type { FC } from 'react'
import styled from 'styled-components'

const KnowledgeBaseInput: FC<{
  selectedKnowledgeBases: KnowledgeBaseListItem[]
  onRemoveKnowledgeBase: (knowledgeBase: KnowledgeBaseListItem) => void
}> = ({ selectedKnowledgeBases, onRemoveKnowledgeBase }) => {
  return (
    <Container>
      <HorizontalScrollContainer dependencies={[selectedKnowledgeBases]} expandable>
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
      </HorizontalScrollContainer>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  padding: 5px 15px 5px 15px;
`

export default KnowledgeBaseInput
