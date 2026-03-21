import { FileSearchOutlined } from '@ant-design/icons'
import { Tag } from '@cherrystudio/ui'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import type { KnowledgeBase } from '@renderer/types'
import type { FC } from 'react'
import styled from 'styled-components'

const KnowledgeBaseInput: FC<{
  selectedKnowledgeBases: KnowledgeBase[]
  onRemoveKnowledgeBase: (knowledgeBase: KnowledgeBase) => void
}> = ({ selectedKnowledgeBases, onRemoveKnowledgeBase }) => {
  return (
    <Container>
      <HorizontalScrollContainer dependencies={[selectedKnowledgeBases]} expandable>
        {selectedKnowledgeBases.map((knowledgeBase) => (
          <Tag
            icon={<FileSearchOutlined />}
            color="#3d9d0f"
            key={knowledgeBase.id}
            closable
            onClose={() => onRemoveKnowledgeBase(knowledgeBase)}>
            {knowledgeBase.name}
          </Tag>
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
