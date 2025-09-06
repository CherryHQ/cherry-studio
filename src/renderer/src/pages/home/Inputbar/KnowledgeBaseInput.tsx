import { FileSearchOutlined } from '@ant-design/icons'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { useHorizontalScroll } from '@renderer/hooks/useHorizontalScroll'
import { KnowledgeBase } from '@renderer/types'
import { FC } from 'react'
import styled from 'styled-components'

const KnowledgeBaseInput: FC<{
  selectedKnowledgeBases: KnowledgeBase[]
  onRemoveKnowledgeBase: (knowledgeBase: KnowledgeBase) => void
}> = ({ selectedKnowledgeBases, onRemoveKnowledgeBase }) => {
  const { scrollRef, ScrollContainer, ScrollContent, renderScrollButton } = useHorizontalScroll({
    dependencies: [selectedKnowledgeBases]
  })

  return (
    <Container>
      <ScrollContainer>
        <ScrollContent ref={scrollRef}>
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

export default KnowledgeBaseInput
