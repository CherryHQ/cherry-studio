import { FileSearchOutlined } from '@ant-design/icons'
import { KnowledgeBase } from '@renderer/types'
import { ConfigProvider, Flex, Tag } from 'antd'
import { FC } from 'react'
import styled from 'styled-components'

const KnowledgeBaseInput: FC<{
  selectedKnowledgeBases: KnowledgeBase[]
  onRemoveKnowledgeBase: (knowledgeBase: KnowledgeBase) => void
}> = ({ selectedKnowledgeBases, onRemoveKnowledgeBase }) => {
  return (
    <Container gap="4px 0" wrap>
      <ConfigProvider
        theme={{
          components: {
            Tag: {
              borderRadiusSM: 100
            }
          }
        }}>
        {selectedKnowledgeBases.map((knowledgeBase) => (
          <Tag
            icon={<FileSearchOutlined />}
            bordered={false}
            color="success"
            key={knowledgeBase.id}
            closable
            onClose={() => onRemoveKnowledgeBase(knowledgeBase)}>
            {knowledgeBase.name}
          </Tag>
        ))}
      </ConfigProvider>
    </Container>
  )
}

const Container = styled(Flex)`
  width: 100%;
  padding: 5px 15px 0;
`

export default KnowledgeBaseInput
