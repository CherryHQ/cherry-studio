import { RobotOutlined } from '@ant-design/icons'
import { MentionedAssistant } from '@renderer/types'
import { ConfigProvider, Flex, Tag } from 'antd'
import { FC } from 'react'
import styled from 'styled-components'

const MentionAssistantsInput: FC<{
  selectedAssistants: MentionedAssistant[]
  onRemoveAssistant: (assistant: MentionedAssistant) => void
}> = ({ selectedAssistants, onRemoveAssistant }) => {
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
        {selectedAssistants.map((assistant) => (
          <Tag
            icon={assistant.emoji ? <span>{assistant.emoji}</span> : <RobotOutlined />}
            bordered={false}
            color="success" // 使用不同于模型的颜色
            key={assistant.id}
            closable
            onClose={() => onRemoveAssistant(assistant)}>
            {assistant.name}
          </Tag>
        ))}
      </ConfigProvider>
    </Container>
  )
}

const Container = styled(Flex)`
  padding: 2px 15px;
  flex-wrap: wrap;
`

export default MentionAssistantsInput
