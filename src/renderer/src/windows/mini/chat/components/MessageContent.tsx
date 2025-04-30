import Markdown from '@renderer/pages/home/Markdown/Markdown'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { MainTextMessageBlock, Message } from '@renderer/types/newMessage'
import { Flex, Tooltip } from 'antd'
import React, { useCallback } from 'react'
import styled from 'styled-components'

interface Props {
  message: Message
  block: MainTextMessageBlock
}

const MessageContent: React.FC<Props> = ({ message, block }) => {
  const renderMentions = useCallback(() => {
    return (
      <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
        {message.mentions?.map((asst) => {
          const key = `${asst.id}-${getModelUniqId(asst.model)}`
          return (
            <Tooltip title={`${asst.emoji} ${asst.name}`} key={key} mouseEnterDelay={0.5}>
              <MentionTag key={key}>{'@' + asst.model.name}</MentionTag>
            </Tooltip>
          )
        })}
      </Flex>
    )
  }, [message.mentions])

  return (
    <>
      {renderMentions()}
      <Markdown block={block} />
    </>
  )
}

const MentionTag = styled.span`
  color: var(--color-link);
`

export default React.memo(MessageContent)
