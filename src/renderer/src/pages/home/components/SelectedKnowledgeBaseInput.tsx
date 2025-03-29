import { KnowledgeBase } from '@renderer/types'
import { Flex, Tag } from 'antd'
import { FC } from 'react'
import styled from 'styled-components'

const SelectedKnowledgeBaseInput: FC<{
  selectedKnowledgeBase: KnowledgeBase[]
  onRemoveKnowledgeBase: (knowledgeBase: KnowledgeBase) => void
}> = ({ selectedKnowledgeBase, onRemoveKnowledgeBase }) => {
  return (
    <Container gap="4px 0" wrap>
      {selectedKnowledgeBase.map((knowledgeBase) => (
        <Tag
          bordered={false}
          color="pink"
          key={knowledgeBase.id}
          closable
          onClose={() => onRemoveKnowledgeBase(knowledgeBase)}>
          #{knowledgeBase.name}
        </Tag>
      ))}
    </Container>
  )
}

const Container = styled(Flex)`
  width: 100%;
  padding: 10px 15px 0;
`

export default SelectedKnowledgeBaseInput
